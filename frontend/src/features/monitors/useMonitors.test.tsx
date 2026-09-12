import { act, render, screen } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/mocks/server";
import type { components } from "../../lib/api/schema";
import { REFETCH_INTERVAL_MS, useMonitors } from "./useMonitors";

type MonitorRead = components["schemas"]["MonitorRead"];

function monitor(overrides: Partial<MonitorRead> = {}): MonitorRead {
  return {
    name: "api",
    target: "https://api.example.com",
    check_type: "http",
    check_config: { expected_status: 200, timeout: 10, method: "GET" },
    frequency: 60,
    id: 1,
    state: "Active",
    last_state: "healthy",
    last_checked_at: "2025-01-15T10:00:00",
    consecutive_failures: 0,
    created_at: "2025-01-15T09:00:00",
    user_id: 1,
    ...overrides,
  };
}

/**
 * Mirrors the QueryClient defaults main.tsx installs (staleTime 5 s, retry 2
 * with the exponential delay, refetchOnWindowFocus, no background intervals).
 * They live in main.tsx, which cannot be imported in a test (it calls
 * createRoot), so the polling behaviour is exercised against identical
 * defaults here.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 4_000),
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
      },
    },
  });
}

let latest: UseQueryResult<MonitorRead[], Error> | null = null;

function Probe() {
  latest = useMonitors();
  return (
    <ul>
      {(latest.data ?? []).map((m) => (
        <li key={m.id}>{m.name}</li>
      ))}
    </ul>
  );
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  // TanStack's focusManager subscribes to `visibilitychange` and reads
  // `document.visibilityState`, so the event must be dispatched (bubbling to
  // the window listener) for the pause/resume to take effect.
  document.dispatchEvent(new Event("visibilitychange"));
}

let failing = false;

let getCalls = 0;

function renderProbe() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
}

/** Flush pending microtasks/timers without advancing the clock. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Advance in 500 ms steps until `pred()` holds (or the budget is spent). The
 * final retry/rejection render can land just past a single long advance's
 * act window, so polling in steps keeps the assertions deterministic.
 */
async function advanceUntil(pred: () => boolean, maxMs = 25_000): Promise<void> {
  for (let elapsed = 0; elapsed < maxMs && !pred(); elapsed += 500) {
    await advance(500);
  }
}

beforeEach(() => {
  latest = null;
  getCalls = 0;
  failing = false;
  vi.useFakeTimers();
  server.use(
    http.get("*/api/v1/monitors/", () => {
      getCalls++;
      if (failing) {
        return HttpResponse.json({ detail: "engine unreachable" }, { status: 500 });
      }
      return HttpResponse.json([monitor()]);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  // Remove the own-property stubs; the Document.prototype getters jsdom
  // provides are untouched (we only ever defined own properties).
  delete (document as { hidden?: unknown }).hidden;
  delete (document as { visibilityState?: unknown }).visibilityState;
  document.dispatchEvent(new Event("visibilitychange"));
});

describe("useMonitors", () => {
  it("fetches the monitors list on mount", async () => {
    renderProbe();
    await settle();

    expect(getCalls).toBe(1);
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(latest?.isSuccess).toBe(true);
  });

  it("polls every 10 s by default", async () => {
    renderProbe();
    await settle();

    await advance(31_000);

    // Initial fetch + refetches at ~10 s, ~20 s, ~30 s. A 30 s cadence would
    // only produce 2 calls.
    expect(getCalls).toBeGreaterThanOrEqual(4);
    expect(getCalls).toBeLessThanOrEqual(5);
  });

  it("pauses polling while the tab is hidden and resumes on visibility", async () => {
    setHidden(true);
    renderProbe();
    await settle();
    const afterMount = getCalls;

    await advance(25_000);
    expect(getCalls).toBe(afterMount);

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(10_000);
    expect(getCalls).toBeGreaterThan(afterMount);
  });

  it("retains last data in the error state and backs off to 30 s", async () => {
    renderProbe();
    await settle();
    expect(screen.getByText("api")).toBeInTheDocument();

    failing = true;
    await advanceUntil(() => Boolean(latest?.error)); // next 10 s poll fails + retries

    expect(latest?.error).toBeTruthy();
    expect(latest?.data).toHaveLength(1); // last known data kept
    expect(screen.getByText("api")).toBeInTheDocument(); // list never blanked

    const afterError = getCalls;
    await advance(20_000); // inside the 30 s backoff window → no fetch
    expect(getCalls).toBe(afterError);

    await advance(12_000); // past the backoff window → fetch fires
    expect(getCalls).toBeGreaterThan(afterError);
  });

  it("restores the 10 s cadence once a poll succeeds again", async () => {
    renderProbe();
    await settle();

    failing = true;
    await advanceUntil(() => Boolean(latest?.error));
    expect(latest?.error).toBeTruthy();
    const errorCalls = getCalls;

    failing = false;
    await advanceUntil(() => getCalls > errorCalls, 45_000); // 30 s backoff refetch succeeds
    expect(getCalls).toBe(errorCalls + 1);

    await advanceUntil(() => getCalls > errorCalls + 1, 20_000); // 10 s cadence
    expect(getCalls).toBe(errorCalls + 2);
  });
});

describe("REFETCH_INTERVAL_MS", () => {
  it("defaults to 10 000 ms", () => {
    expect(REFETCH_INTERVAL_MS).toBe(10_000);
  });

  it("is overridable via VITE_POLL_INTERVAL_MS", async () => {
    vi.stubEnv("VITE_POLL_INTERVAL_MS", "25000");
    vi.resetModules();
    try {
      const mod = await import("./useMonitors");
      expect(mod.REFETCH_INTERVAL_MS).toBe(25_000);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

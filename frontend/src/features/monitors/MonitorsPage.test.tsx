import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/mocks/server";
import type { components } from "../../lib/api/schema";
import { MonitorsPage } from "./MonitorsPage";

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

let failing = false;

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

function renderPage(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MonitorsPage />
    </QueryClientProvider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  failing = false;
  vi.useFakeTimers();
  server.use(
    http.get("*/api/v1/monitors/", () => {
      if (failing) {
        return HttpResponse.json({ detail: "engine unreachable" }, { status: 500 });
      }
      return HttpResponse.json([monitor()]);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MonitorsPage", () => {
  it("renders the list and the create form in the success state", async () => {
    renderPage();
    await settle();

    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Target")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps last known data and shows the stale/offline banner in the error state", async () => {
    renderPage();
    await settle();
    expect(screen.getByText("api")).toBeInTheDocument();

    failing = true;
    await advance(25_000); // poll failure + retries land within this window

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The list is never blanked on failure.
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("api").closest("li")).not.toBeNull();
  });

  it("renders a delete control per row", async () => {
    renderPage();
    await settle();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});
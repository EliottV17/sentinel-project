import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMonitorAlerts, fetchMonitorHistory } from "./endpoints";
import { server } from "../../test/mocks/server";
import { chronologicalHistory, summarizeMonitorHistory } from "../../features/monitors/history/summary";
import { useMonitorHistory } from "../../features/monitors/history/useMonitorHistory";

const historyRow = {
  id: 4,
  monitor_id: 8,
  state: "healthy",
  status_code: 200,
  latency_ms: 25,
  error_message: null,
  created_at: "2025-02-03T04:05:06.000Z",
};

const alertRow = {
  id: 9,
  monitor_id: 8,
  alert_type: "down",
  message: "Monitor is down",
  created_at: "2025-02-03T04:05:06.000Z",
};

describe("monitor history endpoints", () => {
  afterEach(() => server.resetHandlers());

  it("requests the requested bounded history and alert limits", async () => {
    const calls: string[] = [];
    server.use(
      http.get("*/api/v1/monitors/8/history", ({ request }) => {
        calls.push(new URL(request.url).search);
        return HttpResponse.json([historyRow]);
      }),
      http.get("*/api/v1/monitors/8/alerts", ({ request }) => {
        calls.push(new URL(request.url).search);
        return HttpResponse.json([alertRow]);
      }),
    );

    await expect(fetchMonitorHistory(8, 150)).resolves.toEqual([historyRow]);
    await expect(fetchMonitorAlerts(8)).resolves.toEqual([alertRow]);
    expect(calls).toEqual(["?limit=150", "?limit=20"]);
  });

  it("rejects invalid identifiers and limits outside the supported range", async () => {
    expect(() => fetchMonitorHistory(0, 50)).toThrow();
    expect(() => fetchMonitorHistory(8, 201)).toThrow();
    expect(() => fetchMonitorAlerts(-1, 20)).toThrow();
    expect(() => fetchMonitorAlerts(8, 0)).toThrow();
  });
});

describe("monitor history summary helpers", () => {
  it("summarizes real loaded rows and ignores null or non-finite latencies", () => {
    const rows = [
      { ...historyRow, id: 1, state: "healthy", latency_ms: 10 },
      { ...historyRow, id: 2, state: "unhealthy", latency_ms: null },
      { ...historyRow, id: 3, state: "healthy", latency_ms: 30 },
      { ...historyRow, id: 4, state: "healthy", latency_ms: Number.POSITIVE_INFINITY },
    ];

    expect(summarizeMonitorHistory(rows)).toEqual({
      loadedCount: 4,
      healthyPercentage: 75,
      medianLatencyMs: 20,
      p95LatencyMs: 30,
    });
    expect(summarizeMonitorHistory([])).toEqual({
      loadedCount: 0,
      healthyPercentage: null,
      medianLatencyMs: null,
      p95LatencyMs: null,
    });
  });

  it("returns a sorted copy while preserving null latency", () => {
    const newest = { ...historyRow, id: 2, latency_ms: null, created_at: "2025-02-02T00:00:00Z" };
    const oldest = { ...historyRow, id: 1, created_at: "2025-02-01T00:00:00Z" };
    const input = [newest, oldest];
    const chronological = chronologicalHistory(input);

    expect(chronological.map((row) => row.id)).toEqual([1, 2]);
    expect(chronological[1].latency_ms).toBeNull();
    expect(input[0].id).toBe(2);
  });
});

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
  });
}

function HistoryProbe({ monitorId }: { monitorId: number }) {
  const query = useMonitorHistory(monitorId);
  return createElement("section", null,
    createElement("span", { "data-testid": "monitor" }, query.monitor?.name ?? "missing"),
    createElement("span", { "data-testid": "rows" }, query.history?.map((row) => row.id).join(",") ?? "none"),
    createElement("span", { "data-testid": "alerts" }, query.alerts?.length ?? "loading"),
    createElement("span", { "data-testid": "limit" }, query.historyLimit),
    createElement("span", { "data-testid": "can-load-more" }, String(query.canLoadMore)),
    createElement("span", { "data-testid": "history-fetching" }, String(query.historyIsFetching)),
    createElement("span", { "data-testid": "history-error" }, String(Boolean(query.historyError))),
    createElement("span", { "data-testid": "metadata-loading" }, String(query.metadataIsLoading)),
    createElement("span", { "data-testid": "metadata-loaded" }, String(query.metadataLoaded)),
    createElement("button", { onClick: query.loadMoreHistory, disabled: !query.canLoadMore }, "more"),
    createElement("button", { onClick: query.loadMoreHistory }, "direct more"),
    createElement("button", { onClick: () => void query.refetchHistory() }, "refetch history"),
  );
}

describe("useMonitorHistory", () => {
  afterEach(() => {
    server.resetHandlers();
    vi.useRealTimers();
    focusManager.setFocused(undefined);
    delete (document as { hidden?: unknown }).hidden;
    delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });

  it("loads list metadata/history/alerts and preserves rows when the next limit fails", async () => {
    const requestedLimits: string[] = [];
    server.use(
      http.get("*/api/v1/monitors/", () => HttpResponse.json([
        { id: 8, name: "first", target: "https://first.example", frequency: 60 },
        { id: 9, name: "second", target: "https://second.example", frequency: 120 },
      ])),
      http.get("*/api/v1/monitors/8/history", ({ request }) => {
        const limit = new URL(request.url).searchParams.get("limit") ?? "";
        requestedLimits.push(limit);
        return limit === "50"
          ? HttpResponse.json([historyRow])
          : HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 });
      }),
      http.get("*/api/v1/monitors/8/alerts", () => HttpResponse.json([alertRow])),
      http.get("*/api/v1/monitors/9/history", () => HttpResponse.json([])),
      http.get("*/api/v1/monitors/9/alerts", () => HttpResponse.json([])),
    );
    const client = makeQueryClient();
    const view = render(createElement(QueryClientProvider, { client }, createElement(HistoryProbe, { monitorId: 8 })));

    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(screen.getByTestId("metadata-loading")).toHaveTextContent("false");
    expect(screen.getByTestId("metadata-loaded")).toHaveTextContent("true");
    await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("4"));
    expect(screen.getByTestId("history-fetching")).toHaveTextContent("false");
    expect(await screen.findByTestId("alerts")).toHaveTextContent("1");
    await act(async () => screen.getByRole("button", { name: "more" }).click());
    expect(screen.getByTestId("limit")).toHaveTextContent("100");
    await waitFor(() => expect(requestedLimits).toEqual(["50", "100"]));
    expect(screen.getByTestId("rows")).toHaveTextContent("4");

    view.rerender(createElement(QueryClientProvider, { client }, createElement(HistoryProbe, { monitorId: 9 })));
    expect(await screen.findByText("second")).toBeInTheDocument();
    expect(screen.getByTestId("rows")).not.toHaveTextContent("4");
    client.clear();
  });

  it("blocks limit growth during a short Retry-After, then enables it at cooldown expiry", async () => {
    vi.useFakeTimers();
    const historyLimits: string[] = [];
    server.use(
      http.get("*/api/v1/monitors/", () => HttpResponse.json([])),
      http.get("*/api/v1/monitors/8/history", ({ request }) => {
        historyLimits.push(new URL(request.url).searchParams.get("limit") ?? "");
        return HttpResponse.json({ detail: "slow down" }, {
          status: 429,
          headers: { "Retry-After": "5" },
        });
      }),
      http.get("*/api/v1/monitors/8/alerts", () => HttpResponse.json([])),
    );
    render(createElement(QueryClientProvider, { client: makeQueryClient() }, createElement(HistoryProbe, { monitorId: 8 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(historyLimits).toEqual(["50"]);
    expect(screen.getByTestId("can-load-more")).toHaveTextContent("false");
    await act(async () => screen.getByRole("button", { name: "direct more" }).click());
    expect(historyLimits).toEqual(["50"]);
    expect(screen.getByTestId("limit")).toHaveTextContent("50");

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(historyLimits).toEqual(["50"]); // a short Retry-After cannot shorten the 30 s poll cadence
    expect(screen.getByTestId("can-load-more")).toHaveTextContent("true");
    await act(async () => screen.getByRole("button", { name: "more" }).click());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(historyLimits).toEqual(["50", "100"]);
    expect(screen.getByTestId("limit")).toHaveTextContent("100");
  });

  it("honors Retry-After for manual and focus refetches", async () => {
    let historyCalls = 0;
    server.use(
      http.get("*/api/v1/monitors/", () => HttpResponse.json([])),
      http.get("*/api/v1/monitors/8/history", () => {
        historyCalls++;
        return HttpResponse.json({ detail: "slow down" }, {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }),
      http.get("*/api/v1/monitors/8/alerts", () => HttpResponse.json([])),
    );
    const client = makeQueryClient();
    const view = render(createElement(QueryClientProvider, { client }, createElement(HistoryProbe, { monitorId: 8 })));
    await waitFor(() => expect(screen.getByTestId("history-error")).toHaveTextContent("true"));
    expect(historyCalls).toBe(1);
    await act(async () => screen.getByRole("button", { name: "refetch history" }).click());
    expect(historyCalls).toBe(1);
    focusManager.setFocused(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(historyCalls).toBe(1);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(historyCalls).toBe(1);
    view.unmount();
    render(createElement(QueryClientProvider, { client }, createElement(HistoryProbe, { monitorId: 8 })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(historyCalls).toBe(1);
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    client.clear();
  });

  it("uses a bounded 30-second visible cadence and pauses intervals in hidden tabs", async () => {
    vi.useFakeTimers();
    const calls = { metadata: 0, history: 0, alerts: 0 };
    server.use(
      http.get("*/api/v1/monitors/", () => {
        calls.metadata++;
        return HttpResponse.json([]);
      }),
      http.get("*/api/v1/monitors/8/history", () => {
        calls.history++;
        return HttpResponse.json([historyRow]);
      }),
      http.get("*/api/v1/monitors/8/alerts", () => {
        calls.alerts++;
        return HttpResponse.json([alertRow]);
      }),
    );
    render(createElement(QueryClientProvider, { client: makeQueryClient() }, createElement(HistoryProbe, { monitorId: 8 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toEqual({ metadata: 1, history: 1, alerts: 1 });

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toEqual({ metadata: 3, history: 3, alerts: 3 });

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    const visibleCounts = { ...calls };
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toEqual(visibleCounts);
    delete (document as { hidden?: unknown }).hidden;
    delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });

  it("uses TanStack's initial hidden visibility state to pause polling", async () => {
    vi.useFakeTimers();
    const calls = { metadata: 0, history: 0, alerts: 0 };
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    server.use(
      http.get("*/api/v1/monitors/", () => {
        calls.metadata++;
        return HttpResponse.json([]);
      }),
      http.get("*/api/v1/monitors/8/history", () => {
        calls.history++;
        return HttpResponse.json([historyRow]);
      }),
      http.get("*/api/v1/monitors/8/alerts", () => {
        calls.alerts++;
        return HttpResponse.json([alertRow]);
      }),
    );
    render(createElement(QueryClientProvider, { client: makeQueryClient() }, createElement(HistoryProbe, { monitorId: 8 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toEqual({ metadata: 1, history: 1, alerts: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toEqual({ metadata: 1, history: 1, alerts: 1 });

    // Query Core's focusManager reads `document.visibilityState` on interval ticks;
    // this hidden-at-mount case intentionally asserts pause, not focus refetch.
  });

  it("does not retry terminal authorization/not-found responses", async () => {
    let historyCalls = 0;
    server.use(
      http.get("*/api/v1/monitors/8/", () => HttpResponse.json([])),
      http.get("*/api/v1/monitors/8/history", () => {
        historyCalls++;
        return HttpResponse.json({ detail: "not found" }, { status: 404 });
      }),
      http.get("*/api/v1/monitors/8/alerts", () => HttpResponse.json([])),
      http.get("*/api/v1/monitors/", () => HttpResponse.json([])),
    );
    render(createElement(QueryClientProvider, { client: makeQueryClient() }, createElement(HistoryProbe, { monitorId: 8 })));
    await screen.findByTestId("alerts");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(historyCalls).toBe(1);
    expect(screen.getByTestId("can-load-more")).toHaveTextContent("false");
    await act(async () => screen.getByRole("button", { name: "direct more" }).click());
    expect(historyCalls).toBe(1);
    expect(screen.getByTestId("limit")).toHaveTextContent("50");
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../../test/mocks/server";
import { fetchMonitors } from "../../../app/api/endpoints";
import { MonitorHistoryPage } from "./MonitorHistoryPage";

const monitor = {
  id: 7,
  name: "Primary API",
  target: "https://api.example.com/health",
  check_type: "http",
  check_config: { secret_header: "must-not-render" },
  frequency: 60,
  state: "Active",
  last_state: "unhealthy",
  last_checked_at: "2025-01-15T10:02:00Z",
  consecutive_failures: 2,
  created_at: "2025-01-15T09:00:00Z",
  user_id: 3,
};
const check = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  monitor_id: 7,
  state: "healthy",
  status_code: 200,
  latency_ms: 20,
  error_message: null,
  created_at: "2025-01-15T10:00:00Z",
  ...overrides,
});
const alert = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  monitor_id: 7,
  alert_type: "down",
  message: "Service is down",
  created_at: "2025-01-15T10:01:00Z",
  ...overrides,
});

function renderPage(id = "7") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/monitors/${id}`]}>
        <Routes>
          <Route path="/monitors/:id" element={<MonitorHistoryPage />} />
          <Route path="/" element={<p>Monitor list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
});

describe("MonitorHistoryPage", () => {
  it.each([
    ["healthy", "Healthy"],
    ["unhealthy", "Unhealthy"],
  ] as const)("shows paused %s as historical context without claiming checks run", async (lastState, resultLabel) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([{ ...monitor, state: "Paused", last_state: lastState, last_checked_at: "2025-01-15T09:57:00Z" }])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Last result: ${resultLabel}`))).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    expect(screen.getByText("Checks are paused.")).toBeInTheDocument();
    expect(screen.getByText(/No checks yet\. Checks are paused\./)).toBeInTheDocument();
    expect(screen.queryByText(/No recent check/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checks run every/)).not.toBeInTheDocument();
  });

  it("shows paused no-check state and never presents it as a running schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([{ ...monitor, state: "Paused", last_state: null, last_checked_at: null }])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Never checked.")).toBeInTheDocument();
    expect(screen.getByText(/No checks yet\. Checks are paused\./)).toBeInTheDocument();
    expect(screen.queryByText(/No recent check/)).not.toBeInTheDocument();
  });

  it("reevaluates identical metadata past 120 seconds without changing the 30s API cadence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
    const checked = "2025-01-15T10:00:00Z";
    const payloads: Record<string, string[]> = { metadata: [], history: [], alerts: [] };
    let metadataRequests = 0;
    let historyRequests = 0;
    let alertRequests = 0;
    server.use(
      http.get("/api/v1/monitors", () => {
        metadataRequests++;
        const body = [{ ...monitor, last_checked_at: checked }];
        payloads.metadata.push(JSON.stringify(body));
        return HttpResponse.json(body);
      }),
      http.get("/api/v1/monitors/7/history", () => {
        historyRequests++;
        const body = [check()];
        payloads.history.push(JSON.stringify(body));
        return HttpResponse.json(body);
      }),
      http.get("/api/v1/monitors/7/alerts", () => {
        alertRequests++;
        const body: ReturnType<typeof alert>[] = [];
        payloads.alerts.push(JSON.stringify(body));
        return HttpResponse.json(body);
      }),
    );
    renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText(/No recent check/)).not.toBeInTheDocument();
    for (let interval = 0; interval < 4; interval++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    }
    expect(screen.queryByText(/No recent check/)).not.toBeInTheDocument();
    expect(metadataRequests).toBe(5);
    expect(historyRequests).toBe(5);
    expect(alertRequests).toBe(5);
    const cadenceRequests = [metadataRequests, historyRequests, alertRequests];
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(/No recent check/)).toBeInTheDocument();
    expect([metadataRequests, historyRequests, alertRequests]).toEqual(cadenceRequests);
    for (const payload of Object.values(payloads)) {
      expect(payload).toHaveLength(5);
      expect(new Set(payload).size).toBe(1);
    }
  });

  it("keeps metadata API errors independent from stale data and recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
    let fail = false;
    let metadataCalls = 0;
    let lastChecked = "2025-01-15T10:00:00Z";
    server.use(
      http.get("/api/v1/monitors", () => { metadataCalls++; return fail
        ? HttpResponse.json({ detail: "offline" }, { status: 500 })
        : HttpResponse.json([{ ...monitor, last_checked_at: lastChecked }]); }),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([check()])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    const { client } = renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fail = true;
    await act(async () => { await client.refetchQueries({ queryKey: ["monitor-history", "metadata", 7], exact: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("alert")).toHaveTextContent("Previously loaded data is still shown");
    expect(screen.queryByText(/No recent check/)).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/No recent check/)).toBeInTheDocument();

    fail = false;
    await act(async () => { await client.fetchQuery({ queryKey: ["monitor-history", "metadata", 7], queryFn: fetchMonitors, staleTime: 0 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/No recent check/)).toBeInTheDocument();
    lastChecked = new Date(Date.now()).toISOString();
    await act(async () => { await client.fetchQuery({ queryKey: ["monitor-history", "metadata", 7], queryFn: fetchMonitors, staleTime: 0 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(metadataCalls).toBeGreaterThan(1);
    expect(client.getQueryData(["monitor-history", "metadata", 7])).toEqual(expect.arrayContaining([expect.objectContaining({ last_checked_at: lastChecked })]));
    expect(screen.queryByText(/No recent check/)).not.toBeInTheDocument();
  });

  it("loads metadata, truthful check summary, table, alerts, and accessible chronological chart", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([
        check({ id: 2, state: "unhealthy", status_code: 503, latency_ms: null, error_message: "<script>escaped()</script>", created_at: "2025-01-15T10:02:00Z" }),
        check({ id: 1, created_at: "2025-01-15T10:00:00Z" }),
        check({ id: 3, state: "unhealthy", latency_ms: 0, created_at: "2025-01-15T10:01:00Z" }),
      ])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([
        alert({ alert_type: "mystery", message: "<img src=x>plain text" }),
        alert({ id: 2, alert_type: "recovery", message: "Recovered" }),
      ])),
    );

    renderPage();

    expect(await screen.findByRole("heading", { name: "Primary API" })).toBeInTheDocument();
    expect(screen.getByText("Unhealthy")).toBeInTheDocument();
    expect(screen.getByText("In the last 3 checks")).toBeInTheDocument();
    expect(screen.getByText(/Metrics use 3 loaded checks/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 15, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/local time zone/)).toBeInTheDocument();
    expect(screen.getByText("Latency summaries include measured checks, including failed checks.")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("10.0 ms")).toBeInTheDocument();
    expect(screen.getAllByText("20 ms").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0 ms")).toBeInTheDocument();
    expect(screen.getByText("<script>escaped()</script>")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /escaped/ })).not.toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
    expect(screen.getByText(/Healthy check, 20 ms/)).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /latency history/i });
    expect(chart).toHaveAccessibleDescription(/3 checks/i);
    expect(chart.querySelector("polyline")?.getAttribute("points")).toBe("54,14 341,180");
    expect(screen.getByText("Unknown alert")).toBeInTheDocument();
    expect(screen.getByText("<img src=x>plain text")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("503")).toBeInTheDocument();
    expect(rows[1].querySelector("time")?.title).toBeTruthy();
    expect(screen.queryByText(/response_sample/i)).not.toBeInTheDocument();
  });

  it("charts all down checks with null latency at baseline without inventing measurements", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([
        check({ id: 2, state: "unhealthy", latency_ms: null, status_code: null, created_at: "2025-01-15T10:02:00Z" }),
        check({ id: 1, state: "unhealthy", latency_ms: null, status_code: null, created_at: "2025-01-15T10:01:00Z" }),
      ])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    const chart = await screen.findByRole("img", { name: /latency history/i });
    expect(chart).toHaveAccessibleDescription(/2 checks, ordered chronologically\. 0 measured latency values/);
    expect(chart.querySelectorAll("path")).toHaveLength(2);
    expect(chart.querySelectorAll("polyline")).toHaveLength(0);
    expect(screen.queryByText("0 ms")).not.toBeInTheDocument();
  });

  it("distinguishes an unavailable down latency marker from a real zero-millisecond measurement", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([
        check({ id: 2, state: "unhealthy", latency_ms: null, created_at: "2025-01-15T10:02:00Z" }),
        check({ id: 1, state: "unhealthy", latency_ms: 0, created_at: "2025-01-15T10:01:00Z" }),
      ])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    const chart = await screen.findByRole("img", { name: /latency history/i });
    expect(chart.querySelectorAll("path")).toHaveLength(1);
    expect(chart.querySelectorAll('[data-marker="failed-measured"]')).toHaveLength(1);
    expect(chart.querySelectorAll('[data-marker="healthy-measured"]')).toHaveLength(0);
  });

  it("shows a section loading state before history arrives", async () => {
    let resolveHistory!: (response: Response) => void;
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => new Promise<Response>((resolve) => { resolveHistory = resolve; })),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText("Loading checks…")).toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
    await waitFor(() => expect(resolveHistory).toBeTypeOf("function"));
    resolveHistory(HttpResponse.json([check()]));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("does not invent a sample interval when loaded check timestamps are invalid", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([check({ created_at: "not-a-date" })])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText(/Metrics use 1 loaded check\. Check time interval unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/local time zone/)).toBeInTheDocument();
  });

  it("reevaluates earlier exhaustion after an automatic-style successful refresh", async () => {
    let historyCalls = 0;
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => {
        historyCalls += 1;
        return HttpResponse.json(historyCalls === 1 ? [check()] : Array.from({ length: 50 }, (_, id) => check({ id: id + 1 })));
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    const { client } = renderPage();
    expect(await screen.findByText("No older checks available.")).toBeInTheDocument();
    await client.refetchQueries({ queryKey: ["monitor-history", "rows", 7, 50], exact: true });
    expect(await screen.findByRole("button", { name: /load 50 more/i })).toBeInTheDocument();
    expect(screen.queryByText("No older checks available.")).not.toBeInTheDocument();
  });

  it("isolates history exhaustion when navigating between monitors", async () => {
    const secondMonitor = { ...monitor, id: 8, name: "Secondary API" };
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor, secondMonitor])),
      http.get("/api/v1/monitors/:id/history", ({ params }) => HttpResponse.json(
        params.id === "7" ? [] : Array.from({ length: 50 }, (_, id) => check({ id: id + 1, monitor_id: 8 })),
      )),
      http.get("/api/v1/monitors/:id/alerts", () => HttpResponse.json([])),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/monitors/7"]}>
          <Link to="/monitors/8">Next monitor</Link>
          <Routes><Route path="/monitors/:id" element={<MonitorHistoryPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No older checks available.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Next monitor" }));
    expect(await screen.findByRole("heading", { name: "Secondary API" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /load 50 more/i })).toBeInTheDocument();
    expect(screen.queryByText("No older checks available.")).not.toBeInTheDocument();
  });

  it("shows active never-checked state and independent empty states", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([{ ...monitor, last_state: null, last_checked_at: null }])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText("No checks yet. The worker checks this monitor every 60 seconds.")).toBeInTheDocument();
    expect(screen.getByText("Never checked")).toBeInTheDocument();
    expect(screen.getByText(/Checks run every/)).toBeInTheDocument();
    expect(screen.getAllByText("No data").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("No older checks available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load 50 more/i })).not.toBeInTheDocument();
    expect(screen.getByText("No alerts yet.")).toBeInTheDocument();
  });

  it.each([0, 14, 15, 49])("marks a successful short first batch of %s rows exhausted", async (count) => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json(Array.from({ length: count }, (_, id) => check({ id: id + 1 })))),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText("No older checks available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load 50 more/i })).not.toBeInTheDocument();
  });

  it.each([401, 403, 404])("does not reveal data after a %s history failure", async (status) => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json({ detail: "private server detail" }, { status })),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([alert()])),
    );
    renderPage();
    expect(await screen.findByText("Monitor not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to monitors/i })).toHaveAttribute("href", "/");
    expect(screen.queryByText("Service is down")).not.toBeInTheDocument();
    expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
  });

  it("treats a monitor missing from loaded metadata as unavailable without showing query data", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([check()])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([alert()])),
    );
    renderPage();
    expect(await screen.findByText("Monitor not found")).toBeInTheDocument();
    expect(screen.queryByText("Service is down")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("explains 429 cooldown without exposing API details", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json({ detail: "private throttle detail" }, { status: 429, headers: { "Retry-After": "90" } })),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("wait 90 seconds");
    expect(screen.getAllByRole("alert")[0]).not.toHaveTextContent("private throttle detail");
  });

  it("retains the loaded page during a same-key background 429 and observes its cooldown", async () => {
    let historyCalls = 0;
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => {
        historyCalls += 1;
        return historyCalls === 1
          ? HttpResponse.json([check({ status_code: 204 })])
          : HttpResponse.json({ detail: "private cooldown data" }, { status: 429, headers: { "Retry-After": "120" } });
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([alert({ message: "Alert remains visible" })])),
    );
    const { client } = renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(await screen.findByText("Alert remains visible")).toBeInTheDocument();

    await client.refetchQueries({ queryKey: ["monitor-history", "rows", 7, 50], exact: true });

    expect(await screen.findAllByText(/wait 120 seconds/i)).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("204")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /latency history/i })).toBeInTheDocument();
    expect(screen.getByText("Alert remains visible")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load 50 more/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/private cooldown data/)).not.toBeInTheDocument();
    expect(historyCalls).toBe(2);
  });

  it("retains the loaded page and alert after a same-key background 500", async () => {
    let historyCalls = 0;
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => {
        historyCalls += 1;
        return historyCalls === 1
          ? HttpResponse.json([check({ status_code: 202 })])
          : HttpResponse.json({ detail: "private server failure" }, { status: 500 });
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([alert({ message: "Alert remains visible after 500" })])),
    );
    const { client } = renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(await screen.findByText("Alert remains visible after 500")).toBeInTheDocument();

    await client.refetchQueries({ queryKey: ["monitor-history", "rows", 7, 50], exact: true });

    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("202")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /latency history/i })).toBeInTheDocument();
    expect(screen.getByText("Alert remains visible after 500")).toBeInTheDocument();
    expect(screen.queryByText(/private server failure/)).not.toBeInTheDocument();
    expect(historyCalls).toBe(2);
  });

  it("rejects route IDs with suffixes without issuing detail queries", async () => {
    const historyRequest = vi.fn();
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/:id/history", ({ request }) => { historyRequest(request.url); return HttpResponse.json([]); }),
      http.get("/api/v1/monitors/:id/alerts", () => HttpResponse.json([])),
    );
    renderPage("7abc");
    expect(await screen.findByText("Monitor not found")).toBeInTheDocument();
    expect(historyRequest).not.toHaveBeenCalled();
  });

  it("retains 50 rows and retries a failed expansion at the same 100-row limit", async () => {
    const requestedLimits: string[] = [];
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", ({ request }) => {
        const limit = new URL(request.url).searchParams.get("limit") ?? "";
        requestedLimits.push(limit);
        if (limit === "50") return HttpResponse.json(Array.from({ length: 50 }, (_, id) => check({ id: id + 1 })));
        return requestedLimits.filter((requested) => requested === "100").length === 1
          ? HttpResponse.json({ detail: "private query failure" }, { status: 500 })
          : HttpResponse.json(Array.from({ length: 100 }, (_, id) => check({ id: id + 1 })));
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load 50 more/i }));
    const messages = await screen.findAllByRole("alert");
    expect(messages[0]).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("50", { selector: "p" })).toBeInTheDocument();
    expect(messages[0]).not.toHaveTextContent("private query failure");
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    expect(await screen.findByText(/Metrics use 100 loaded checks/)).toBeInTheDocument();
    expect(requestedLimits).toEqual(["50", "100", "100"]);
  });

  it("offers bounded load-more and preserves existing rows while the larger limit fetches", async () => {
    let resolveExpanded!: (response: Response) => void;
    const requestedLimits: string[] = [];
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", ({ request }) => {
        const limit = new URL(request.url).searchParams.get("limit") ?? "";
        requestedLimits.push(limit);
        if (limit === "50") return HttpResponse.json(Array.from({ length: 50 }, (_, id) => check({ id: id + 1 })));
        return new Promise<Response>((resolve) => { resolveExpanded = resolve; });
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load 50 more/i }));
    fireEvent.click(screen.getByRole("button", { name: /loading more/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /loading more/i })).toBeDisabled();
    await waitFor(() => expect(resolveExpanded).toBeTypeOf("function"));
    expect(requestedLimits).toEqual(["50", "100"]);
    resolveExpanded!(HttpResponse.json([check(), ...Array.from({ length: 50 }, (_, id) => check({ id: id + 2 }))]));
    await waitFor(() => expect(screen.getByText(/Metrics use 51 loaded checks/)).toBeInTheDocument());
    expect(screen.getByText("No older checks available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load 50 more/i })).not.toBeInTheDocument();
  });

  it("distinguishes a full 200-check client cap from history exhaustion", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get("limit"));
        return HttpResponse.json(Array.from({ length: limit }, (_, id) => check({ id: id + 1 })));
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    for (const count of [100, 150, 200]) {
      fireEvent.click(screen.getByRole("button", { name: /load 50 more/i }));
      expect(await screen.findByText(new RegExp(`Metrics use ${count} loaded checks`))).toBeInTheDocument();
    }
    expect(screen.getByText("Showing the latest 200 checks.")).toBeInTheDocument();
    expect(screen.queryByText("No older checks available.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load 50 more/i })).not.toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../../test/mocks/server";
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

afterEach(() => server.resetHandlers());

describe("MonitorHistoryPage", () => {
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
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getAllByText("20 ms").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0 ms")).toBeInTheDocument();
    expect(screen.getByText("<script>escaped()</script>")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /escaped/ })).not.toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
    expect(screen.getByText("Down — latency unavailable")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /latency history/i });
    expect(chart).toHaveAccessibleDescription(/3 checks/i);
    expect(chart.querySelector("polyline")?.getAttribute("points")).toBe("24,18 320,162");
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
    expect(chart).toHaveAccessibleDescription(/2 checks in chronological order\. 0 measured latency values/);
    expect(chart.querySelectorAll('g[aria-label="Down — latency unavailable"]')).toHaveLength(2);
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
    expect(chart.querySelector('g[aria-label="Down — latency unavailable"]')).toBeInTheDocument();
    expect(chart.querySelector('g[aria-label="Down — 0 ms"]')).toBeInTheDocument();
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

  it("shows independent empty states and no-data metrics", async () => {
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => HttpResponse.json([])),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText("No checks yet. The worker checks this monitor every 60 seconds.")).toBeInTheDocument();
    expect(screen.getAllByText("No data").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("No alerts yet.")).toBeInTheDocument();
  });

  it.each([403, 404])("does not reveal data after a %s history failure", async (status) => {
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

  it("keeps old rows and shows a friendly error when expanding the limit fails", async () => {
    let historyCalls = 0;
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", () => {
        historyCalls += 1;
        return historyCalls === 1 ? HttpResponse.json([check()]) : HttpResponse.json({ detail: "private query failure" }, { status: 500 });
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load 50 more/i }));
    const messages = await screen.findAllByRole("alert");
    expect(messages[0]).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(messages[0]).not.toHaveTextContent("private query failure");
  });

  it("offers bounded load-more and preserves existing rows while the larger limit fetches", async () => {
    let resolveExpanded!: (response: Response) => void;
    server.use(
      http.get("/api/v1/monitors", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/7/history", ({ request }) => {
        const limit = new URL(request.url).searchParams.get("limit");
        if (limit === "50") return HttpResponse.json([check()]);
        return new Promise<Response>((resolve) => { resolveExpanded = resolve; });
      }),
      http.get("/api/v1/monitors/7/alerts", () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load 50 more/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /loading more/i })).toBeDisabled();
    await waitFor(() => expect(resolveExpanded).toBeTypeOf("function"));
    resolveExpanded!(HttpResponse.json([check(), ...Array.from({ length: 50 }, (_, id) => check({ id: id + 2 }))]));
    await waitFor(() => expect(screen.getByText("In the last 51 checks")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /load 50 more/i })).toBeInTheDocument();
  });
});

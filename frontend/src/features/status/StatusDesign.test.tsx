import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { StatusPage } from "./StatusPage";

it("renders healthy checks and actual sample coverage without overstating rounded values", async () => {
  const windowStart = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  const windowEnd = new Date().toISOString();
  server.use(http.get("/api/v1/public/status", () => HttpResponse.json([
    {
      name: "Public API", last_state: "healthy", uptime_percentage: 99.999,
      last_checked_at: new Date(Date.now() - 60_000).toISOString(),
      check_summary: {
        window_hours: 6, total_checks: 10_000, healthy_checks: 9_999,
        window_start: windowStart, window_end: windowEnd,
        first_check_at: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
        last_check_at: new Date(Date.now() - 60_000).toISOString(),
      },
    },
  ])));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/status"]}><StatusPage /></MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "System status" })).toBeInTheDocument();
  expect(await screen.findByText("Healthy checks: 99.99%")).toBeInTheDocument();
  expect(screen.getByText(/6-hour window · 10,000 checks/)).toBeInTheDocument();
  expect(screen.getByText(/sample coverage:/i)).toBeInTheDocument();
  expect(screen.queryByText("Healthy checks: 100%")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.getByRole("status", { name: "Status: All systems operational" })).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Status: Operational" })).toBeInTheDocument();
  expect(screen.queryByText(/Estado|verificación|servicios públicos/i)).not.toBeInTheDocument();
});

it("shows a dash for a configured window with no public samples", async () => {
  server.use(http.get("/api/v1/public/status", () => HttpResponse.json([
    {
      name: "Empty API", last_state: "healthy", uptime_percentage: null, last_checked_at: null,
      check_summary: {
        window_hours: 6, total_checks: 0, healthy_checks: 0,
        window_start: "2025-01-01T00:00:00.000Z", window_end: "2025-01-01T06:00:00.000Z",
        first_check_at: null, last_check_at: null,
      },
    },
  ])));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/status"]}><StatusPage /></MemoryRouter>
    </QueryClientProvider>,
  );

  const card = (await screen.findByText("Empty API")).closest("li");
  expect(card).toHaveTextContent("Healthy checks: —");
  expect(card).toHaveTextContent("6-hour window · 0 checks");
  expect(card).toHaveTextContent("Sample coverage: —");
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { MonitorsPage } from "./MonitorsPage";
import { server } from "../../test/mocks/server";

const monitor = (overrides: Record<string, unknown> = {}) => ({
  name: "Public API",
  target: "https://api.example.com",
  check_type: "http",
  check_config: { expected_status: 200, timeout: 10, method: "GET" },
  frequency: 60,
  id: 1,
  state: "Active",
  last_state: "healthy",
  last_checked_at: new Date().toISOString(),
  consecutive_failures: 0,
  created_at: new Date().toISOString(),
  user_id: 1,
  ...overrides,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><MonitorsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("monitor dashboard design", () => {
  it("derives truthful metrics from the loaded monitor states, counting unknown as attention", async () => {
    server.use(http.get("/api/v1/monitors", () => HttpResponse.json([
      monitor({ id: 1, name: "Healthy API" }),
      monitor({ id: 2, name: "Down API", last_state: "unhealthy", consecutive_failures: 2 }),
      monitor({ id: 3, name: "Unverified API", last_state: null, last_checked_at: null }),
    ])));

    renderPage();

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByText(/unknown is not healthy/i)).toBeInTheDocument();
    expect(screen.queryByText(/average uptime/i)).not.toBeInTheDocument();
  });

  it("does not expose raw API error details in the dashboard", async () => {
    server.use(http.get("/api/v1/monitors", () =>
      HttpResponse.json({ message: "Error al consultar la base de datos: private detail" }, { status: 500 }),
    ));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("alert").textContent).not.toMatch(/private detail|consultar la base/i);
  });
});

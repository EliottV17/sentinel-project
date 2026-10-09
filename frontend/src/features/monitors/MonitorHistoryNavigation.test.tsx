import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { router } from "../../App";
import { tokenStore } from "../../app/api/token";
import type { components } from "../../lib/api/schema";
import { server } from "../../test/mocks/server";
import { MonitorRow } from "./MonitorRow";

type MonitorRead = components["schemas"]["MonitorRead"];

const monitor: MonitorRead = {
  id: 42,
  name: "Primary API",
  target: "https://api.example.com",
  check_type: "http",
  check_config: {},
  frequency: 60,
  state: "Active",
  last_state: "healthy",
  last_checked_at: null,
  consecutive_failures: 0,
  created_at: "2025-01-15T09:00:00Z",
  user_id: 1,
};

function validToken() {
  const payload = btoa(JSON.stringify({ sub: "viewer@example.com", exp: Math.floor(Date.now() / 1000) + 3600 }));
  const encoded = payload.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `eyJhbGciOiJIUzI1NiJ9.${encoded}.test-signature`;
}

function renderAppAtDetail() {
  const rootRoute = router.routes[0];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/monitors/42"]}>
        <Routes>
          <Route element={rootRoute.element}>
            {rootRoute.children?.map((route, index) => (
              <Route key={`${route.path ?? "index"}-${index}`} path={route.path} element={route.element} />
            ))}
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("monitor history navigation", () => {
  beforeEach(() => tokenStore.clear());
  afterEach(() => {
    tokenStore.clear();
    server.resetHandlers();
  });

  it("links every monitor card to its history with a real href", () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ul><MonitorRow monitor={monitor} now={new Date("2025-01-15T10:00:00Z")} /></ul></QueryClientProvider>);
    expect(screen.getByRole("link", { name: "Primary API" })).toHaveAttribute("href", "/monitors/42");
  });

  it("redirects an unauthenticated visit to the full app login route", async () => {
    renderAppAtDetail();
    expect(await screen.findByRole("heading", { name: "Sign in to Sentinel" })).toBeInTheDocument();
  });

  it("mounts the authenticated detail through App routes, AuthProvider, and AppShell", async () => {
    tokenStore.set(validToken());
    server.use(
      http.get("/api/v1/monitors/", () => HttpResponse.json([monitor])),
      http.get("/api/v1/monitors/42/history", () => HttpResponse.json([])),
      http.get("/api/v1/monitors/42/alerts", () => HttpResponse.json([])),
    );

    renderAppAtDetail();

    expect(await screen.findByRole("heading", { name: "Primary API" })).toBeInTheDocument();
    expect(screen.getByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByText("No checks yet. The worker checks this monitor every 60 seconds.")).toBeInTheDocument();
  });
});

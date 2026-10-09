import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { makeJwt } from "../../test/jwt-fixture";
import { tokenStore } from "../../app/api/token";
import { AuthProvider } from "../../app/auth/AuthProvider";
import { LoginPage } from "../login/LoginPage";
import { StatusPage } from "./StatusPage";

const checkedAt = new Date(Date.now() - 60_000).toISOString();
const items = [{ name: "API", last_state: "healthy", uptime_percentage: 100, last_checked_at: checkedAt }];

function renderApp(path = "/status") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/status" element={<StatusPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<h1>Área protegida</h1>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("public status page", () => {
  beforeEach(() => tokenStore.clear());
  afterEach(() => { vi.useRealTimers(); tokenStore.clear(); });

  it("is reachable without auth outside the login page and never sends a stored token", async () => {
    tokenStore.set(makeJwt({ sub: "user", exp: 1_735_690_000 }));
    let authorization: string | null = "not requested";
    server.use(http.get("/api/v1/public/status", ({ request }) => {
      authorization = request.headers.get("authorization");
      return HttpResponse.json(items);
    }));
    renderApp();
    expect(await screen.findByRole("heading", { name: "System status" })).toBeInTheDocument();
    expect(await screen.findByText("API")).toBeInTheDocument();
    expect(authorization).toBeNull();
    expect(tokenStore.get()).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Sign in to Sentinel" })).not.toBeInTheDocument();
  });

  it("preserves the session and public route after an anonymous status 401", async () => {
    tokenStore.set(makeJwt({ sub: "user", exp: 1_735_690_000 }));
    server.use(http.get("/api/v1/public/status", () =>
      HttpResponse.json({ message: "Unauthorized" }, { status: 401 }),
    ));
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load service status");
    expect(tokenStore.get()).not.toBeNull();
    expect(screen.getByRole("heading", { name: "System status" })).toBeInTheDocument();
  });

  it("keeps /status public when a stored token is expired", async () => {
    tokenStore.set(makeJwt({ sub: "user", exp: 1 }));
    server.use(http.get("/api/v1/public/status", () => HttpResponse.json(items)));
    renderApp();
    expect(await screen.findByRole("heading", { name: "System status" })).toBeInTheDocument();
    expect(tokenStore.get()).not.toBeNull();
  });

  it("renders duplicate monitor names as distinct rows without duplicate-key warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(http.get("/api/v1/public/status", () => HttpResponse.json([
      { ...items[0], last_state: "healthy", uptime_percentage: 100 },
      { ...items[0], last_state: "unhealthy", uptime_percentage: 25 },
    ])));

    renderApp();

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Uptime: 100%"),
      expect.stringContaining("Uptime: 25%"),
    ]));
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Operational"),
      expect.stringContaining("Down"),
    ]));
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/unique.*key.*prop/i);
    consoleError.mockRestore();
  });

  it("shows English text labels and summary independent of color", async () => {
    server.use(http.get("/api/v1/public/status", () => HttpResponse.json([
      ...items,
      { name: "Database", last_state: "unhealthy", uptime_percentage: 50, last_checked_at: checkedAt },
    ])));
    renderApp();
    expect(await screen.findAllByText("Down")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "System status" })).toBeInTheDocument();
    expect(screen.getAllByRole("status", { name: /Down/ })).toHaveLength(2);
  });

  it("shows an explicit empty state", async () => {
    server.use(http.get("/api/v1/public/status", () => HttpResponse.json([])));
    renderApp();
    expect(await screen.findByText(/No public services are configured/)).toBeInTheDocument();
  });

  it("shows friendly loading and error states, including 429 retry guidance", async () => {
    server.use(http.get("/api/v1/public/status", () => new HttpResponse(null, { status: 429, headers: { "Retry-After": "12" } })));
    renderApp();
    expect(screen.getByText("Loading service status…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByRole("alert")).toHaveTextContent("12");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows a friendly message for non-rate-limit network errors", async () => {
    server.use(http.get("/api/v1/public/status", () => HttpResponse.error()));
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
    expect(screen.getByRole("alert").textContent).not.toContain("NetworkError");
  });

  it("keeps prior data and displays a warning when refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    let count = 0;
    server.use(http.get("/api/v1/public/status", () => {
      count += 1;
      return count === 1 ? HttpResponse.json(items) : HttpResponse.error();
    }));
    renderApp();
    expect(await screen.findByText("API")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(await screen.findByText(/Unable to update status/)).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(count).toBe(2);
  });

  it("reclassifies old server timestamps as stale as the clock advances", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const nearStale = new Date(Date.now() - 4 * 60_000 - 59_000).toISOString();
    let count = 0;
    server.use(http.get("/api/v1/public/status", () => {
      count += 1;
      return HttpResponse.json([{ ...items[0], last_checked_at: nearStale }]);
    }));
    renderApp();
    expect(await screen.findAllByText("Operational")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(await screen.findAllByText("No data")).toHaveLength(2);
    expect(count).toBe(2);
  });

  it("refreshes on a 30-second cadence and updates relative time independently", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    let count = 0;
    server.use(http.get("/api/v1/public/status", () => {
      count += 1;
      return HttpResponse.json(items);
    }));
    renderApp();
    await waitFor(() => expect(screen.getByText("API")).toBeInTheDocument());
    expect(screen.getByText("Last checked 1 minute ago")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await waitFor(() => expect(count).toBe(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText("Last checked 2 minutes ago")).toBeInTheDocument();
  });
});

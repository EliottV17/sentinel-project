import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { StatusPage } from "./StatusPage";

it("renders the public service overview in English with labeled status and reported uptime", async () => {
  server.use(http.get("/api/v1/public/status", () => HttpResponse.json([
    { name: "Public API", last_state: "healthy", uptime_percentage: 99.9, last_checked_at: new Date(Date.now() - 60_000).toISOString() },
  ])));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/status"]}><StatusPage /></MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "System status" })).toBeInTheDocument();
  expect(await screen.findByText("Uptime: 99.9%")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.getByRole("status", { name: "Status: All systems operational" })).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Status: Operational" })).toBeInTheDocument();
  expect(screen.queryByText(/Estado|verificación|servicios públicos/i)).not.toBeInTheDocument();
});

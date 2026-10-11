import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../../test/mocks/server";
import type { components } from "../../lib/api/schema";
import { MonitorsPage } from "./MonitorsPage";

type MonitorRead = components["schemas"]["MonitorRead"];

function monitor(id: number): MonitorRead {
  return {
    name: `api-${id}`, target: `https://api-${id}.example.com`, check_type: "http",
    check_config: { expected_status: 200, timeout: 10, method: "GET" }, frequency: 60,
    id, state: "Active", last_state: "healthy", last_checked_at: "2025-01-15T10:00:00",
    consecutive_failures: 0, created_at: "2025-01-15T09:00:00", user_id: 1,
  };
}

function setup(initial: MonitorRead[], afterDelete: MonitorRead[], status = 200) {
  let response = initial;
  server.use(
    http.get("*/api/v1/monitors/", () => HttpResponse.json(response)),
    http.delete("*/api/v1/monitors/:id", () => {
      if (status !== 200) return HttpResponse.json({ detail: "failed" }, { status });
      response = afterDelete;
      return HttpResponse.json({ detail: "deleted" });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MonitorsPage /></QueryClientProvider></MemoryRouter>);
}

async function confirmDelete(name: string) {
  await screen.findByRole("button", { name: `Delete ${name}` });
  fireEvent.click(screen.getByRole("button", { name: `Delete ${name}` }));
  const confirm = screen.getByRole("button", { name: `Confirm delete ${name}` });
  confirm.focus();
  fireEvent.keyDown(confirm, { key: "Enter" });
  fireEvent.click(confirm);
}

describe("successful monitor deletion focus", () => {
  it("restores focus to the visible heading after the last row is removed", async () => {
    setup([monitor(1)], []);
    await confirmDelete("api-1");
    await waitFor(() => expect(screen.queryByRole("link", { name: "api-1" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: "Monitors" })).toHaveFocus();
    expect(screen.getByText("No monitors yet.")).toBeInTheDocument();
  });

  it("does not steal focus moved elsewhere while deletion is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.delete("*/api/v1/monitors/:id", async () => {
      await gate;
      return HttpResponse.json({ detail: "deleted" });
    }));
    setup([monitor(1), monitor(2)], [monitor(2)]);
    await screen.findByRole("button", { name: "Delete api-1" });
    fireEvent.click(screen.getByRole("button", { name: "Delete api-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete api-1" }));
    const other = screen.getByRole("button", { name: "Delete api-2" });
    other.focus();
    release();
    await waitFor(() => expect(screen.queryByRole("link", { name: "api-1" })).not.toBeInTheDocument());
    expect(other).toHaveFocus();
  });

  it("leaves focus alone when deletion fails and the row remains", async () => {
    setup([monitor(1)], [monitor(1)], 500);
    await confirmDelete("api-1");
    expect(await screen.findByText("Could not delete the monitor — try again")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete api-1" })).toHaveFocus();
  });
});

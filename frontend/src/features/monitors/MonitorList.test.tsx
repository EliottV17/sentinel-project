import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { components } from "../../lib/api/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MonitorList } from "./MonitorList";

type MonitorRead = components["schemas"]["MonitorRead"];

const NOW = new Date("2025-01-15T10:00:00Z");

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
    last_checked_at: "2025-01-15T09:59:00",
    consecutive_failures: 0,
    created_at: "2025-01-15T09:00:00",
    user_id: 1,
    ...overrides,
  };
}

function renderList(monitors: MonitorRead[]) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <MonitorList monitors={monitors} now={NOW} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("MonitorList", () => {
  it("renders name, target, frequency and consecutive_failures", () => {
    renderList([
      monitor({
        name: "api",
        target: "https://api.example.com",
        frequency: 60,
        consecutive_failures: 2,
      }),
    ]);

    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("https://api.example.com")).toBeInTheDocument();
    expect(screen.getByText(/every 60s/)).toBeInTheDocument();
    expect(screen.getByText("Failures").parentElement?.parentElement).toHaveTextContent("Failures2 consecutive");
  });

  it("keeps long-name navigation separate from compact deletion and preserves stale context", () => {
    const name = "ProductionPaymentsGatewayWithoutWordBreaksForRegionalFailoverMonitoring";
    const target = "https://regional-payments.example.invalid/health/very-long-endpoint";
    renderList([monitor({ name, target, last_state: "unhealthy", last_checked_at: "2025-01-15T09:55:00" })]);

    expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/monitors/1");
    expect(screen.getByTitle(target)).toHaveTextContent(target);
    expect(screen.getByText("Unhealthy")).toHaveClass("bg-surface", "text-danger");
    expect(screen.getByText(/No recent check; last result is not current/)).toBeVisible();
    expect(screen.getByText("Last result: Unhealthy")).toBeVisible();

    const trigger = screen.getByRole("button", { name: `Delete ${name}` });
    expect(trigger.textContent).toBe("Delete");
    fireEvent.click(trigger);
    expect(screen.getByText(`Delete monitor ${name}?`)).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/monitors/1");
  });

  it("maps last_state only: healthy → green Healthy pill", () => {
    renderList([monitor({ last_state: "healthy" })]);
    const pill = screen.getByText("Healthy");
    expect(pill.className).toContain("bg-success-soft");
  });

  it("maps last_state only: unhealthy → red Unhealthy pill", () => {
    renderList([monitor({ last_state: "unhealthy", consecutive_failures: 3 })]);
    const pill = screen.getByText("Unhealthy");
    expect(pill).toHaveClass("bg-surface", "text-danger");
  });

  it("maps last_state null → muted 'Never checked' pill", () => {
    renderList([
      monitor({ last_state: null, last_checked_at: null, consecutive_failures: 0 }),
    ]);
    const pill = screen.getByText("Never checked");
    expect(pill.className).toContain("bg-raised");
    // A never-checked monitor is not "stale" — the pill already says it.
    expect(screen.queryByText(/engine may be down/i)).not.toBeInTheDocument();
  });

  it("never renders check_config", () => {
    renderList([
      monitor({
        check_config: {
          expected_status: 200,
          timeout: 10,
          method: "GET",
          secret_header: "hunter2",
        },
      }),
    ]);

    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
    expect(screen.queryByText(/expected_status/)).not.toBeInTheDocument();
    expect(screen.queryByText("GET")).not.toBeInTheDocument();
  });

  it("shows a non-causal stale hint when the last check is old", () => {
    renderList([monitor({ last_checked_at: "2025-01-15T09:55:00" })]);
    expect(screen.getByText(/No recent check; last result is not current/i)).toBeInTheDocument();
  });

  it("shows no freshness hint while checks are fresh", () => {
    // last check 30 s ago, frequency 60 → threshold 120 s → fresh.
    renderList([monitor({ last_checked_at: "2025-01-15T09:59:30" })]);
    expect(screen.queryByText(/engine may be down/i)).not.toBeInTheDocument();
  });

  it("adds a frequency tooltip for slow monitors", () => {
    renderList([monitor({ frequency: 300 })]);
    expect(screen.getByTitle("slow monitors are expected")).toBeInTheDocument();
  });

  it("adds no frequency tooltip for fast monitors", () => {
    renderList([monitor({ frequency: 10 })]);
    expect(
      screen.queryByTitle("slow monitors are expected"),
    ).not.toBeInTheDocument();
  });
});
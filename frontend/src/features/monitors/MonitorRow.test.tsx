import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { components } from "../../lib/api/schema";
import { MonitorRow } from "./MonitorRow";

type MonitorRead = components["schemas"]["MonitorRead"];
const NOW = new Date("2025-01-15T10:00:00Z");

function monitor(overrides: Partial<MonitorRead> = {}): MonitorRead {
  return {
    name: "A long monitor name",
    target: "https://example.com/a/very/long/path/that/should/remain/consultable?query=value",
    check_type: "http",
    check_config: { expected_status: 200, timeout: 10, method: "GET" },
    frequency: 60,
    id: 1,
    state: "Active",
    last_state: "healthy",
    last_checked_at: "2025-01-15T09:59:00",
    consecutive_failures: 2,
    created_at: "2025-01-15T09:00:00",
    user_id: 1,
    ...overrides,
  };
}

function renderRow(value: MonitorRead) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ul><MonitorRow monitor={value} now={NOW} /></ul>
    </QueryClientProvider>,
  );
}

describe("MonitorRow", () => {
  it("keeps the complete target available while bounding its displayed line", () => {
    renderRow(monitor());
    const target = screen.getByText(monitor().target);
    expect(target).toHaveClass("truncate");
    expect(target).toHaveAttribute("title", monitor().target);
  });

  it("does not report engine failure for a paused monitor and surfaces its previous result", () => {
    renderRow(monitor({ state: "Paused", last_state: "unhealthy", last_checked_at: "2025-01-15T09:50:00" }));
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Last result: Unhealthy")).toBeInTheDocument();
    expect(screen.queryByText(/engine may be down/i)).not.toBeInTheDocument();
  });

  it("preserves active freshness warning and operational details", () => {
    renderRow(monitor({ last_checked_at: "2025-01-15T09:55:00" }));
    expect(screen.getByText(/engine may be down/i)).toBeInTheDocument();
    expect(screen.getByText("every 60s")).toBeInTheDocument();
    expect(screen.getByText(/2\s+consecutive/)).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MonitorHistoryRow } from "../../../app/api/endpoints";
import { LatencyChart } from "./LatencyChart";

const rows: MonitorHistoryRow[] = [
  { id: 1, monitor_id: 7, state: "healthy", status_code: 200, latency_ms: 0, error_message: null, created_at: "2025-01-01T23:59:00Z" },
  { id: 2, monitor_id: 7, state: "unhealthy", status_code: 503, latency_ms: 8, error_message: "timeout", created_at: "2025-01-01T23:59:00Z" },
  { id: 3, monitor_id: 7, state: "healthy", status_code: 200, latency_ms: 15, error_message: null, created_at: "2025-01-02T00:02:00Z" },
];

describe("LatencyChart", () => {
  it("selects samples by keyboard through one native range control and announces full local detail", () => {
    render(<LatencyChart rows={rows} frequencySeconds={60} />);
    expect(screen.getByText(/table below lists all checks/)).toBeInTheDocument();
    const selector = screen.getByRole("slider", { name: /select check/i });
    expect(selector).toHaveAttribute("aria-valuetext", expect.stringContaining("Healthy check, 0 ms"));
    selector.focus();
    fireEvent.keyDown(selector, { key: "ArrowRight" });
    expect(screen.getByText(/Down check, 8 ms/)).toBeInTheDocument();
    fireEvent.keyDown(selector, { key: "End" });
    expect(screen.getByText(/Healthy check, 15 ms/)).toBeInTheDocument();
    fireEvent.keyDown(selector, { key: "Home" });
    expect(screen.getByRole("slider", { name: /select check/i })).toHaveValue("0");
    expect(screen.getByRole("img", { name: /latency history/i })).toHaveAccessibleDescription(/missing-samples heuristic/i);
    expect(selector).toHaveClass("h-11");
  });

  it("allows touch selection among coincident samples and distinguishes failed markers", () => {
    render(<LatencyChart rows={rows} frequencySeconds={null} />);
    fireEvent.click(screen.getByLabelText("Latency plot selection area"), { clientX: 628, clientY: 20 });
    expect(screen.getByText(/Healthy check, 15 ms/)).toBeInTheDocument();
    const selector = screen.getByRole("slider", { name: /select check/i });
    fireEvent.change(selector, { target: { value: "1" } });
    expect(screen.getByText(/Down check, 8 ms/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /latency history/i }).querySelector('[data-marker="failed-measured"]')).toBeInTheDocument();
  });

  it("explains the exact threshold and avoids schedules for invalid frequency", () => {
    const view = render(<LatencyChart rows={rows} frequencySeconds={60} />);
    expect(screen.getByText(/Use the plot or the 44-pixel-high/)).toHaveTextContent(/differ by more than 3× the current frequency \(frequency: 60 s; split threshold: > 180 s\)/);
    expect(screen.getByRole("img", { name: /latency history/i })).toHaveAccessibleDescription(/does not indicate downtime/i);
    view.rerender(<LatencyChart rows={rows} frequencySeconds={null} />);
    expect(screen.getByText(/Use the plot or the 44-pixel-high/)).toHaveTextContent(/No gap schedule is applied because the current frequency is unavailable or invalid/);
  });

  it("observes the stable chart container when initially empty and later populated", () => {
    let resize!: ResizeObserverCallback;
    let observed: Element | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe(element: Element) { observed = element; }
      disconnect() {}
      unobserve() {}
    });
    const view = render(<LatencyChart rows={[]} frequencySeconds={60} />);
    const container = observed;
    expect(container).toBeInstanceOf(HTMLElement);
    act(() => resize([{ contentRect: { width: 320 } } as ResizeObserverEntry], {} as ResizeObserver));
    view.rerender(<LatencyChart rows={rows} frequencySeconds={60} />);
    expect(observed).toBe(container);
    expect(screen.getByRole("img", { name: /latency history/i })).toHaveAttribute("viewBox", "0 0 320 220");
    vi.unstubAllGlobals();
  });

  it("distinguishes empty history from checks with no measured latency", () => {
    const { rerender } = render(<LatencyChart rows={[]} frequencySeconds={60} />);
    expect(screen.getByText(/No checks are available/)).toBeInTheDocument();
    rerender(<LatencyChart rows={[{ ...rows[0], latency_ms: null }]} frequencySeconds={60} />);
    expect(screen.getByText(/Checks are available, but none has a measured latency/)).toBeInTheDocument();
  });
});

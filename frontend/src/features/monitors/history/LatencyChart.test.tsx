import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MonitorHistoryRow } from "../../../app/api/endpoints";
import { LatencyChart } from "./LatencyChart";
import { buildLatencyChartGeometry } from "./chart-geometry";

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
    fireEvent.keyDown(selector, { key: "ArrowLeft" });
    expect(selector).toHaveValue("0");
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

  it("keeps task guidance brief and the missing-samples caveat outside collapsed calculation details", () => {
    const view = render(<LatencyChart rows={rows} frequencySeconds={60} />);
    const instructions = screen.getByText("Select a check using the plot or the slider below.");
    expect(instructions.closest("details")).toBeNull();
    expect(screen.queryByText(/44-pixel-high/)).not.toBeInTheDocument();
    const caveat = screen.getByText("Gaps mean missing samples, not confirmed downtime.");
    expect(caveat.closest("details")).toBeNull();
    const summary = screen.getByText("How to read this chart");
    expect(summary.tagName).toBe("SUMMARY");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(/differ by more than 3× the current frequency \(frequency: 60 s; split threshold: > 180 s\)/);
    expect(details).toHaveTextContent(/historical frequency changes are unknown/);
    expect(details).toHaveTextContent(/table below lists all checks, newest first/);
    expect(screen.getByRole("img", { name: /latency history/i })).toHaveAccessibleDescription(/does not indicate downtime/i);
    view.rerender(<LatencyChart rows={rows} frequencySeconds={null} />);
    expect(details).toHaveTextContent(/No gap schedule is applied because the current frequency is unavailable or invalid/);
    expect(caveat).toBeInTheDocument();
  });

  it.each([320, 390, 960])("reserves SVG space above the top tick at width %i without changing samples or segments", (width) => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
    const view = render(<LatencyChart rows={rows} frequencySeconds={60} />);
    const svg = screen.getByRole("img", { name: /latency history/i });
    const [, originY, , height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const unit = screen.getByText("ms");
    const geometry = buildLatencyChartGeometry(rows, 60, width);
    const topTick = screen.getByText(geometry.yTicks.at(-1)!.label, { selector: "text" });
    const unitBaseline = Number(unit.getAttribute("y"));
    expect(unitBaseline - 10).toBeGreaterThanOrEqual(originY);
    expect(Number(topTick.getAttribute("y")) - unitBaseline).toBeGreaterThanOrEqual(16);
    expect(originY + height).toBeGreaterThanOrEqual(220);
    expect([...svg.querySelectorAll("polyline")].map(line => line.getAttribute("points"))).toEqual(
      geometry.segments.map(segment => segment.map(point => `${point.x},${point.y}`).join(" ")),
    );
    expect([...svg.querySelectorAll('[data-marker="healthy-measured"]')].map(marker => [Number(marker.getAttribute("cx")), Number(marker.getAttribute("cy"))])).toEqual(
      geometry.points.filter(point => point.row.state === "healthy").map(point => [point.x, point.y]),
    );
    expect(svg.querySelector('[data-marker="failed-measured"]')).toHaveAttribute("y", String(geometry.points[1].y! - 4.5));
    view.unmount();
    vi.unstubAllGlobals();
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
    expect(screen.getByRole("img", { name: /latency history/i })).toHaveAttribute("viewBox", "0 -24 320 244");
    vi.unstubAllGlobals();
  });

  it("distinguishes empty history from checks with no measured latency", () => {
    const { rerender } = render(<LatencyChart rows={[]} frequencySeconds={60} />);
    expect(screen.getByText(/No checks are available/)).toBeInTheDocument();
    rerender(<LatencyChart rows={[{ ...rows[0], latency_ms: null }]} frequencySeconds={60} />);
    expect(screen.getByText(/Checks are available, but none has a measured latency/)).toBeInTheDocument();
  });
});

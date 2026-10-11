import { describe, expect, it } from "vitest";
import { buildLatencyChartGeometry } from "./chart-geometry";

const row = (id: number, at: string, latency: number | null = 10, state = "healthy") => ({
  id, monitor_id: 7, state, status_code: state === "unhealthy" ? 503 : 200,
  latency_ms: latency, error_message: null, created_at: at,
});
const base = Date.parse("2025-01-01T23:59:00Z");
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();

describe("buildLatencyChartGeometry", () => {
  it("sorts chronologically and spaces points by elapsed timestamps, including equal times", () => {
    const geometry = buildLatencyChartGeometry([row(3, at(90_000)), row(1, at(0)), row(2, at(0))], 60, 400);
    expect(geometry.points.map(({ row: item }) => item.id)).toEqual([1, 2, 3]);
    expect(geometry.points.map(({ x }) => x)).toEqual([geometry.left, geometry.left, geometry.right]);
    expect(geometry.xTicks.map(({ label }) => label)).toContain("Jan 2");
  });

  it("centers every valid sample and uses one centered tick when valid timestamps are equal", () => {
    const geometry = buildLatencyChartGeometry([row(2, at(0)), row(1, at(0))], 60, 640);
    expect(geometry.points.map(({ x }) => x)).toEqual([(geometry.left + geometry.right) / 2, (geometry.left + geometry.right) / 2]);
    expect(geometry.xTicks).toHaveLength(1);
    expect(geometry.xTicks[0].position).toBe((geometry.left + geometry.right) / 2);
  });

  it("has no time ticks when every timestamp is invalid", () => {
    const geometry = buildLatencyChartGeometry([row(1, "invalid"), row(2, "also invalid")], 60, 640);
    expect(geometry.xTicks).toEqual([]);
  });

  it("splits strictly beyond three current frequencies, not at the threshold", () => {
    const equality = buildLatencyChartGeometry([row(1, at(0)), row(2, at(180))], 60, 640);
    const exceeded = buildLatencyChartGeometry([row(1, at(0)), row(2, at(181))], 60, 640);
    expect(equality.gaps).toHaveLength(0);
    expect(equality.segments).toHaveLength(1);
    expect(exceeded.gaps).toHaveLength(1);
    expect(exceeded.gaps[0].label).toBe("No samples");
    expect(exceeded.gaps[0].durationMs).toBe(181_000);
    expect(exceeded.gaps[0].thresholdMs).toBe(180_000);
    expect(exceeded.segments).toHaveLength(2);
    expect(buildLatencyChartGeometry([row(1, at(0)), row(2, at(10_000))], null, 640).gaps).toHaveLength(0);
  });

  it("breaks on unavailable latency, retains zero and failed measured duration, and handles empty/single data", () => {
    const geometry = buildLatencyChartGeometry([
      row(1, at(0), 0), row(2, at(1), null), row(3, at(2), 25, "unhealthy"), row(4, at(3), Number.NaN),
    ], null, 640);
    expect(geometry.points).toHaveLength(4);
    expect(geometry.segments).toHaveLength(2);
    expect(geometry.points[0].y).toBe(geometry.bottom);
    expect(geometry.points[2].row.latency_ms).toBe(25);
    expect(buildLatencyChartGeometry([row(5, at(5), null)], 60, 640).yTicks).toEqual([]);
    expect(buildLatencyChartGeometry([], null, 640).points).toEqual([]);
    const single = buildLatencyChartGeometry([row(1, at(0), 4)], 0, 640);
    expect(single.points[0].x).toBe((single.left + single.right) / 2);
    expect(single.yTicks.length).toBeGreaterThan(0);
  });

  it("adapts tick density to available width and treats invalid timestamps as breaks", () => {
    const rows = [row(1, at(0)), row(2, "bad"), row(3, at(3600))];
    const narrow = buildLatencyChartGeometry(rows, undefined, 180);
    const wide = buildLatencyChartGeometry(rows, undefined, 900);
    expect(narrow.xTicks.length).toBeLessThan(wide.xTicks.length);
    expect(narrow.points.some(({ timestamp }) => timestamp === null)).toBe(true);
  });
});

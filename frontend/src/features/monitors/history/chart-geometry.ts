import type { MonitorHistoryRow } from "../../../app/api/endpoints";

export interface ChartPoint {
  row: MonitorHistoryRow;
  x: number;
  y: number | null;
  timestamp: number | null;
}

export interface ChartTick { value: number; position: number; label: string }
export interface ChartGap { x: number; durationMs: number; thresholdMs: number; label: "No samples" }
export interface LatencyChartGeometry {
  left: number;
  right: number;
  top: number;
  bottom: number;
  points: ChartPoint[];
  segments: ChartPoint[][];
  gaps: ChartGap[];
  xTicks: ChartTick[];
  yTicks: ChartTick[];
}

const HEIGHT = 220;
const LEFT = 54;
const RIGHT_PAD = 12;
const TOP = 14;
const BOTTOM_PAD = 40;

function niceStep(range: number, targetCount: number): number {
  if (!(range > 0)) return 1;
  const rough = range / Math.max(1, targetCount - 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

function timeLabel(timestamp: number, span: number): string {
  const date = new Date(timestamp);
  return span >= 86_400_000
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function buildLatencyChartGeometry(
  rows: readonly MonitorHistoryRow[],
  frequencySeconds: number | null | undefined,
  availableWidth: number,
): LatencyChartGeometry {
  const left = LEFT;
  const right = Math.max(left + 1, availableWidth - RIGHT_PAD);
  const top = TOP;
  const bottom = HEIGHT - BOTTOM_PAD;
  const ordered = rows.map((row, index) => ({ row, index, timestamp: Date.parse(row.created_at) }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.timestamp);
      const bValid = Number.isFinite(b.timestamp);
      if (aValid && bValid) return a.timestamp - b.timestamp || a.row.id - b.row.id;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return a.index - b.index;
    });
  const times = ordered.filter((item) => Number.isFinite(item.timestamp)).map((item) => item.timestamp);
  const first = times[0] ?? 0;
  const last = times.at(-1) ?? first;
  const span = last - first;
  const measured = ordered.map(({ row }) => row.latency_ms)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const max = Math.max(0, ...measured);
  const step = niceStep(max || 1, 4);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const y = (value: number) => bottom - (value / yMax) * (bottom - top);
  const points: ChartPoint[] = ordered.map(({ row, timestamp }) => {
    const validTime = Number.isFinite(timestamp);
    const x = !validTime ? left : span > 0
      ? left + ((timestamp - first) / span) * (right - left)
      : (left + right) / 2;
    const latency = row.latency_ms;
    return { row, x, y: latency !== null && Number.isFinite(latency) ? y(latency) : null, timestamp: validTime ? timestamp : null };
  });
  const threshold = Number.isFinite(frequencySeconds) && (frequencySeconds ?? 0) > 0
    ? (frequencySeconds as number) * 3_000 : null;
  const segments: ChartPoint[][] = [];
  const gaps: ChartGap[] = [];
  let segment: ChartPoint[] = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const elapsed = previous?.timestamp !== null && point.timestamp !== null && previous
      ? point.timestamp - previous.timestamp : null;
    const gap = threshold !== null && elapsed !== null && elapsed > threshold;
    if (point.y === null || point.timestamp === null || gap) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (gap && threshold !== null && elapsed !== null) {
      gaps.push({ x: (previous.x + point.x) / 2, durationMs: elapsed, thresholdMs: threshold, label: "No samples" });
    }
    if (point.y !== null && point.timestamp !== null) segment.push(point);
  });
  if (segment.length) segments.push(segment);

  const xTicks: ChartTick[] = [];
  if (times.length > 0) {
    if (span === 0) {
      xTicks.push({ value: first, position: (left + right) / 2, label: timeLabel(first, span) });
    } else {
      const tickCount = Math.max(2, Math.floor((right - left) / 110));
      for (let index = 0; index < tickCount; index += 1) {
        const ratio = index / (tickCount - 1);
        const timestamp = first + span * ratio;
        xTicks.push({ value: timestamp, position: left + (right - left) * ratio, label: timeLabel(timestamp, span) });
      }
    }
  }
  const yTicks: ChartTick[] = [];
  if (measured.length > 0) {
    for (let value = 0; value <= yMax; value += step) {
      yTicks.push({ value, position: y(value), label: `${Number(value.toPrecision(4))}` });
    }
  }
  return { left, right, top, bottom, points, segments, gaps, xTicks, yTicks };
}

export const LATENCY_CHART_HEIGHT = HEIGHT;

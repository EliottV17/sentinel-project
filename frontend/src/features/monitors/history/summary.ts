import type { MonitorHistoryRow } from "../../../app/api/endpoints";

export interface MonitorHistorySummary {
  loadedCount: number;
  healthyPercentage: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
}

/**
 * Summarizes only the rows actually loaded. Healthy percentage is not an uptime
 * estimate. Latencies ignore null and non-finite values; median averages the
 * two center values for even samples, while p95 uses nearest-rank (ceil(.95*n)).
 */
export function summarizeMonitorHistory(
  rows: readonly MonitorHistoryRow[],
): MonitorHistorySummary {
  const healthyCount = rows.filter((row) => row.state === "healthy").length;
  const latencies = rows
    .map((row) => row.latency_ms)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const middle = Math.floor(latencies.length / 2);
  const medianLatencyMs =
    latencies.length === 0
      ? null
      : latencies.length % 2 === 0
        ? (latencies[middle - 1] + latencies[middle]) / 2
        : latencies[middle];
  const p95LatencyMs =
    latencies.length === 0
      ? null
      : latencies[Math.ceil(0.95 * latencies.length) - 1];

  return {
    loadedCount: rows.length,
    healthyPercentage: rows.length === 0 ? null : (healthyCount / rows.length) * 100,
    medianLatencyMs,
    p95LatencyMs,
  };
}

/** Returns a chronological copy; null latency stays null for T2's chart model. */
export function chronologicalHistory(
  rows: readonly MonitorHistoryRow[],
): MonitorHistoryRow[] {
  return [...rows].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
  );
}

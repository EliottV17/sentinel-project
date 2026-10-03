import { describe, expect, it } from "vitest";
import { classifyStatus, summarizeStatus, type PublicStatusMonitor } from "./status";

const now = new Date("2025-01-01T12:00:00.000Z");
const monitor = (
  values: Partial<PublicStatusMonitor> = {},
): PublicStatusMonitor => ({
  name: "API",
  last_state: "healthy",
  uptime_percentage: 100,
  last_checked_at: new Date(now.getTime() - 60_000).toISOString(),
  ...values,
});

describe("public status classification", () => {
  it.each([
    ["missing state", monitor({ last_state: null }), "Sin datos"],
    ["unknown state", monitor({ last_state: "paused" }), "Sin datos"],
    ["missing timestamp", monitor({ last_checked_at: null }), "Sin datos"],
    ["invalid timestamp", monitor({ last_checked_at: "not a date" }), "Sin datos"],
    ["future timestamp", monitor({ last_checked_at: "2025-01-01T12:01:00.000Z" }), "Sin datos"],
    ["exact staleness boundary", monitor({ last_checked_at: "2025-01-01T11:55:00.000Z" }), "Operacional"],
    ["stale healthy", monitor({ last_checked_at: "2025-01-01T11:54:59.999Z" }), "Sin datos"],
    ["stale unhealthy", monitor({ last_state: "unhealthy", last_checked_at: "2025-01-01T11:54:59.999Z" }), "Sin datos"],
    ["fresh unhealthy", monitor({ last_state: "unhealthy", uptime_percentage: null }), "Caído"],
    ["healthy without samples", monitor({ uptime_percentage: null }), "Sin datos"],
    ["below degradation threshold", monitor({ uptime_percentage: 98.99 }), "Degradado"],
    ["threshold boundary", monitor({ uptime_percentage: 99 }), "Operacional"],
    ["missing uptime", monitor({ uptime_percentage: undefined }), "Sin datos"],
    ["invalid uptime", monitor({ uptime_percentage: Number.NaN }), "Sin datos"],
  ] as const)("classifies %s", (_name, input, expected) => {
    expect(classifyStatus(input, { now })).toBe(expected);
  });

  it("uses configurable staleness and degradation thresholds", () => {
    expect(classifyStatus(monitor({ uptime_percentage: 98 }), {
      now,
      staleAfterMinutes: 10,
      degradedThresholdPercent: 98,
    })).toBe("Operacional");
  });

  it("summarizes the worst known severity: down, degraded, no-data, operational", () => {
    expect(summarizeStatus([monitor(), monitor({ last_state: "unhealthy" }), monitor({ name: "Lagging", last_checked_at: null })], { now }))
      .toEqual({ label: "Caído", allOperational: false });
    expect(summarizeStatus([monitor(), monitor({ name: "Slow", uptime_percentage: 90 })], { now }))
      .toEqual({ label: "Degradado", allOperational: false });
    expect(summarizeStatus([monitor(), monitor({ name: "Unknown", last_checked_at: null })], { now }))
      .toEqual({ label: "Sin datos", allOperational: false });
    expect(summarizeStatus([monitor(), monitor({ name: "Other" })], { now }))
      .toEqual({ label: "Todos los sistemas operativos", allOperational: true });
    expect(summarizeStatus([], { now })).toEqual({ label: "Sin datos", allOperational: false });
  });
});

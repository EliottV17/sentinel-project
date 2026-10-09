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
    ["missing state", monitor({ last_state: null }), "No data"],
    ["unknown state", monitor({ last_state: "paused" }), "No data"],
    ["missing timestamp", monitor({ last_checked_at: null }), "No data"],
    ["invalid timestamp", monitor({ last_checked_at: "not a date" }), "No data"],
    ["future timestamp", monitor({ last_checked_at: "2025-01-01T12:01:00.000Z" }), "No data"],
    ["exact staleness boundary", monitor({ last_checked_at: "2025-01-01T11:55:00.000Z" }), "Operational"],
    ["stale healthy", monitor({ last_checked_at: "2025-01-01T11:54:59.999Z" }), "No data"],
    ["stale unhealthy", monitor({ last_state: "unhealthy", last_checked_at: "2025-01-01T11:54:59.999Z" }), "No data"],
    ["fresh unhealthy", monitor({ last_state: "unhealthy", uptime_percentage: null }), "Down"],
    ["healthy without samples", monitor({ uptime_percentage: null }), "No data"],
    ["below degradation threshold", monitor({ uptime_percentage: 98.99 }), "Degraded"],
    ["threshold boundary", monitor({ uptime_percentage: 99 }), "Operational"],
    ["missing uptime", monitor({ uptime_percentage: undefined }), "No data"],
    ["invalid uptime", monitor({ uptime_percentage: Number.NaN }), "No data"],
  ] as const)("classifies %s", (_name, input, expected) => {
    expect(classifyStatus(input, { now })).toBe(expected);
  });

  it("uses configurable staleness and degradation thresholds", () => {
    expect(classifyStatus(monitor({ uptime_percentage: 98 }), {
      now,
      staleAfterMinutes: 10,
      degradedThresholdPercent: 98,
    })).toBe("Operational");
  });

  it("summarizes the worst known severity: down, degraded, no-data, operational", () => {
    expect(summarizeStatus([monitor(), monitor({ last_state: "unhealthy" }), monitor({ name: "Lagging", last_checked_at: null })], { now }))
      .toEqual({ label: "Down", allOperational: false });
    expect(summarizeStatus([monitor(), monitor({ name: "Slow", uptime_percentage: 90 })], { now }))
      .toEqual({ label: "Degraded", allOperational: false });
    expect(summarizeStatus([monitor(), monitor({ name: "Unknown", last_checked_at: null })], { now }))
      .toEqual({ label: "No data", allOperational: false });
    expect(summarizeStatus([monitor(), monitor({ name: "Other" })], { now }))
      .toEqual({ label: "All systems operational", allOperational: true });
    expect(summarizeStatus([], { now })).toEqual({ label: "No data", allOperational: false });
  });
});

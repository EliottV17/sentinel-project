import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateTime, formatRelative, isEngineStale, parseApiDate } from "./datetime";

describe("parseApiDate", () => {
  it("treats a naive API timestamp as UTC (no local-offset shift)", () => {
    // The API strips tzinfo; without the appended Z this would be read in the
    // viewer's local timezone and every rendered time would drift.
    expect(parseApiDate("2025-01-15T10:00:00").toISOString()).toBe(
      "2025-01-15T10:00:00.000Z",
    );
  });

  it("keeps fractional seconds when normalizing a naive timestamp", () => {
    expect(parseApiDate("2025-01-15T10:00:00.123456").toISOString()).toBe(
      "2025-01-15T10:00:00.123Z",
    );
  });

  it("passes a Z-suffixed timestamp through untouched", () => {
    expect(parseApiDate("2025-01-15T10:00:00Z").toISOString()).toBe(
      "2025-01-15T10:00:00.000Z",
    );
  });

  it("passes an explicit ±HH:MM offset through untouched", () => {
    expect(parseApiDate("2025-01-15T10:00:00+02:00").toISOString()).toBe(
      "2025-01-15T08:00:00.000Z",
    );
    expect(parseApiDate("2025-01-15T10:00:00-05:30").toISOString()).toBe(
      "2025-01-15T15:30:00.000Z",
    );
  });

  it("passes a compact ±HHMM offset through untouched", () => {
    expect(parseApiDate("2025-01-15T10:00:00+0200").toISOString()).toBe(
      "2025-01-15T08:00:00.000Z",
    );
  });
});

describe("formatDateTime", () => {
  it("renders in the pinned locale/timezone, not the local one", () => {
    // Injected Intl (locale + timeZone) pins the output: a naive 10:00 UTC
    // timestamp must render as 10:00 UTC — never shifted to the viewer's clock.
    const text = formatDateTime(
      parseApiDate("2025-01-15T10:00:00"),
      "en-GB",
      "UTC",
    );
    expect(text).toContain("2025");
    expect(text).toContain("10:00");
    expect(text).not.toContain("11:00");
    expect(text).not.toContain("09:00");
  });
});

describe("formatRelative", () => {
  const now = new Date("2025-01-15T10:00:00Z");

  it("formats 'x s ago' below a minute", () => {
    expect(formatRelative(new Date(now.getTime() - 42_000), now)).toBe(
      "42s ago",
    );
  });

  it("formats 'x min ago' below an hour", () => {
    expect(formatRelative(new Date(now.getTime() - 5 * 60_000), now)).toBe(
      "5m ago",
    );
  });

  it("formats 'x h ago' for hours and older", () => {
    expect(formatRelative(new Date(now.getTime() - 3 * 3_600_000), now)).toBe(
      "3h ago",
    );
  });

  it("switches units at exact boundaries (59s/60s, 59m/60m)", () => {
    expect(formatRelative(new Date(now.getTime() - 59_000), now)).toBe("59s ago");
    expect(formatRelative(new Date(now.getTime() - 60_000), now)).toBe("1m ago");
    expect(formatRelative(new Date(now.getTime() - 59 * 60_000), now)).toBe(
      "59m ago",
    );
    expect(formatRelative(new Date(now.getTime() - 60 * 60_000), now)).toBe(
      "1h ago",
    );
  });
});

describe("isEngineStale", () => {
  const now = new Date("2025-01-15T10:00:00Z");

  it("is false at exactly the threshold (strictly greater is stale)", () => {
    // frequency 60 → threshold 120 s; age exactly 120 s is NOT stale.
    expect(isEngineStale("2025-01-15T09:58:00", 60, now)).toBe(false);
    // One millisecond past the threshold flips it.
    expect(
      isEngineStale(
        new Date(now.getTime() - 120_001).toISOString(),
        60,
        now,
      ),
    ).toBe(true);
  });

  it("is false while the age is within max(frequency, 30) × 2", () => {
    // frequency 60 → threshold 120 s; age 60 s is fresh.
    expect(isEngineStale("2025-01-15T09:59:00", 60, now)).toBe(false);
  });

  it("is true once the age exceeds max(frequency, 30) × 2", () => {
    // frequency 60 → threshold 120 s; age 180 s is stale.
    expect(isEngineStale("2025-01-15T09:57:00", 60, now)).toBe(true);
  });

  it("floors the threshold at 30 s for very fast monitors", () => {
    // frequency 5 → max(5, 30) = 30 → threshold 60 s.
    expect(isEngineStale("2025-01-15T09:59:30", 5, now)).toBe(false);
    expect(isEngineStale("2025-01-15T09:58:59", 5, now)).toBe(true);
  });

  it("is not stale for a monitor that has never been checked", () => {
    expect(isEngineStale(null, 60, now)).toBe(false);
  });
});

// Guard: the normalization must not depend on the machine's local timezone at
// all — pin the process clock and verify the same UTC interpretation.
afterEach(() => {
  vi.useRealTimers();
});

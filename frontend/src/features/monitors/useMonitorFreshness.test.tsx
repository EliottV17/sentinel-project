import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMonitorFreshness } from "./useMonitorFreshness";

afterEach(() => vi.useRealTimers());

describe("useMonitorFreshness", () => {
  it("uses the stale result's 30-second relative-time cadence, not a 1ms timer", () => {
    vi.useFakeTimers();
    const checkedAt = new Date("2025-01-15T10:00:00Z");
    vi.setSystemTime(checkedAt);
    const timeout = vi.spyOn(window, "setTimeout");
    const { result } = renderHook(() => useMonitorFreshness(checkedAt.toISOString(), 60, true));

    expect(result.current.stale).toBe(false);
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.stale).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stale).toBe(true);
    expect(timeout.mock.calls.at(-1)?.[1]).toBe(30_000);
  });

  it("does not schedule a near-zero timer for paused or invalid timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
    const timeout = vi.spyOn(window, "setTimeout");
    const { rerender } = renderHook(({ timestamp, active }) => useMonitorFreshness(timestamp, 60, active), {
      initialProps: { timestamp: "2025-01-15T09:00:00Z", active: false },
    });
    expect(timeout.mock.calls.at(-1)?.[1]).toBe(30_000);
    rerender({ timestamp: "not-a-date", active: true });
    expect(timeout.mock.calls.at(-1)?.[1]).toBe(30_000);
  });

  it("keeps suppliedNow deterministic without scheduling a timer", () => {
    vi.useFakeTimers();
    const checkedAt = new Date("2025-01-15T10:00:00Z");
    vi.setSystemTime(checkedAt);
    const { result, rerender } = renderHook(({ now }) => useMonitorFreshness(checkedAt.toISOString(), 60, true, now), {
      initialProps: { now: checkedAt },
    });
    expect(result.current.stale).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(120_001); });
    expect(result.current.stale).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ now: new Date(Date.now()) });
    expect(result.current.stale).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reschedules when inputs change and clears its timer on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { rerender, unmount } = renderHook(({ timestamp, frequency, active }) => useMonitorFreshness(timestamp, frequency, active), {
      initialProps: { timestamp: "2025-01-15T09:59:00Z", frequency: 60, active: true },
    });
    rerender({ timestamp: "2025-01-15T09:58:00Z", frequency: 120, active: true });
    expect(clearTimeoutSpy).toHaveBeenCalled();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
  });
});

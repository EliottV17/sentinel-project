import { useEffect, useState } from "react";
import { isEngineStale, parseApiDate } from "../../lib/datetime";

const MAX_CLOCK_UPDATE_MS = 30_000;

/** Re-evaluate local freshness at its exact boundary without polling the API. */
export function useMonitorFreshness(
  lastCheckedAt: string | null,
  frequencySeconds: number,
  enabled: boolean,
  suppliedNow?: Date,
): { now: Date; stale: boolean } {
  const [clock, setClock] = useState(() => suppliedNow ?? new Date());
  const now = suppliedNow ?? clock;

  useEffect(() => {
    if (suppliedNow) return;
    const checkedAt = lastCheckedAt === null ? Number.NaN : parseApiDate(lastCheckedAt).getTime();
    const ageExpiry = checkedAt + Math.max(frequencySeconds, 30) * 2_000 + 1;
    const remaining = ageExpiry - Date.now();
    const delay = enabled && Number.isFinite(checkedAt) && remaining > 0
      ? Math.min(MAX_CLOCK_UPDATE_MS, remaining)
      : MAX_CLOCK_UPDATE_MS;
    const timer = window.setTimeout(() => setClock(new Date()), delay);
    return () => window.clearTimeout(timer);
  }, [lastCheckedAt, frequencySeconds, enabled, suppliedNow, clock]);

  return { now, stale: enabled && isEngineStale(lastCheckedAt, frequencySeconds, now) };
}

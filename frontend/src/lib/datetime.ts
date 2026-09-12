/**
 * Naive-UTC timestamp normalization — the single chokepoint every render path
 * must use for API datetimes.
 *
 * The API strips tzinfo, so a bare `2025-01-15T10:00:00` string means 10:00
 * UTC. `new Date(...)` would silently read it in the viewer's local timezone;
 * appending `Z` when no timezone designator is present is the one correct
 * interpretation.
 */

/** Matches a trailing `Z`/`z` or `±HH:MM`/`±HHMM` offset. */
const TZ_DESIGNATOR = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

export function parseApiDate(value: string): Date {
  return new Date(TZ_DESIGNATOR.test(value) ? value : `${value}Z`);
}

/**
 * Format with the user's locale and timezone. `locale`/`timeZone` are
 * injectable so tests can pin the output (default: the environment's own).
 */
export function formatDateTime(
  date: Date,
  locale?: string,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  }).format(date);
}

/** "x s/min/h ago" relative to an injectable `now`. */
export function formatRelative(date: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * True when the last check is older than `max(frequency, 30) × 2` seconds —
 * the "checking engine may be down" freshness hint. Derived from data, never
 * from alerts. A monitor that has never been checked is not "stale" (the
 * "Never checked" pill already communicates it).
 */
export function isEngineStale(
  lastCheckedAt: string | null,
  frequencySeconds: number,
  now: Date,
): boolean {
  if (lastCheckedAt === null) {
    return false;
  }
  const thresholdSeconds = Math.max(frequencySeconds, 30) * 2;
  const ageSeconds = (now.getTime() - parseApiDate(lastCheckedAt).getTime()) / 1000;
  return ageSeconds > thresholdSeconds;
}

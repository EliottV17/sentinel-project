import type { components } from "../../lib/api/schema";
import { formatDateTime, formatRelative, isEngineStale, parseApiDate } from "../../lib/datetime";
import { DeleteButton } from "./DeleteButton";
import { StatusPill } from "./StatusPill";

type MonitorRead = components["schemas"]["MonitorRead"];

/** Slow-monitor threshold: tooltips only appear above this frequency (s). */
const SLOW_FREQUENCY_SECONDS = 30;

export function MonitorRow({ monitor, now }: { monitor: MonitorRead; now: Date }) {
  const lastCheckedAt = monitor.last_checked_at;
  const stale = isEngineStale(lastCheckedAt, monitor.frequency, now);
  const parsed = lastCheckedAt !== null ? parseApiDate(lastCheckedAt) : null;
  const slow = monitor.frequency > SLOW_FREQUENCY_SECONDS;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{monitor.name}</span>
        <StatusPill lastState={monitor.last_state} />
      </div>
      <p className="mt-1 truncate font-mono text-sm text-slate-600">
        {monitor.target}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {slow ? (
          <span title="slow monitors are expected">every {monitor.frequency}s</span>
        ) : (
          <span>every {monitor.frequency}s</span>
        )}
        <span>{monitor.consecutive_failures} consecutive failures</span>
        {parsed !== null && (
          <span>
            last checked {formatRelative(parsed, now)} (
            {formatDateTime(parsed)})
          </span>
        )}
        {stale && (
          <span className="text-amber-600">
            no recent check — engine may be down
          </span>
        )}
        <DeleteButton monitorId={monitor.id} monitorName={monitor.name} />
      </div>
    </li>
  );
}
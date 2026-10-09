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
    <li className="rounded-panel border border-line bg-surface p-5 shadow-panel transition duration-150 hover:border-line-strong hover:shadow-glow sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <a href={`/monitors/${monitor.id}`} className="font-semibold text-ink hover:text-accent focus-visible:outline-accent">{monitor.name}</a>
          <p className="mt-1 truncate font-mono text-xs text-muted">{monitor.target}</p>
        </div>
        <StatusPill lastState={monitor.last_state} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Check frequency</p>
          <p className="text-sm text-ink" title={slow ? "slow monitors are expected" : undefined}>every {monitor.frequency}s</p>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Consecutive failures</p>
          <p className="text-sm text-ink">{monitor.consecutive_failures} consecutive failures</p>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Last checked</p>
          <p className="text-sm text-ink">
            {parsed !== null ? <span title={formatDateTime(parsed)}>{formatRelative(parsed, now)}</span> : "No checks yet"}
          </p>
        </div>
      </div>
      {stale && (
        <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <span aria-hidden="true">!</span> no recent check — engine may be down
        </p>
      )}
      <div className="mt-4 flex justify-end border-t border-line pt-3">
        <DeleteButton monitorId={monitor.id} monitorName={monitor.name} />
      </div>
    </li>
  );
}

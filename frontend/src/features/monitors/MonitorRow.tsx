import { Link } from "react-router-dom";
import type { components } from "../../lib/api/schema";
import { formatDateTime, formatRelative, parseApiDate } from "../../lib/datetime";
import { DeleteButton } from "./DeleteButton";
import { StatusPill } from "./StatusPill";
import { useMonitorFreshness } from "./useMonitorFreshness";

type MonitorRead = components["schemas"]["MonitorRead"];

/** Slow-monitor threshold: tooltips only appear above this frequency (s). */
const SLOW_FREQUENCY_SECONDS = 30;

export function MonitorRow({
  monitor,
  now: suppliedNow,
  onDeleteSuccess,
}: {
  monitor: MonitorRead;
  now?: Date;
  onDeleteSuccess?: (monitorId: number) => void;
}) {
  const lastCheckedAt = monitor.last_checked_at;
  const freshness = useMonitorFreshness(lastCheckedAt, monitor.frequency, monitor.state === "Active", suppliedNow);
  const now = freshness.now;
  const stale = freshness.stale;
  const parsed = lastCheckedAt !== null ? parseApiDate(lastCheckedAt) : null;
  const slow = monitor.frequency > SLOW_FREQUENCY_SECONDS;

  return (
    <li className="min-w-0 rounded-panel border border-line bg-surface p-4 shadow-panel transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-glow sm:p-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 sm:gap-4">
        <div className="min-w-0 flex-1 basis-32">
          <Link to={`/monitors/${monitor.id}`} className="flex min-h-11 max-w-full items-center font-semibold text-ink transition duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><span className="min-w-0 break-words">{monitor.name}</span></Link>
          <p title={monitor.target} className="mt-1 max-w-full truncate font-mono text-xs text-muted">{monitor.target}</p>
        </div>
        <StatusPill state={monitor.state} lastState={monitor.last_state} />
      </div>
      <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 border-t border-line pt-3 sm:mt-5 sm:grid-cols-3 sm:gap-4 sm:pt-4">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Frequency</p>
          <p className="text-sm text-ink" title={slow ? "slow monitors are expected" : undefined}>every {monitor.frequency}s</p>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Failures</p>
          <p className="break-words text-sm text-ink">{monitor.consecutive_failures} consecutive</p>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Last checked</p>
          <p className="text-sm text-ink">
            {parsed !== null ? <span title={formatDateTime(parsed)}>{formatRelative(parsed, now)}</span> : "No checks yet"}
          </p>
        </div>
      </div>
      {stale && (
        <p role="status" className="mt-3 inline-flex max-w-full items-center gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
          <span aria-hidden="true">!</span> No recent check; last result is not current
        </p>
      )}
      <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/70 pt-2 sm:mt-4 sm:pt-3">
        {(monitor.state === "Paused" || monitor.last_state !== null) ? (
          <p className="min-w-0 break-words text-xs text-muted">
            {monitor.state === "Paused" ? "Previous result" : "Last result"}: {monitor.last_state === "healthy" ? "Healthy" : monitor.last_state === "unhealthy" ? "Unhealthy" : "No checks yet"}
          </p>
        ) : <span />}
        <DeleteButton monitorId={monitor.id} monitorName={monitor.name} onDeleteSuccess={onDeleteSuccess} />
      </div>
    </li>
  );
}

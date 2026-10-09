import { CreateMonitorForm } from "./CreateMonitorForm";
import { MonitorList } from "./MonitorList";
import { useMonitors } from "./useMonitors";
import { Spinner } from "../../components/Spinner";
import { ApiError } from "../../app/api/client";

function initialErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many requests. Please wait before refreshing your monitors.";
    if (error.status === 401) return "Your session has expired. Sign in again to load your monitors.";
    if (error.status === 403 || error.status === 404) return "Your monitors are not available. Try signing in again.";
    if (error.status >= 500) return "The monitor service is temporarily unavailable. Try again in a moment.";
  }
  return "Unable to load monitors. Check your connection and try again.";
}

function MetricIcon({ kind }: { kind: "total" | "healthy" | "attention" }) {
  if (kind === "total") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5s1.1-6.2 3.3-8.5Z" /></svg>;
  }
  if (kind === "healthy") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5" aria-hidden="true"><path d="m5 12.5 4.4 4.2L19 7.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="9" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5" aria-hidden="true"><path d="M12 8v5m0 3h.01" strokeLinecap="round" /><path d="m10.3 3.9-8 14A1.4 1.4 0 0 0 3.5 20h17a1.4 1.4 0 0 0 1.2-2.1l-8-14a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" /></svg>;
}

function MetricCard({
  label,
  value,
  detail,
  kind,
}: {
  label: string;
  value: string;
  detail: string;
  kind: "total" | "healthy" | "attention";
}) {
  return (
    <article className="rounded-panel border border-line bg-surface p-5 shadow-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm text-muted">{label}</h2>
        <span className="text-accent"><MetricIcon kind={kind} /></span>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </article>
  );
}

/**
 * Protected home page: the live list (polling via useMonitors), an
 * offline/stale banner derived from the query error state, and the create
 * form. The list is never blanked on failure — TanStack Query keeps the last
 * successful data and the banner explains the staleness.
 */
export function MonitorsPage() {
  const query = useMonitors();
  const monitors = query.data;
  const total = monitors?.length ?? 0;
  const healthy = monitors?.filter((monitor) => monitor.last_state === "healthy").length ?? 0;
  const needsAttention = total - healthy;

  return (
    <section className="mx-auto w-full max-w-6xl">
      <div className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div>
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            <span className="size-2 rounded-full bg-success" aria-hidden="true" /> Live overview
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Your systems, <span className="font-serif font-normal text-accent">in view.</span></h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted">A dependable view of your monitors. Add a service and Sentinel will keep checking it.</p>
        </div>
        <div className="flex items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 shadow-panel">
          <span className="flex size-9 items-center justify-center rounded-control bg-accent-soft text-accent"><MetricIcon kind="total" /></span>
          <div>
            <p className="text-xs text-muted">Monitor overview</p>
            <p className="text-sm font-medium text-ink">Based on your loaded monitors</p>
          </div>
        </div>
      </div>

      {query.isError && query.data !== undefined && (
        <p role="alert" className="mb-5 rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          {query.error instanceof ApiError && query.error.status === 429
            ? "Rate limit reached (429). Requests are throttled; showing the last known monitor list."
            : "Live update failed. Showing the last known monitor list."}
        </p>
      )}

      {query.data !== undefined && (
        <section aria-label="Monitor summary" className="mb-8 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Total monitors" value={String(total)} detail="In the loaded monitor list" kind="total" />
          <MetricCard label="Healthy now" value={`${healthy} / ${total}`} detail="Only monitors reporting healthy status" kind="healthy" />
          <MetricCard label="Needs attention" value={`${needsAttention} / ${total}`} detail="Unhealthy or not yet checked; unknown is not healthy" kind="attention" />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)] lg:items-start">
        <section className="rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6" aria-labelledby="new-monitor-heading">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent">New monitor</p>
              <h2 id="new-monitor-heading" className="text-xl font-semibold tracking-tight text-ink">Add a watchpoint</h2>
            </div>
            <span className="rounded-control bg-accent-soft p-2 text-accent" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
            </span>
          </div>
          <CreateMonitorForm />
        </section>

        <section aria-labelledby="monitors-heading">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Your watchpoints</p>
              <h2 id="monitors-heading" className="text-xl font-semibold tracking-tight text-ink">Monitors</h2>
            </div>
            {query.data !== undefined && <span className="text-sm text-muted">{total} total</span>}
            {query.isPending && query.data === undefined && <Spinner />}
          </div>
          {query.data !== undefined ? (
            <MonitorList monitors={query.data} />
          ) : query.isError ? (
            <div role="alert" className="rounded-panel border border-danger/30 bg-danger-soft p-5 text-sm text-danger">
              {initialErrorMessage(query.error)}
            </div>
          ) : null}
        </section>
      </div>
      <footer className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-5 text-xs text-muted">
        <span>Sentinel observability platform</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">?</span> Need help?</span>
      </footer>
    </section>
  );
}

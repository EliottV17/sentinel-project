import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { MonitorHistoryRow } from "../../../app/api/endpoints";
import { ApiError } from "../../../app/api/client";
import { parseApiDate } from "../../../lib/datetime";
import { StatusPill } from "../StatusPill";
import { summarizeMonitorHistory } from "./summary";
import { LatencyChart } from "./LatencyChart";
import { useMonitorHistory } from "./useMonitorHistory";

function parseMonitorId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function terminalFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

function retryMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const retryAfter = error.retryAfter?.trim();
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return `Too many requests. Please wait ${Math.max(1, Math.ceil(seconds))} seconds before trying again.`;
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return `Too many requests. Please wait until ${new Date(date).toLocaleTimeString()} before trying again.`;
    }
    return "Too many requests. Please wait before trying again.";
  }
  return "This section is temporarily unavailable. Please try again.";
}

function FailureMessage({ error, hasData, onRetry }: { error: unknown; hasData: boolean; onRetry?: () => void }) {
  const rateLimited = error instanceof ApiError && error.status === 429;
  return (
    <div role="alert" className="rounded-control border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-warning">
      <p>{retryMessage(error)}{hasData ? " Previously loaded data is still shown." : ""}</p>
      {!rateLimited && onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-control px-2 py-1 font-medium underline underline-offset-2 transition duration-150 hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Retry</button>}
    </div>
  );
}

function CheckState({ state }: { state: string }) {
  const healthy = state === "healthy";
  const unhealthy = state === "unhealthy";
  const label = healthy ? "Healthy" : unhealthy ? "Down" : "Unknown";
  return <span className={`inline-flex items-center gap-2 rounded-control border px-2.5 py-1 text-xs font-semibold ${healthy ? "border-success/30 bg-success-soft text-success" : unhealthy ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-raised text-muted"}`}>
    <span aria-hidden="true">{healthy ? "✓" : unhealthy ? "×" : "?"}</span>{label}
  </span>;
}

function HistoryTable({ rows }: { rows: readonly MonitorHistoryRow[] }) {
  const newestFirst = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  return <div className="min-w-0 overflow-x-auto rounded-control border border-line">
    <table className="w-full min-w-[680px] border-collapse text-left">
      <thead><tr className="border-b border-line bg-raised/50 text-xs font-medium uppercase tracking-wider text-muted">
        <th className="px-3 py-3 font-medium">Checked at</th><th className="px-3 py-3 font-medium">State</th><th className="px-3 py-3 font-medium">HTTP code</th><th className="px-3 py-3 font-medium">Latency</th><th className="px-3 py-3 font-medium">Error</th>
      </tr></thead>
      <tbody>{newestFirst.map((row) => {
        const date = parseApiDate(row.created_at);
        return <tr key={row.id} className="border-b border-line/70 text-sm text-ink transition-colors duration-150 last:border-b-0 hover:bg-raised/40">
          <td className="px-3 py-3"><time dateTime={row.created_at} title={row.created_at}>{date.toLocaleString()}</time></td>
          <td className="px-3 py-3"><CheckState state={row.state} /></td>
          <td className="px-3 py-3 font-mono">{row.status_code ?? "—"}</td>
          <td className="px-3 py-3 font-mono">{row.latency_ms === null ? "—" : `${row.latency_ms} ms`}</td>
          <td className="max-w-xs break-words px-3 py-3 text-muted">{row.error_message ?? "—"}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function AlertsTimeline({ alerts }: { alerts: NonNullable<ReturnType<typeof useMonitorHistory>["alerts"]> }) {
  if (alerts.length === 0) return <p className="text-sm text-muted">No alerts yet.</p>;
  return <ol className="space-y-4">{alerts.map((alert) => {
    const down = alert.alert_type === "down";
    const recovery = alert.alert_type === "recovery";
    const label = down ? "Down" : recovery ? "Recovery" : "Unknown alert";
    const date = parseApiDate(alert.created_at);
    return <li key={alert.id} className="flex min-w-0 gap-3 rounded-control border border-line/70 bg-canvas/30 p-3 sm:p-4">
      <span aria-hidden="true" className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${down ? "bg-danger/10 text-danger" : recovery ? "bg-success/10 text-success" : "bg-raised text-muted"}`}>{down ? "×" : recovery ? "✓" : "?"}</span>
      <div className="min-w-0"><p className="font-medium text-ink">{label}</p><p className="mt-1 break-words text-sm text-muted">{alert.message}</p><time className="mt-1 block font-mono text-xs text-muted" dateTime={alert.created_at} title={alert.created_at}>{date.toLocaleString()} · {formatRelativeTime(date)}</time></div>
    </li>;
  })}</ol>;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6" aria-label={title}>
    <h2 className="mb-4 font-serif text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h2>{children}
  </section>;
}

export function MonitorHistoryPage() {
  const { id: rawId } = useParams();
  const monitorId = parseMonitorId(rawId);
  const historyData = useMonitorHistory(monitorId ?? 0);
  const terminal = terminalFailure(historyData.metadataError) || terminalFailure(historyData.historyError) || terminalFailure(historyData.alertsError);
  if (monitorId === null || terminal || (historyData.metadataLoaded && !historyData.monitor)) {
    return <main className="mx-auto w-full max-w-3xl min-w-0 py-8 sm:py-10">
      <section className="rounded-panel border border-line bg-surface p-5 text-center shadow-panel sm:p-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Monitor history</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Monitor not found</h1>
        <p className="mt-3 text-muted">This monitor is unavailable.</p>
        <a className="mt-6 inline-flex rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-muted transition duration-150 hover:border-accent hover:bg-raised hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" href="/">Back to monitors</a>
      </section>
    </main>;
  }
  if (historyData.metadataIsLoading && !historyData.metadataLoaded) {
    return <p role="status" className="rounded-control border border-line bg-surface p-4 text-sm text-muted shadow-panel">Loading monitor…</p>;
  }
  const monitor = historyData.monitor;
  const rows = historyData.history ?? [];
  const alerts = historyData.alerts;
  const summary = summarizeMonitorHistory(rows);
  const historyHasError = historyData.historyError !== null && historyData.historyError !== undefined;
  const alertsHasError = historyData.alertsError !== null && historyData.alertsError !== undefined;
  const historyPending = historyData.historyIsLoading && !historyData.history;
  return <div className="min-w-0 space-y-6 sm:space-y-8">
    <a href="/" className="inline-flex items-center gap-2 rounded-control text-sm font-medium text-muted transition duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><span aria-hidden="true">←</span> All monitors</a>
    {Boolean(historyData.metadataError) && <FailureMessage error={historyData.metadataError} hasData={Boolean(monitor)} />}
    {monitor && <header className="rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Monitor history</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h1 className="break-words font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{monitor.name}</h1><p className="mt-2 break-all font-mono text-sm text-muted">{monitor.target}</p></div>
        <StatusPill lastState={monitor.last_state} />
      </div>
      <p className="mt-4 border-t border-line pt-4 text-sm leading-6 text-muted">Checks run every <span className="font-mono font-medium text-ink">{monitor.frequency} seconds</span>.</p>
    </header>}
    <section aria-label="Check summary" className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        ["Checks", historyPending ? "Loading…" : summary.loadedCount === 0 ? "No data" : `${summary.loadedCount}`, historyPending ? "Loading check summary…" : summary.loadedCount === 0 ? "In the last checks" : `In the last ${summary.loadedCount} checks`],
        ["Healthy checks", historyPending ? "Loading…" : summary.healthyPercentage === null ? "No data" : `${Math.round(summary.healthyPercentage)}%`, "Of loaded checks"],
        ["Median latency", historyPending ? "Loading…" : summary.medianLatencyMs === null ? "No data" : `${summary.medianLatencyMs} ms`, "Measured checks"],
        ["95th percentile", historyPending ? "Loading…" : summary.p95LatencyMs === null ? "No data" : `${summary.p95LatencyMs} ms`, "Measured checks"],
      ].map(([label, value, caption]) => <article key={label} className="min-w-0 rounded-panel border border-line bg-surface p-4 shadow-panel sm:p-5"><p className="break-words text-xs font-medium uppercase tracking-wider text-muted">{label}</p><p className="mt-3 break-words font-mono text-xl font-medium tracking-tight text-ink sm:text-2xl">{value}</p><p className="mt-1 break-words text-xs leading-5 text-muted">{caption}</p></article>)}
    </section>
    <Section title="Latency over time">
      {historyData.historyIsLoading && !historyData.history && <p role="status" className="text-sm text-muted">Loading check history…</p>}
      {historyHasError && <FailureMessage error={historyData.historyError} hasData={Boolean(historyData.history)} onRetry={() => { void historyData.refetchHistory(); }} />}
      {historyData.history && <LatencyChart rows={historyData.history} frequencySeconds={monitor?.frequency} />}
      {!historyData.historyIsLoading && !historyData.history && !historyHasError && <p role="status" className="text-sm text-muted">Loading check history…</p>}
    </Section>
    <Section title="Recent checks">
      {historyData.historyIsLoading && !historyData.history && <p role="status" className="text-sm text-muted">Loading checks…</p>}
      {historyHasError && <FailureMessage error={historyData.historyError} hasData={Boolean(historyData.history)} onRetry={() => { void historyData.refetchHistory(); }} />}
      {historyData.history && rows.length === 0 && <p className="text-sm text-muted">No checks yet. The worker checks this monitor every {monitor?.frequency ?? "configured"} seconds.</p>}
      {historyData.history && rows.length > 0 && <HistoryTable rows={rows} />}
      {historyData.history && historyData.canLoadMore && <button type="button" disabled={historyData.historyIsFetching} onClick={historyData.loadMoreHistory} className="mt-4 rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-muted transition duration-150 hover:border-accent hover:bg-raised hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100">{historyData.historyIsFetching ? "Loading more…" : "Load 50 more"}</button>}
    </Section>
    <Section title="Alerts">
      {historyData.alertsIsLoading && !alerts && <p role="status" className="text-sm text-muted">Loading alerts…</p>}
      {alertsHasError && <FailureMessage error={historyData.alertsError} hasData={Boolean(alerts)} onRetry={() => { void historyData.refetchAlerts(); }} />}
      {alerts && <AlertsTimeline alerts={alerts} />}
      {!alerts && !historyData.alertsIsLoading && !alertsHasError && <p role="status" className="text-sm text-muted">Loading alerts…</p>}
    </Section>
  </div>;
}

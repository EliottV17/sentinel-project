import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "../../app/api/client";
import { SentinelBrand } from "../../components/SentinelBrand";
import {
  classifyStatus,
  summarizeStatus,
  type PublicStatusMonitor,
  type StatusLabel,
} from "./status";

const REFRESH_INTERVAL_MS = 30_000;

const statusStyle: Record<StatusLabel, string> = {
  "Operational": "border-success/30 bg-success-soft text-success",
  "Degraded": "border-warning/30 bg-warning-soft text-warning",
  "Down": "border-danger/30 bg-danger-soft text-danger",
  "No data": "border-line bg-raised text-muted",
};

function relativeCheckTime(value: string | null, now: number): string {
  if (value === null) return "No check recorded";
  const checkedAt = Date.parse(value);
  if (!Number.isFinite(checkedAt) || checkedAt > now) return "No check recorded";
  const minutes = Math.floor((now - checkedAt) / 60_000);
  if (minutes < 1) return "Last checked less than a minute ago";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  return `Last checked ${formatter.format(-minutes, "minute")}`;
}

function formatPercentage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const bounded = Math.min(100, Math.max(0, value));
  const roundedDown = Math.floor(bounded * 100) / 100;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(roundedDown)}%`;
}

function formatSampleDate(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : null;
}

function sampleCoverage(summary: NonNullable<PublicStatusMonitor["check_summary"]>): string {
  if (summary.total_checks === 0) return "—";
  const first = formatSampleDate(summary.first_check_at);
  const last = formatSampleDate(summary.last_check_at);
  return first && last ? `${first} – ${last}` : "unavailable";
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return error.retryAfter
      ? `Too many requests. Try again in ${error.retryAfter} seconds.`
      : "Too many requests. Please wait a moment and try again.";
  }
  return "Unable to load service status. Check your connection and try again.";
}

async function fetchPublicStatus(): Promise<PublicStatusMonitor[]> {
  return apiFetch<PublicStatusMonitor[]>("/api/v1/public/status", undefined, {
    anonymous: true,
    onUnauthorized: "ignore",
  });
}

function StatusBadge({ label }: { label: StatusLabel }) {
  const icon = label === "Operational" ? "✓" : label === "Degraded" ? "!" : label === "Down" ? "×" : "?";
  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold sm:text-sm ${statusStyle[label]}`}
    >
      <span aria-hidden="true" className="font-bold">{icon}</span>
      {label}
    </span>
  );
}

export function StatusPage() {
  const [now, setNow] = useState(() => Date.now());
  const query = useQuery({
    queryKey: ["public-status"],
    queryFn: fetchPublicStatus,
    staleTime: REFRESH_INTERVAL_MS,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const data = query.data ?? [];
  const summary = summarizeStatus(data, { now: new Date(now) });

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl space-y-6 px-4 py-8 text-ink sm:space-y-8 sm:px-6 sm:py-12">
      <header className="flex items-center justify-between gap-4 border-b border-line pb-5">
        <SentinelBrand compact />
        <Link to="/login" className="rounded-control px-3 py-2 text-sm font-medium text-muted transition duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          Sign in
        </Link>
      </header>

      <section>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-5xl">System status</h1>
      </section>

      {query.isPending && <p role="status" className="rounded-control border border-line bg-surface p-4 text-sm text-muted shadow-panel">Loading service status…</p>}

      {query.isError && data.length === 0 && (
        <section role="alert" className="rounded-panel border border-warning/30 bg-warning-soft p-5 text-sm leading-6 text-warning shadow-panel sm:p-6">
          <p>{friendlyError(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-control border border-current px-3 py-2 text-sm font-medium transition duration-150 hover:bg-raised active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            Try again
          </button>
        </section>
      )}

      {query.isError && data.length > 0 && (
        <p role="status" className="rounded-control border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-warning">
          Unable to update status. Showing the most recently available data.
        </p>
      )}

      {data.length > 0 && (
        <>
          <section aria-label="Overall status" className="rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-ink">Overall status</h2>
                <p className="mt-1 text-sm text-muted">{data.length} {data.length === 1 ? "monitor" : "monitors"}</p>
              </div>
              {summary.allOperational ? (
                <p role="status" aria-label="Status: All systems operational" className="inline-flex w-fit items-center gap-2 rounded-full border border-success/30 bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
                  <span aria-hidden="true">✓</span> All systems operational
                </p>
              ) : <StatusBadge label={summary.label as StatusLabel} />}
            </div>
          </section>
          <section aria-labelledby="services-heading">
            <h2 id="services-heading" className="sr-only">Monitors</h2>
            <ul aria-label="Monitors" className="grid min-w-0 gap-4 md:grid-cols-2">
              {data.map((monitor, index) => {
                const label = classifyStatus(monitor, { now: new Date(now) });
                return (
                  <li key={`${monitor.name}-${index}`} className="min-w-0 rounded-panel border border-line bg-surface p-5 shadow-panel transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-glow sm:p-6">
                    <div className="flex min-w-0 items-start justify-between gap-3 sm:gap-4">
                      <div className="min-w-0">
                        <h3 className="break-words text-base font-semibold tracking-tight text-ink">{monitor.name}</h3>
                      </div>
                      <StatusBadge label={label} />
                    </div>
                    <div className="mt-5 flex min-w-0 items-end justify-between gap-3 border-t border-line pt-4 sm:mt-6 sm:gap-4 sm:pt-5">
                      <div className="min-w-0">
                        <p className="break-words font-mono text-xl font-medium tracking-tight text-ink sm:text-2xl">
                          Healthy checks: {monitor.check_summary?.total_checks === 0 ? "—" : formatPercentage(monitor.uptime_percentage)}
                        </p>
                        {monitor.check_summary ? (
                          <>
                            <p className="mt-1 text-xs leading-5 text-muted">
                              {Number.isFinite(monitor.check_summary.window_hours) && monitor.check_summary.window_hours > 0
                                ? `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(monitor.check_summary.window_hours)}-hour window`
                                : "Sample period unavailable"}
                              {" · "}{Number.isSafeInteger(monitor.check_summary.total_checks) && monitor.check_summary.total_checks >= 0
                                ? `${monitor.check_summary.total_checks.toLocaleString("en")} checks`
                                : "sample count unavailable"}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted">
                              Sample coverage: {sampleCoverage(monitor.check_summary)}
                            </p>
                          </>
                        ) : <p className="mt-1 text-xs leading-5 text-muted">Sample period unavailable</p>}
                      </div>
                      <p className="max-w-[45%] text-right text-xs leading-5 text-muted">{relativeCheckTime(monitor.last_checked_at, now)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {query.isSuccess && data.length === 0 && (
        <p className="rounded-panel border border-dashed border-line-strong bg-surface p-6 text-center text-sm leading-6 text-muted shadow-panel">
          No public services are configured.
        </p>
      )}

      <footer className="border-t border-line pt-5 text-xs leading-5 text-muted">Updates every 30 seconds</footer>
    </main>
  );
}

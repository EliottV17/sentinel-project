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
      className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${statusStyle[label]} status-badge`}
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
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 text-ink sm:px-6 sm:py-12">
      <header className="mb-9 flex items-center justify-between gap-4 border-b border-line pb-5">
        <SentinelBrand compact />
        <Link to="/login" className="rounded-control px-3 py-2 text-sm font-medium text-muted transition hover:bg-raised hover:text-ink">
          Sign in
        </Link>
      </header>

      <section className="mb-8 grid gap-6 md:grid-cols-[1.15fr_0.85fr] md:items-end">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Live service health</p>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">System status</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted">A clear view of the services powering your experience with Sentinel.</p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5 shadow-panel md:justify-self-end md:min-w-64">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Current service health</p>
          <p className="text-sm font-medium text-ink">Public health data</p>
          <p className="mt-3 text-xs text-muted">Updates every 30 seconds</p>
        </div>
      </section>

      {query.isPending && <p role="status" className="mb-5 rounded-control border border-line bg-surface p-4 text-sm text-muted">Loading service status…</p>}

      {query.isError && data.length === 0 && (
        <section role="alert" className="mb-6 rounded-panel border border-warning/30 bg-warning-soft p-5 text-warning shadow-panel">
          <p>{friendlyError(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-control border border-current px-3 py-2 text-sm font-medium hover:bg-raised">
            Try again
          </button>
        </section>
      )}

      {query.isError && data.length > 0 && (
        <p role="status" className="mb-5 rounded-control border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          Unable to update status. Showing the most recently available data.
        </p>
      )}

      {data.length > 0 && (
        <>
          <section aria-label="Overall status" className="mb-6 rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Overall status</h2>
                <p className="mt-1 text-sm text-muted">Status of all publicly monitored services</p>
              </div>
              {summary.allOperational ? (
                <p role="status" aria-label="Status: All systems operational" className="inline-flex items-center gap-2 text-sm font-semibold text-success">
                  <span aria-hidden="true">✓</span> All systems operational
                </p>
              ) : <StatusBadge label={summary.label as StatusLabel} />}
            </div>
          </section>
          <section aria-labelledby="services-heading">
            <h2 id="services-heading" className="sr-only">Monitored services</h2>
            <ul aria-label="Services" className="grid gap-4 md:grid-cols-2">
              {data.map((monitor, index) => {
                const label = classifyStatus(monitor, { now: new Date(now) });
                return (
                  <li key={`${monitor.name}-${index}`} className="rounded-panel border border-line bg-surface p-6 shadow-panel transition duration-150 hover:border-line-strong hover:shadow-glow">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-ink">{monitor.name}</h3>
                        <p className="mt-2 text-sm text-muted">Publicly monitored service</p>
                      </div>
                      <StatusBadge label={label} />
                    </div>
                    <div className="mt-7 flex items-end justify-between gap-4 border-t border-line pt-5">
                      <div>
                        <p className="font-mono text-2xl tracking-tight text-ink">
                          {monitor.uptime_percentage === null || !Number.isFinite(monitor.uptime_percentage)
                            ? "Uptime: —"
                            : `Uptime: ${monitor.uptime_percentage}%`}
                        </p>
                        <p className="sr-only">Reported uptime</p>
                      </div>
                      <p className="text-right text-xs text-muted">{relativeCheckTime(monitor.last_checked_at, now)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {query.isSuccess && data.length === 0 && (
        <p className="rounded-panel border border-dashed border-line-strong bg-surface p-6 text-center text-muted shadow-panel">
          No public services are configured.
        </p>
      )}

      <footer className="mt-12 border-t border-line pt-5 text-xs text-muted">Sentinel status page · Service health refreshes continuously</footer>
    </main>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "../../app/api/client";
import {
  classifyStatus,
  summarizeStatus,
  type PublicStatusMonitor,
  type StatusLabel,
} from "./status";

const REFRESH_INTERVAL_MS = 30_000;

const statusStyle: Record<StatusLabel, string> = {
  "Operacional": "border-emerald-300 bg-emerald-50 text-emerald-900",
  "Degradado": "border-amber-300 bg-amber-50 text-amber-900",
  "Caído": "border-red-300 bg-red-50 text-red-900",
  "Sin datos": "border-slate-300 bg-slate-50 text-slate-800",
};

function relativeCheckTime(value: string | null, now: number): string {
  if (value === null) return "Sin verificaciones";
  const checkedAt = Date.parse(value);
  if (!Number.isFinite(checkedAt) || checkedAt > now) return "Sin verificaciones";
  const minutes = Math.floor((now - checkedAt) / 60_000);
  if (minutes < 1) return "Última verificación hace menos de un minuto";
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "always" });
  return `Última verificación ${formatter.format(-minutes, "minute")}`;
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return error.retryAfter
      ? `Demasiadas solicitudes. Inténtalo de nuevo en ${error.retryAfter} segundos.`
      : "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
  }
  return "No se pudo cargar el estado de los servicios. Comprueba tu conexión e inténtalo de nuevo.";
}

async function fetchPublicStatus(): Promise<PublicStatusMonitor[]> {
  return apiFetch<PublicStatusMonitor[]>("/api/v1/public/status", undefined, {
    anonymous: true,
    onUnauthorized: "ignore",
  });
}

function StatusBadge({ label }: { label: StatusLabel }) {
  const icon = label === "Operacional" ? "✓" : label === "Degradado" ? "!" : label === "Caído" ? "×" : "?";
  return (
    <span
      role="status"
      aria-label={`Estado: ${label}`}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${statusStyle[label]} status-badge`}
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
      <header className="mb-8 flex items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Sentinel</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Estado del sistema</h1>
        </div>
        <Link to="/login" className="text-sm text-muted underline underline-offset-4 hover:text-accent">
          Iniciar sesión
        </Link>
      </header>

      {query.isPending && <p role="status" className="rounded-control border border-line bg-surface p-4 text-sm text-muted">Cargando estado de los servicios…</p>}

      {query.isError && data.length === 0 && (
        <section role="alert" className="rounded-panel border border-warning/30 bg-warning-soft p-5 text-warning shadow-panel">
          <p>{friendlyError(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-control border border-current px-3 py-2 text-sm font-medium hover:bg-raised">
            Reintentar
          </button>
        </section>
      )}

      {query.isError && data.length > 0 && (
        <p role="status" className="mb-5 rounded-control border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          No se pudo actualizar el estado. Se muestran los últimos datos disponibles.
        </p>
      )}

      {data.length > 0 && (
        <>
          <section aria-label="Resumen general" className="mb-6 rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Estado general</p>
            {summary.allOperational ? (
              <p className="text-xl font-semibold text-success">Todos los sistemas operativos</p>
            ) : <StatusBadge label={summary.label as StatusLabel} />}
          </section>
          <ul aria-label="Servicios" className="space-y-3">
            {data.map((monitor, index) => {
              const label = classifyStatus(monitor, { now: new Date(now) });
              return (
                <li key={`${monitor.name}-${index}`} className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-panel transition duration-150 hover:border-line-strong hover:shadow-glow sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div>
                    <h2 className="font-semibold text-ink">{monitor.name}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {monitor.uptime_percentage === null || !Number.isFinite(monitor.uptime_percentage)
                        ? "Uptime: sin muestras"
                        : `Uptime: ${monitor.uptime_percentage}%`}
                    </p>
                    <p className="mt-1 text-sm text-muted">{relativeCheckTime(monitor.last_checked_at, now)}</p>
                  </div>
                  <StatusBadge label={label} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {query.isSuccess && data.length === 0 && (
        <p className="rounded-panel border border-dashed border-line-strong bg-surface p-6 text-center text-muted shadow-panel">
          No hay servicios públicos configurados.
        </p>
      )}
    </main>
  );
}

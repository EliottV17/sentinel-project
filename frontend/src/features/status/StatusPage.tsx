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
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${statusStyle[label]}`}
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
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-12 text-slate-900 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">Sentinel</p>
          <h1 className="text-3xl font-bold">Estado del sistema</h1>
        </div>
        <Link to="/login" className="text-sm text-slate-600 underline underline-offset-4 hover:text-slate-900">
          Iniciar sesión
        </Link>
      </header>

      {query.isPending && <p role="status">Cargando estado de los servicios…</p>}

      {query.isError && data.length === 0 && (
        <section role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <p>{friendlyError(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded border border-current px-3 py-1 text-sm">
            Reintentar
          </button>
        </section>
      )}

      {query.isError && data.length > 0 && (
        <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-amber-950">
          No se pudo actualizar el estado. Se muestran los últimos datos disponibles.
        </p>
      )}

      {data.length > 0 && (
        <>
          <section aria-label="Resumen general" className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="mb-2 text-sm text-slate-600">Estado general</p>
            {summary.allOperational ? (
              <p className="text-xl font-semibold text-emerald-900">Todos los sistemas operativos</p>
            ) : <StatusBadge label={summary.label as StatusLabel} />}
          </section>
          <ul aria-label="Servicios" className="space-y-3">
            {data.map((monitor, index) => {
              const label = classifyStatus(monitor, { now: new Date(now) });
              return (
                <li key={`${monitor.name}-${index}`} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold">{monitor.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {monitor.uptime_percentage === null || !Number.isFinite(monitor.uptime_percentage)
                        ? "Uptime: sin muestras"
                        : `Uptime: ${monitor.uptime_percentage}%`}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{relativeCheckTime(monitor.last_checked_at, now)}</p>
                  </div>
                  <StatusBadge label={label} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {query.isSuccess && data.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
          No hay servicios públicos configurados.
        </p>
      )}
    </main>
  );
}

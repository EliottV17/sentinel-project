export interface PublicStatusMonitor {
  name: string;
  last_state: string | null;
  uptime_percentage: number | null;
  last_checked_at: string | null;
}

export type StatusLabel = "Operacional" | "Degradado" | "Caído" | "Sin datos";

export interface StatusOptions {
  now?: Date;
  staleAfterMinutes?: number;
  degradedThresholdPercent?: number;
}

export interface StatusSummary {
  label: string;
  allOperational: boolean;
}

function positiveSetting(value: string | undefined, fallback: number, min = 0, max = Infinity): number {
  const parsed = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed > min && parsed <= max ? parsed : fallback;
}

export const STATUS_STALE_AFTER_MINUTES = positiveSetting(
  import.meta.env.VITE_STATUS_STALE_AFTER_MINUTES,
  5,
);
export const STATUS_DEGRADED_THRESHOLD_PERCENT = positiveSetting(
  import.meta.env.VITE_STATUS_DEGRADED_THRESHOLD_PERCENT,
  99,
  0,
  100,
);

export function classifyStatus(
  monitor: PublicStatusMonitor,
  options: StatusOptions = {},
): StatusLabel {
  const staleAfterMinutes = options.staleAfterMinutes ?? STATUS_STALE_AFTER_MINUTES;
  const threshold = options.degradedThresholdPercent ?? STATUS_DEGRADED_THRESHOLD_PERCENT;
  const checkedAt = monitor.last_checked_at === null ? Number.NaN : Date.parse(monitor.last_checked_at);
  const now = options.now?.getTime() ?? Date.now();
  if (
    !Number.isFinite(checkedAt) ||
    checkedAt > now ||
    now - checkedAt > staleAfterMinutes * 60_000 ||
    (monitor.last_state !== "healthy" && monitor.last_state !== "unhealthy")
  ) {
    return "Sin datos";
  }
  if (monitor.last_state === "unhealthy") return "Caído";
  if (monitor.uptime_percentage === null || !Number.isFinite(monitor.uptime_percentage)) {
    return "Sin datos";
  }
  return monitor.uptime_percentage < threshold ? "Degradado" : "Operacional";
}

export function summarizeStatus(
  monitors: PublicStatusMonitor[],
  options: StatusOptions = {},
): StatusSummary {
  if (monitors.length === 0) return { label: "Sin datos", allOperational: false };
  const labels = monitors.map((monitor) => classifyStatus(monitor, options));
  if (labels.every((label) => label === "Operacional")) {
    return { label: "Todos los sistemas operativos", allOperational: true };
  }
  const severity: Record<StatusLabel, number> = {
    "Operacional": 0,
    "Sin datos": 1,
    "Degradado": 2,
    "Caído": 3,
  };
  return {
    label: labels.reduce((worst, label) => severity[label] > severity[worst] ? label : worst),
    allOperational: false,
  };
}

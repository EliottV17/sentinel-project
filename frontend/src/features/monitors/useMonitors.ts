import { useQuery } from "@tanstack/react-query";
import { fetchMonitors } from "../../app/api/endpoints";

/**
 * Poll cadence for the monitors list: 10 s by default, chosen for UI freshness;
 * the underlying checks run on each monitor's own `frequency` in the Go worker.
 * Overridable via VITE_POLL_INTERVAL_MS (read once at module load).
 */
const ENV_POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS);
export const REFETCH_INTERVAL_MS =
  Number.isFinite(ENV_POLL_INTERVAL_MS) && ENV_POLL_INTERVAL_MS > 0
    ? ENV_POLL_INTERVAL_MS
    : 10_000;

/** While the API keeps failing, slow down instead of hammering it. */
const ERROR_BACKOFF_MS = 30_000;

/**
 * The single server-state query of the MVP. On persistent errors TanStack
 * Query keeps the last successful data (the list is never blanked) and the
 * interval function backs off to 30 s; the first success restores 10 s.
 */
export function useMonitors() {
  return useQuery({
    queryKey: ["monitors"],
    queryFn: fetchMonitors,
    refetchInterval: (query) =>
      query.state.error ? ERROR_BACKOFF_MS : REFETCH_INTERVAL_MS,
  });
}

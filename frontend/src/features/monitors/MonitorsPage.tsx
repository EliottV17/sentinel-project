import { CreateMonitorForm } from "./CreateMonitorForm";
import { MonitorList } from "./MonitorList";
import { useMonitors } from "./useMonitors";
import { Spinner } from "../../components/Spinner";
import { ApiError } from "../../app/api/client";

/**
 * Protected home page: the live list (polling via useMonitors), an
 * offline/stale banner derived from the query error state, and the create
 * form. The list is never blanked on failure — TanStack Query keeps the last
 * successful data and the banner explains the staleness.
 */
export function MonitorsPage() {
  const query = useMonitors();

  const getErrorMessage = () => {
    if (!query.error) return "Live update failed — showing the last known list.";
    if (query.error instanceof ApiError && query.error.status === 429) {
      return "Rate limit reached (429) — requests throttled. Showing the last known list.";
    }
    return "Live update failed — showing the last known list.";
  };

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Monitors</h1>
        {query.isPending && query.data === undefined && <Spinner />}
      </div>

      {query.isError && query.data !== undefined && (
        <p
          role="alert"
          className="mb-5 rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          {getErrorMessage()}
        </p>
      )}

      <CreateMonitorForm />

      <div className="mt-8">
        {query.data !== undefined ? (
          <MonitorList monitors={query.data} />
        ) : query.isError ? (
          <div
            role="alert"
            className="rounded-panel border border-danger/30 bg-danger-soft p-5 text-sm text-danger"
          >
            {query.error instanceof Error
              ? query.error.message
              : "Unable to load monitors list."}
          </div>
        ) : (
          query.isPending && null
        )}
      </div>
    </section>
  );
}

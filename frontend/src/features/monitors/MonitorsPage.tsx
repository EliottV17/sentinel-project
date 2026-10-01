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
    <section className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Monitors</h1>
        {query.isPending && query.data === undefined && <Spinner />}
      </div>

      {query.isError && query.data !== undefined && (
        <p
          role="alert"
          className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {getErrorMessage()}
        </p>
      )}

      <CreateMonitorForm />

      <div className="mt-6">
        {query.data !== undefined ? (
          <MonitorList monitors={query.data} />
        ) : query.isError ? (
          <div
            role="alert"
            className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800"
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

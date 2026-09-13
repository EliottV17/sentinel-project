import { CreateMonitorForm } from "./CreateMonitorForm";
import { MonitorList } from "./MonitorList";
import { useMonitors } from "./useMonitors";
import { Spinner } from "../../components/Spinner";

/**
 * Protected home page: the live list (polling via useMonitors), an
 * offline/stale banner derived from the query error state, and the create
 * form. The list is never blanked on failure — TanStack Query keeps the last
 * successful data and the banner explains the staleness.
 */
export function MonitorsPage() {
  const query = useMonitors();

  return (
    <section className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Monitors</h1>
        {query.isPending && query.data === undefined && <Spinner />}
      </div>

      {query.isError && (
        <p
          role="alert"
          className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Live update failed — showing the last known list.
        </p>
      )}

      <CreateMonitorForm />

      <div className="mt-6">
        {query.data !== undefined ? (
          <MonitorList monitors={query.data} />
        ) : (
          query.isPending && null
        )}
      </div>
    </section>
  );
}
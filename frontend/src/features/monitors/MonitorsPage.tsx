import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CreateMonitorForm } from "./CreateMonitorForm";
import { MonitorList } from "./MonitorList";
import { useMonitors } from "./useMonitors";
import { Spinner } from "../../components/Spinner";
import { ApiError } from "../../app/api/client";

function initialErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many requests. Please wait before refreshing your monitors.";
    if (error.status === 401) return "Your session has expired. Sign in again to load your monitors.";
    if (error.status === 403 || error.status === 404) return "Your monitors are not available. Try signing in again.";
    if (error.status >= 500) return "The monitor service is temporarily unavailable. Try again in a moment.";
  }
  return "Unable to load monitors. Check your connection and try again.";
}

function AddMonitorButton({
  expanded,
  onClick,
  buttonRef,
  pending = false,
}: {
  expanded: boolean;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  pending?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={expanded}
      aria-controls="add-monitor-panel"
      disabled={pending}
      onClick={onClick}
      className="min-h-11 rounded-control bg-accent-strong px-4 py-2.5 text-sm font-semibold text-canvas transition duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      Add monitor
    </button>
  );
}

export function MonitorsPage() {
  const query = useMonitors();
  const monitors = query.data;
  const total = monitors?.length ?? 0;
  const active = monitors?.filter((monitor) => monitor.state === "Active") ?? [];
  const healthy = active.filter((monitor) => monitor.last_state === "healthy").length;
  const unhealthy = active.filter((monitor) => monitor.last_state === "unhealthy").length;
  const pending = active.filter((monitor) => monitor.last_state === null).length;
  const paused = monitors?.filter((monitor) => monitor.state === "Paused").length ?? 0;
  const [formOpen, setFormOpen] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const monitorsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousMonitorIdsRef = useRef<Set<number> | null>(null);
  const successfulDeleteIdRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (!formOpen && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      addButtonRef.current?.focus();
    }
  }, [formOpen]);

  useLayoutEffect(() => {
    if (monitors === undefined) return;
    const currentIds = new Set(monitors.map((monitor) => monitor.id));
    const previousIds = previousMonitorIdsRef.current;
    previousMonitorIdsRef.current = currentIds;
    const deletedId = successfulDeleteIdRef.current;
    if (deletedId !== null && previousIds?.has(deletedId) && !currentIds.has(deletedId)) {
      successfulDeleteIdRef.current = null;
      if (document.activeElement === document.body) monitorsHeadingRef.current?.focus();
    }
  }, [monitors]);

  const closeForm = (): void => {
    restoreFocusRef.current = true;
    setFormOpen(false);
  };
  const toggleForm = (): void => {
    if (createPending) return;
    if (formOpen) closeForm();
    else setFormOpen(true);
  };

  return (
    <section className="mx-auto w-full max-w-6xl min-w-0 space-y-6 sm:space-y-8">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <h1 ref={monitorsHeadingRef} tabIndex={-1} className="font-serif text-3xl font-semibold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:text-4xl">Monitors</h1>
        <AddMonitorButton expanded={formOpen} onClick={toggleForm} buttonRef={addButtonRef} pending={createPending} />
      </header>

      {query.isError && query.data !== undefined && (
        <p role="alert" className="rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          {query.error instanceof ApiError && query.error.status === 429
            ? "Rate limit reached (429). Requests are throttled; showing the last known monitor list."
            : "Live update failed. Showing the last known monitor list."}
        </p>
      )}

      {monitors !== undefined && (
        <div role="group" aria-label="Monitor counts" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-4 text-sm">
          <span><span className="text-muted">Total</span> <strong className="font-mono font-medium text-ink">{total}</strong></span>
          <span><span className="text-muted">Healthy</span> <strong className="font-mono font-medium text-success">{healthy}</strong></span>
          <span><span className="text-muted">Unhealthy</span> <strong className="font-mono font-medium text-danger">{unhealthy}</strong></span>
          <span><span className="text-muted">Pending</span> <strong className="font-mono font-medium text-muted">{pending}</strong></span>
          {paused > 0 && <span className="text-muted">Paused {paused}</span>}
        </div>
      )}

      <section id="add-monitor-panel" aria-labelledby="add-monitor-heading" hidden={!formOpen} className="min-w-0 border-b border-line pb-6">
        {formOpen && (
          <>
            <h2 id="add-monitor-heading" className="mb-4 font-serif text-xl font-semibold tracking-tight text-ink">Add monitor</h2>
            <CreateMonitorForm
              autoFocus
              onCancel={closeForm}
              onCreated={closeForm}
              onPendingChange={setCreatePending}
            />
          </>
        )}
      </section>

      <section className="min-w-0" aria-labelledby="monitors-list-heading">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <h2 id="monitors-list-heading" className="sr-only">Monitor list</h2>
          {query.isPending && query.data === undefined && <Spinner />}
        </div>
        {monitors !== undefined ? (
          monitors.length > 0 ? <MonitorList monitors={monitors} onDeleteSuccess={(monitorId) => { successfulDeleteIdRef.current = monitorId; }} /> : (
            <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-8">
              <p className="text-sm text-muted">No monitors yet.</p>
              <AddMonitorButton expanded={formOpen} onClick={toggleForm} pending={createPending} />
            </div>
          )
        ) : query.isError ? (
          <div role="alert" className="rounded-panel border border-danger/30 bg-danger-soft p-5 text-sm leading-6 text-danger">
            {initialErrorMessage(query.error)}
          </div>
        ) : null}
      </section>
    </section>
  );
}

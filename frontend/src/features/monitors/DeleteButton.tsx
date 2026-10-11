import { useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "../../app/api/client";
import { useDeleteMonitor } from "./useMonitorMutations";

/**
 * Two-step inline confirm (no native `confirm()`): the first click reveals
 * the inline confirm/cancel row, the second click deletes. Any outcome —
 * success or 404 — invalidates the list (the mutation's `onSettled`), since
 * a 404 also means the cached list may be stale.
 */
export function DeleteButton({
  monitorId,
  monitorName,
}: {
  monitorId: number;
  monitorName?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const deleteMonitor = useDeleteMonitor();
  const name = monitorName ?? "this monitor";

  useLayoutEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  useLayoutEffect(() => {
    if (!confirming) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !inFlightRef.current && !deleteMonitor.isPending) {
        event.preventDefault();
        restoreFocusRef.current = true;
        setConfirming(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirming, deleteMonitor.isPending]);

  const cancel = (): void => {
    if (inFlightRef.current || deleteMonitor.isPending) return;
    restoreFocusRef.current = true;
    setConfirming(false);
  };

  const confirm = (): void => {
    if (inFlightRef.current || deleteMonitor.isPending) return;
    inFlightRef.current = true;
    setMessage(null);
    deleteMonitor.mutate(monitorId, {
      onSuccess: () => {
        inFlightRef.current = false;
        setConfirming(false);
      },
      onError: (err) => {
        inFlightRef.current = false;
        if (err instanceof ApiError && err.status === 404) {
          setMessage("Monitor not found — refreshing list");
        } else {
          setMessage("Could not delete the monitor — try again");
        }
      },
    });
  };

  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button
        ref={triggerRef}
        type="button"
        hidden={confirming}
        onClick={() => {
          setMessage(null);
          setConfirming(true);
        }}
        className="min-h-11 rounded-control border border-transparent px-2.5 py-1.5 text-xs font-medium text-danger transition duration-150 hover:border-danger/30 hover:bg-danger-soft active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Delete{monitorName !== undefined ? ` ${monitorName}` : ""}
      </button>
      {confirming && (
        <span
          className="inline-flex min-w-0 flex-wrap items-center gap-2"
          aria-busy={deleteMonitor.isPending}
        >
          <span role="status" aria-live="polite" className="text-xs text-muted">
            Delete monitor {name}?
            {message !== null && <span className="block text-danger">{message}</span>}
          </span>
          <button
            type="button"
            onClick={confirm}
            disabled={deleteMonitor.isPending}
            aria-label={`Confirm delete ${name}`}
            className="min-h-11 rounded-control bg-danger-strong px-2.5 py-1.5 text-xs font-semibold text-canvas transition duration-150 hover:bg-danger active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            Confirm delete
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            disabled={deleteMonitor.isPending}
            className="min-h-11 rounded-control border border-line-strong px-2.5 py-1.5 text-xs font-medium text-muted transition duration-150 hover:border-accent hover:bg-raised hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            Cancel
          </button>
        </span>
      )}
      {!confirming && message !== null && (
        <span role="status" aria-live="polite" className="text-xs text-danger">
          {message}
        </span>
      )}
    </span>
  );
}

import { useState } from "react";
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
  const deleteMonitor = useDeleteMonitor();

  const confirm = (): void => {
    setMessage(null);
    deleteMonitor.mutate(monitorId, {
      onSuccess: () => {
        setConfirming(false);
      },
      onError: (err) => {
        setConfirming(false);
        if (err instanceof ApiError && err.status === 404) {
          setMessage("Monitor not found — refreshing list");
        } else {
          setMessage("Could not delete the monitor — try again");
        }
      },
    });
  };

  if (!confirming) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
          className="rounded-control px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
        >
          Delete{monitorName !== undefined ? ` ${monitorName}` : ""}
        </button>
        {message !== null && <span className="text-xs text-danger">{message}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-muted">Confirm delete?</span>
      <button
        type="button"
        onClick={confirm}
        disabled={deleteMonitor.isPending}
        className="rounded-control bg-danger-strong px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:cursor-not-allowed disabled:opacity-50"
      >
        Confirm delete
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
        }}
        className="rounded-control px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-raised hover:text-ink"
      >
        Cancel
      </button>
      {message !== null && <span className="text-xs text-danger">{message}</span>}
    </span>
  );
}
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
          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Delete{monitorName !== undefined ? ` ${monitorName}` : ""}
        </button>
        {message !== null && <span className="text-xs text-red-600">{message}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-slate-600">Confirm delete?</span>
      <button
        type="button"
        onClick={confirm}
        disabled={deleteMonitor.isPending}
        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        Confirm delete
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
        }}
        className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        Cancel
      </button>
      {message !== null && <span className="text-xs text-red-600">{message}</span>}
    </span>
  );
}
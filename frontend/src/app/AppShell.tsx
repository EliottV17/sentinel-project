import type { ReactNode } from "react";
import { useAuth } from "./auth/AuthProvider";

/** Header with the app name and Logout, wrapping the protected outlet. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, isDemo, logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="text-lg font-semibold text-slate-900">Sentinel</span>
        <div className="flex items-center gap-3">
          {user !== null && (
            <span className="text-sm text-slate-500">{user}</span>
          )}
          <button
            type="button"
            onClick={logout}
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            Logout
          </button>
        </div>
      </header>
      {isDemo && (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm text-amber-900">
          Demo monitor data and history are reset every 60 minutes.
        </div>
      )}
      <main className="mx-auto max-w-4xl px-6 py-6">{children}</main>
    </div>
  );
}

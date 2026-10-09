import type { ReactNode } from "react";
import { useAuth } from "./auth/AuthProvider";
import { SentinelBrand } from "../components/SentinelBrand";

/** Header with the app brand and Logout, wrapping the protected outlet. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, isDemo, logout } = useAuth();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-4 backdrop-blur sm:px-6">
        <SentinelBrand compact />
        <div className="flex items-center gap-3">
          {user !== null && (
            <span className="text-sm text-muted">{user}</span>
          )}
          <button
            type="button"
            onClick={logout}
            className="rounded-control border border-line-strong px-3 py-2 text-sm text-muted hover:border-accent hover:bg-raised hover:text-ink"
          >
            Log out
          </button>
        </div>
      </header>
      {isDemo && (
        <div role="status" className="border-b border-warning/30 bg-warning-soft px-4 py-3 text-center text-sm text-warning sm:px-6">
          Demo monitor data and history are reset every 60 minutes.
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

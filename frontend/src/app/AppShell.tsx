import type { ReactNode } from "react";
import { useAuth } from "./auth/AuthProvider";
import { SentinelBrand } from "../components/SentinelBrand";

/** Header with the app brand and Logout, wrapping the protected outlet. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, isDemo, logout } = useAuth();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line/80 bg-canvas/80 px-4 py-4 shadow-sm backdrop-blur-md sm:px-6">
        <SentinelBrand compact />
        <div className="flex max-w-full flex-wrap items-center justify-end gap-3">
          {user !== null && (
            <span className="min-w-0 break-all text-sm font-medium text-muted">{user}</span>
          )}
          <button
            type="button"
            onClick={logout}
            className="shrink-0 whitespace-nowrap rounded-control border border-line-strong px-3 py-2 text-sm text-muted transition duration-150 hover:border-accent hover:bg-raised hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Log out
          </button>
        </div>
      </header>
      {isDemo && (
        <div role="status" className="border-b border-warning/30 bg-warning-soft/80 px-4 py-3 text-center text-sm font-medium text-warning sm:px-6">
          Demo monitor data and history are reset every 60 minutes.
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

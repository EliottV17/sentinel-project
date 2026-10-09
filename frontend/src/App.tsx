import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";
import { AuthProvider } from "./app/auth/AuthProvider";
import { RequireAuth } from "./app/auth/guards";
import { AppShell } from "./app/AppShell";
import { LoginPage } from "./features/login/LoginPage";
import { MonitorsPage } from "./features/monitors/MonitorsPage";
import { MonitorHistoryPage } from "./features/monitors/history/MonitorHistoryPage";
import { StatusPage } from "./features/status/StatusPage";

// Route tree. `/` is guarded (inside the AppShell) and renders the monitors
// feature; `/login` is wired to LoginPage; `*` falls back to `/`.
export const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      {
        path: "/",
        element: (
          <RequireAuth>
            <AppShell>
              <MonitorsPage />
            </AppShell>
          </RequireAuth>
        ),
      },
      {
        path: "/monitors/:id",
        element: (
          <RequireAuth>
            <AppShell>
              <MonitorHistoryPage />
            </AppShell>
          </RequireAuth>
        ),
      },
      {
        path: "/login",
        element: <LoginPage />,
      },
      {
        path: "/status",
        element: <StatusPage />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);

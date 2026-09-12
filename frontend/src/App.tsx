import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";
import { AuthProvider } from "./app/auth/AuthProvider";
import { RequireAuth } from "./app/auth/guards";
import { AppShell } from "./app/AppShell";
import { LoginPage } from "./features/login/LoginPage";

// Route tree. `/` is guarded (inside the AppShell) and renders a placeholder for
// the monitors feature; `/login` is wired to LoginPage; `*` falls back to `/`.
// PR 3 swaps the placeholder for the real monitors feature.
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
              <div>Monitors — PR 3</div>
            </AppShell>
          </RequireAuth>
        ),
      },
      {
        path: "/login",
        element: <LoginPage />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);

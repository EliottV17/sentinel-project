import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tokenStore } from "../api/token";
import { AuthProvider } from "./AuthProvider";
import { RequireAuth } from "./guards";

function LocationProbe() {
  const location = useLocation();
  const from =
    location.state !== null &&
    typeof location.state === "object" &&
    "from" in location.state
      ? String((location.state as { from: unknown }).from)
      : "";
  return (
    <span data-testid="loc">
      {location.pathname}
      {from ? `|from:${from}` : ""}
    </span>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/secret"
            element={
              <RequireAuth>
                <div>protected-content</div>
              </RequireAuth>
            }
          />
          <Route
            path="/login"
            element={
              <>
                <span>login-page</span>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it("redirects an unauthenticated visitor to /login preserving the attempted path", () => {
    renderAt("/secret");

    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
    expect(screen.getByText("login-page")).toBeInTheDocument();
    expect(screen.getByTestId("loc")).toHaveTextContent("/login|from:/secret");
  });

  it("renders the protected children when authenticated", () => {
    tokenStore.set("tok");
    renderAt("/secret");

    expect(screen.getByText("protected-content")).toBeInTheDocument();
    expect(screen.queryByText("login-page")).not.toBeInTheDocument();
  });
});

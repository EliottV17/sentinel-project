import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tokenStore } from "./api/token";
import { AuthProvider } from "./auth/AuthProvider";
import { makeJwt } from "../test/jwt-fixture";
import { AppShell } from "./AppShell";

const EXP = 1_735_691_400;

describe("AppShell demo reset notice", () => {
  beforeEach(() => tokenStore.clear());
  afterEach(() => tokenStore.clear());

  function renderShell(isDemo: boolean, user = "demo-user") {
    tokenStore.set(makeJwt({ sub: user, exp: EXP, is_demo: isDemo }));
    render(
      <MemoryRouter>
        <AuthProvider>
          <AppShell><p>Protected content</p></AppShell>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("shows an accessible periodic reset notice for demo identities", () => {
    renderShell(true);
    expect(screen.getByRole("status")).toHaveTextContent(/reset every 60 minutes/i);
  });

  it("keeps the full long account and a working logout without a new menu", () => {
    const user = "operations-team-with-a-long-account@regional-monitoring.example.invalid";
    renderShell(false, user);
    expect(screen.getByText(user)).toBeVisible();
    expect(screen.getByText(user)).toHaveClass("break-all");
    const logout = screen.getByRole("button", { name: "Log out" });
    expect(logout).toHaveClass("min-h-11");
    fireEvent.click(logout);
    expect(tokenStore.get()).toBeNull();
  });

  it("omits the notice for ordinary identities", () => {
    renderShell(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

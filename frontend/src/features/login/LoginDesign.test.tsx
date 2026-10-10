import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../app/auth/AuthProvider";
import { LoginPage } from "./LoginPage";

function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage design", () => {
  it("provides English accessible sign-in labels", () => {
    renderLoginPage();

    expect(screen.getByRole("heading", { name: "Sign in to Sentinel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("links to account creation", () => {
    renderLoginPage();

    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
  });
});

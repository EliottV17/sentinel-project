import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/mocks/server";
import { makeJwt } from "../../test/jwt-fixture";
import { tokenStore } from "../../app/api/token";
import { AuthProvider } from "../../app/auth/AuthProvider";
import { LoginPage } from "./LoginPage";

const BASE_TS = 1_735_689_600;

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{location.pathname}</span>;
}

function renderLoginPage(from?: string) {
  render(
    <MemoryRouter
      initialEntries={[
        from
          ? { pathname: "/login", state: { from } }
          : { pathname: "/login" },
      ]}
    >
      <AuthProvider>
        <Routes>
          <Route path="/login" element={
            <>
              <LoginPage />
              <LocationProbe />
            </>
          } />
          <Route path="/monitors" element={<LocationProbe />} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { loc: () => screen.getByTestId("loc").textContent ?? "" };
}

function submitForm(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  afterEach(() => {
    tokenStore.clear();
  });

  it("valid submit navigates to location.state.from", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({
          access_token: makeJwt({ sub: "user-1", exp: BASE_TS + 1800 }),
          token_type: "bearer",
        }),
      ),
    );
    const { loc } = renderLoginPage("/monitors");

    await act(async () => {
      submitForm("eliott", "pw");
    });

    await waitFor(() => expect(loc()).toBe("/monitors"));
    expect(tokenStore.get()).not.toBeNull();
  });

  it("401 shows an inline error and stays on the form", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "Unauthorized" }, { status: 401 }),
      ),
    );
    const { loc } = renderLoginPage("/monitors");

    await act(async () => {
      submitForm("bad", "creds");
    });

    await waitFor(() =>
      expect(screen.getByText("Invalid credentials or email")).toBeInTheDocument(),
    );
    expect(loc()).toBe("/login");
    expect(screen.getByLabelText("Username")).toHaveValue("bad");
  });

  it("network/5xx failures show the API-unreachable message", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        new HttpResponse("upstream error", { status: 502 }),
      ),
    );
    const { loc } = renderLoginPage();

    await act(async () => {
      submitForm("eliott", "pw");
    });

    await waitFor(() =>
      expect(screen.getByText("API unreachable")).toBeInTheDocument(),
    );
    expect(loc()).toBe("/login");
  });

  it("redirects to / when already authenticated", () => {
    tokenStore.set(makeJwt({ sub: "u", exp: BASE_TS + 1800 }));
    const { loc } = renderLoginPage();

    expect(loc()).toBe("/");
  });
});

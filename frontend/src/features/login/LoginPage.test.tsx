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
  fireEvent.change(screen.getByLabelText("Username or email"), {
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

  it("marks the existing sign-in fields as required without extra password rules", () => {
    renderLoginPage();
    expect(screen.getByText("All fields are required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toBeRequired();
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
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

    expect(screen.getByRole("link", { name: /view system status/i })).toHaveAttribute("href", "/status");
    await act(async () => {
      submitForm("eliott", "pw");
    });

    await waitFor(() => expect(loc()).toBe("/monitors"));
    expect(tokenStore.get()).not.toBeNull();
  });

  it("blocks demo while login is pending and keeps credentials available after failure", async () => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("/api/v1/auth/login", async () => {
      calls += 1;
      await pending;
      return calls === 1
        ? HttpResponse.json({ detail: "Unauthorized" }, { status: 401 })
        : HttpResponse.json({ access_token: makeJwt({ sub: "user-1", exp: BASE_TS + 1800 }), token_type: "bearer" });
    }));
    const { loc } = renderLoginPage("/monitors");
    fireEvent.change(screen.getByLabelText("Username or email"), { target: { value: "saved-user" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "saved-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const loginButton = await screen.findByRole("button", { name: "Signing in…" });
    const demoButton = screen.getByRole("button", { name: "Try the demo" });
    expect(loginButton).toBeDisabled();
    expect(demoButton).toBeDisabled();
    fireEvent.click(demoButton);
    expect(calls).toBe(1);

    await act(async () => release());
    expect(await screen.findByText("Invalid credentials or email")).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toHaveValue("saved-user");
    expect(screen.getByLabelText("Password")).toHaveValue("saved-password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeEnabled();
    expect(loc()).toBe("/login");
    expect(tokenStore.get()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(loc()).toBe("/monitors"));
    expect(calls).toBe(2);
    expect(tokenStore.get()).not.toBeNull();
  });

  it("blocks login while demo is pending and releases both alternatives on unavailable", async () => {
    let demoCalls = 0;
    let loginCalls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.post("/api/v1/auth/demo-login", async () => {
        demoCalls += 1;
        await pending;
        return HttpResponse.json({ detail: "Unavailable" }, { status: 503 });
      }),
      http.post("/api/v1/auth/login", () => { loginCalls += 1; return HttpResponse.json({}); }),
    );
    const { loc } = renderLoginPage();
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(await screen.findByRole("button", { name: "Opening demo…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(demoCalls).toBe(1);
    expect(loginCalls).toBe(0);

    await act(async () => release());
    expect(await screen.findByText("Demo access is currently unavailable. Please try again later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeEnabled();
    expect(loc()).toBe("/login");
    expect(tokenStore.get()).toBeNull();
  });

  it("allows only one request when login and demo are submitted in the same tick", async () => {
    let loginCalls = 0;
    let demoCalls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.post("/api/v1/auth/login", async () => { loginCalls += 1; await pending; return HttpResponse.json({}); }),
      http.post("/api/v1/auth/demo-login", async () => {
        demoCalls += 1;
        await pending;
        return HttpResponse.json({ access_token: makeJwt({ sub: "demo-user", exp: BASE_TS + 1800 }), token_type: "bearer" });
      }),
    );
    const { loc } = renderLoginPage("/monitors");
    fireEvent.change(screen.getByLabelText("Username or email"), { target: { value: "eliott" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    await waitFor(() => expect(loginCalls + demoCalls).toBe(1));
    expect(demoCalls).toBe(1);
    expect(loginCalls).toBe(0);
    expect(screen.getByRole("button", { name: "Opening demo…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(loc()).toBe("/monitors"));
    expect(loginCalls + demoCalls).toBe(1);
    expect(tokenStore.get()).not.toBeNull();
  });

  it("sends only one request for rapid duplicate form submissions", async () => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("/api/v1/auth/login", async () => {
      calls += 1;
      await pending;
      return HttpResponse.json({ access_token: makeJwt({ sub: "user-1", exp: BASE_TS + 1800 }), token_type: "bearer" });
    }));
    const { loc } = renderLoginPage();
    fireEvent.change(screen.getByLabelText("Username or email"), { target: { value: "eliott" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    const form = screen.getByRole("button", { name: "Sign in" }).closest("form");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    await waitFor(() => expect(calls).toBe(1));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(loc()).toBe("/"));
    expect(calls).toBe(1);
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
    expect(screen.getByLabelText("Username or email")).toHaveValue("bad");
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

  it("keeps demo credentials out of the UI and logs in through the dedicated demo endpoint", async () => {
    let requestMethod: string | undefined;
    server.use(
      http.post("/api/v1/auth/demo-login", ({ request }) => {
        requestMethod = request.method;
        return HttpResponse.json({
          access_token: makeJwt({ sub: "demo-user", exp: BASE_TS + 1800 }),
          token_type: "bearer",
        });
      }),
    );
    const { loc } = renderLoginPage("/monitors");

    expect(screen.queryByText(/Demo credentials:/i)).not.toBeInTheDocument();
    expect(screen.getByText("Explore the demo. Data resets every hour.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to manage your monitors.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    });

    await waitFor(() => expect(loc()).toBe("/monitors"));
    expect(requestMethod).toBe("POST");
    expect(tokenStore.get()).not.toBeNull();
  });

  it("shows readable unavailable copy and allows retry when demo login returns 503", async () => {
    let calls = 0;
    server.use(
      http.post("/api/v1/auth/demo-login", () => {
        calls += 1;
        return HttpResponse.json({ detail: "Unavailable" }, { status: 503 });
      }),
    );
    const { loc } = renderLoginPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    });

    expect(await screen.findByText("Demo access is currently unavailable. Please try again later.")).toBeInTheDocument();
    expect(loc()).toBe("/login");
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText("Demo access is currently unavailable. Please try again later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeEnabled();
    expect(tokenStore.get()).toBeNull();
  });

  it("shows the account-created confirmation and links to registration", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { accountCreated: true } }]}>
        <AuthProvider><LoginPage /></AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/account created.*sign in/i);
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("redirects to / when already authenticated", () => {
    tokenStore.set(makeJwt({ sub: "u", exp: BASE_TS + 1800 }));
    const { loc } = renderLoginPage();

    expect(loc()).toBe("/");
  });
});

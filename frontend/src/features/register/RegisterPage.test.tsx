import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../app/auth/AuthProvider";
import { tokenStore } from "../../app/api/token";
import { server } from "../../test/mocks/server";
import { RegisterPage } from "./RegisterPage";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{location.pathname}</span>;
}

function renderRegisterPage() {
  render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<><RegisterPage /><LocationProbe /></>} />
          <Route path="/login" element={<LocationProbe />} />
          <Route path="/" element={<LocationProbe />} />
          <Route path="/status" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { loc: () => screen.getByTestId("loc").textContent ?? "" };
}

function fillRegistration(overrides: Record<string, string> = {}) {
  const values = {
    Name: "Alex",
    "Last name": "Morgan",
    Username: "alexmorgan",
    Email: "alex@example.com",
    Password: "Password123",
    "Confirm password": "Password123",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

async function submitRegistration() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  });
}

describe("RegisterPage", () => {
  beforeEach(() => tokenStore.clear());
  afterEach(() => { tokenStore.clear(); vi.restoreAllMocks(); });

  it("renders decorative lock icons inside both password fields", () => {
    renderRegisterPage();
    for (const label of ["Password", "Confirm password"]) {
      const input = screen.getByLabelText(label);
      const icon = input.parentElement?.querySelector("svg[aria-hidden='true']");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("validates username, password rules, and confirmation accessibly", async () => {
    renderRegisterPage();
    fillRegistration({ Username: "a!", Password: "password", "Confirm password": "different" });
    await submitRegistration();

    expect(await screen.findByText(/3 to 20 letters or numbers/i)).toBeInTheDocument();
    expect(screen.getByText(/at least one letter and one number/i)).toBeInTheDocument();
    expect(screen.getByText(/passwords must match/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
  });

  it("posts the DTO and returns to login with success without logging in", async () => {
    let body = "";
    let loginCalls = 0;
    server.use(
      http.post("/api/v1/users/", async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({}, { status: 201 });
      }),
      http.post("/api/v1/auth/login", () => { loginCalls += 1; return HttpResponse.json({}); }),
    );
    const { loc } = renderRegisterPage();
    fillRegistration();
    await submitRegistration();

    await waitFor(() => expect(loc()).toBe("/login"));
    expect(JSON.parse(body)).toEqual({ name: "Alex", last_name: "Morgan", username: "alexmorgan", email: "alex@example.com", password: "Password123" });
    expect(body).not.toContain("confirmPassword");
    expect(loginCalls).toBe(0);
    expect(tokenStore.get()).toBeNull();
  });

  it.each([
    ["Email already registered", "Email already registered"],
    ["Username already taken", "Username already taken"],
  ])("maps duplicate response %s to the matching field", async (message, expected) => {
    server.use(http.post("/api/v1/users/", () => HttpResponse.json({ message }, { status: 400 })));
    renderRegisterPage();
    fillRegistration();
    await submitRegistration();
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByLabelText(expected.startsWith("Email") ? "Email" : "Username")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    [400, { message: ["email must be a valid email"] }, /please review the registration details/i],
    [429, { message: "ThrottlerException: Too Many Requests" }, /too many requests.*wait/i],
    [500, { message: "Database password leaked" }, /unable to create your account/i],
  ])("safely reports server response %s", async (status, body, expected) => {
    server.use(http.post("/api/v1/users/", () => HttpResponse.json(body, { status })));
    const { loc } = renderRegisterPage();
    fillRegistration();
    await submitRegistration();
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    if (status === 400) expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(loc()).toBe("/register");
    expect(screen.queryByText("Database password leaked")).not.toBeInTheDocument();
  });

  it("reports network failures safely", async () => {
    server.use(http.post("/api/v1/users/", () => HttpResponse.error()));
    renderRegisterPage();
    fillRegistration();
    await submitRegistration();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to create your account.*try again/i);
  });

  it("prevents duplicate submits while registration is pending", async () => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("/api/v1/users/", async () => {
      calls += 1;
      await pending;
      return HttpResponse.json({}, { status: 201 });
    }));
    renderRegisterPage();
    fillRegistration();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.click(screen.getByRole("button", { name: /creating account/i }));
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/login"));
  });

  it("routes demo access through the existing flow, with busy-state protection", async () => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("/api/v1/auth/demo-login", async () => {
      calls += 1;
      await pending;
      return HttpResponse.json({ access_token: "demo-token", token_type: "bearer" });
    }));
    const { loc } = renderRegisterPage();
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(screen.getByRole("button", { name: /opening demo/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(loc()).toBe("/"));
    expect(calls).toBe(1);
  });

  it("links to login and system status", () => {
    renderRegisterPage();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /system status/i })).toHaveAttribute("href", "/status");
    expect(screen.getByRole("heading", { name: "Register for Sentinel" })).toBeInTheDocument();
    expect(screen.getByText(/Make every signal/i)).toBeInTheDocument();
  });
});

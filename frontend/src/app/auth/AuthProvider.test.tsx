import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/mocks/server";
import { makeJwt } from "../../test/jwt-fixture";
import { tokenStore } from "../api/token";
import { ApiError, apiFetch, setUnauthorizedHandler } from "../api/client";
import { AuthProvider, useAuth, type AuthContextValue } from "./AuthProvider";

const BASE_TS = 1_735_689_600; // 2025-01-01T00:00:00Z

interface Holder {
  current: AuthContextValue | null;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="loc">
      {location.pathname}
      {location.search}
    </span>
  );
}

function Harness({ holder }: { holder: Holder }) {
  const auth = useAuth();
  holder.current = auth;
  return null;
}

function renderAt(path: string) {
  const holder: Holder = { current: null };
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/monitors"
            element={
              <>
                <Harness holder={holder} />
                <LocationProbe />
              </>
            }
          />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return {
    holder,
    loc: () => screen.getByTestId("loc").textContent ?? "",
  };
}

function catchError(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    (v) => v,
    (e) => e,
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.useRealTimers();
  });

  it("login success stores the token, decodes the user, and posts form-encoded", async () => {
    const calls: { contentType: string | null; body: string }[] = [];
    server.use(
      http.post("/api/v1/auth/login", async ({ request }) => {
        calls.push({
          contentType: request.headers.get("content-type"),
          body: await request.text(),
        });
        return HttpResponse.json({
          access_token: makeJwt({
            sub: "user-1",
            exp: BASE_TS + 1800,
          }),
          token_type: "bearer",
        });
      }),
    );
    const { holder, loc } = renderAt("/monitors");
    const auth = holder.current!;

    await act(async () => {
      await auth.login("eliott", "pw");
    });

    await waitFor(() => expect(holder.current!.isAuthenticated).toBe(true));
    expect(tokenStore.get()).not.toBeNull();
    expect(holder.current!.user).toBe("user-1");
    expect(loc()).toBe("/monitors");
    expect(calls).toHaveLength(1);
    expect(calls[0].contentType).toContain("application/x-www-form-urlencoded");
    expect(calls[0].contentType).not.toContain("application/json");
    const params = new URLSearchParams(calls[0].body);
    expect(params.get("username")).toBe("eliott");
    expect(params.get("password")).toBe("pw");
  });

  it("login 401 surfaces ApiError to the caller without redirecting", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "Unauthorized" }, { status: 401 }),
      ),
    );
    const { holder, loc } = renderAt("/monitors");
    const auth = holder.current!;

    const err = await catchError(auth.login("bad", "creds"));

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(tokenStore.get()).toBeNull();
    await waitFor(() => expect(loc()).toBe("/monitors"));
  });

  it("logout clears the token and navigates to /login", async () => {
    tokenStore.set(makeJwt({ sub: "u", exp: BASE_TS + 1800 }));
    const { holder, loc } = renderAt("/monitors");
    const auth = holder.current!;

    act(() => {
      auth.logout();
    });

    expect(tokenStore.get()).toBeNull();
    await waitFor(() => {
      expect(holder.current!.isAuthenticated).toBe(false);
      expect(loc()).toBe("/login");
    });
  });

  it("the 30s exp-watcher auto-logs out when the token is expiring soon", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BASE_TS * 1000));
    // Token expires in 30 s → inside the 60 s skew window.
    tokenStore.set(makeJwt({ sub: "u", exp: BASE_TS + 30 }));
    const { loc } = renderAt("/monitors");
    expect(loc()).toBe("/monitors");

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(tokenStore.get()).toBeNull();
    expect(loc()).toBe("/login");
  });

  it("the exp-watcher leaves healthy tokens alone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BASE_TS * 1000));
    tokenStore.set(makeJwt({ sub: "u", exp: BASE_TS + 1800 }));
    const { loc } = renderAt("/monitors");

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(tokenStore.get()).not.toBeNull();
    expect(loc()).toBe("/monitors");
  });

  it("registers the client unauthorized handler on mount → /login?next=…", async () => {
    tokenStore.set(makeJwt({ sub: "u", exp: BASE_TS + 1800 }));
    server.use(
      http.get("/api/v1/monitors/", () =>
        HttpResponse.json({ detail: "Unauthorized" }, { status: 401 }),
      ),
    );
    const { loc } = renderAt("/monitors");

    const err = await catchError(apiFetch("/api/v1/monitors/"));

    expect(err).toBeInstanceOf(ApiError);
    await waitFor(() => expect(loc()).toBe("/login?next=%2Fmonitors"));
    expect(tokenStore.get()).toBeNull();
  });
});

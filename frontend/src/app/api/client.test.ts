import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { tokenStore } from "./token";
import { ApiError, apiFetch, setUnauthorizedHandler } from "./client";

function catchError(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    (v) => v,
    (e) => e,
  );
}

describe("apiFetch", () => {
  const unauthorized = vi.fn();

  afterEach(() => {
    setUnauthorizedHandler(null);
    unauthorized.mockReset();
    tokenStore.clear();
  });

  it("attaches Authorization: Bearer <token> when a token is set", async () => {
    tokenStore.set("tok-123");
    let auth: string | null = null;
    server.use(
      http.get("/api/v1/ping", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiFetch("/api/v1/ping");

    expect(auth).toBe("Bearer tok-123");
  });

  it("sends no Authorization header when unauthenticated", async () => {
    tokenStore.clear();
    let auth: string | null = null;
    server.use(
      http.get("/api/v1/ping", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiFetch("/api/v1/ping");

    expect(auth).toBeNull();
  });

  it("degrades a non-JSON error body to a form-level message", async () => {
    server.use(
      http.get("/api/v1/ping", () =>
        new HttpResponse("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    const err = await catchError(apiFetch("/api/v1/ping"));

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.message).toBeTruthy();
    expect(apiErr.fields).toEqual({});
  });

  it("normalizes a string detail into ApiError.message", async () => {
    server.use(
      http.get("/api/v1/ping", () =>
        HttpResponse.json({ detail: "boom" }, { status: 400 }),
      ),
    );

    const err = await catchError(apiFetch("/api/v1/ping"));

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.message).toBe("boom");
  });

  it("normalizes a [{loc,msg,type}] list detail into field errors", async () => {
    server.use(
      http.post("/api/v1/ping", () =>
        HttpResponse.json(
          {
            detail: [
              {
                loc: ["body", "frequency"],
                msg: "Input should be greater than or equal to 10",
                type: "greater_than_equal",
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );

    const err = await catchError(
      apiFetch("/api/v1/ping", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.fields).toEqual({
      frequency: "Input should be greater than or equal to 10",
    });
  });

  it("on 401 clears the token and invokes the unauthorized handler", async () => {
    setUnauthorizedHandler(unauthorized);
    tokenStore.set("tok-401");
    server.use(
      http.get("/api/v1/ping", () =>
        HttpResponse.json({ detail: "Unauthorized" }, { status: 401 }),
      ),
    );

    const err = await catchError(apiFetch("/api/v1/ping"));

    expect(err).toBeInstanceOf(ApiError);
    expect(tokenStore.get()).toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
});

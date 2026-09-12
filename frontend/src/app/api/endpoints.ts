import type { operations } from "../../lib/api/schema";
import { apiFetch } from "./client";

/**
 * Typed API endpoint calls — one per endpoint, no business logic. Monitor
 * calls are appended in PR 3; `check_config` stays typed as a plain record
 * and is never rendered.
 */

type LoginResponse =
  operations["login_api_v1_auth_login_post"]["responses"][200]["content"]["application/json"];

/**
 * POST /api/v1/auth/login — the endpoint is an OAuth2PasswordRequestForm, so
 * the body MUST be form-encoded (`URLSearchParams`), never JSON. A 401 here
 * means bad credentials and is surfaced to the caller, so the client's
 * unauthorized handler (redirect) is bypassed for this call.
 */
export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const body = new URLSearchParams({ username, password });
  return apiFetch<LoginResponse>(
    "/api/v1/auth/login",
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    { onUnauthorized: "ignore" },
  );
}

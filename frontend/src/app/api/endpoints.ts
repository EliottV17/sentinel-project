import type { operations } from "../../lib/api/schema";
import { apiFetch } from "./client";

/**
 * Typed API endpoint calls — one per endpoint, no business logic. Monitor
 * calls are appended in PR 3; `check_config` stays typed as a plain record
 * and is never rendered.
 */

type LoginResponse =
  operations["login_api_v1_auth_login_post"]["responses"][200]["content"]["application/json"];

type MonitorListResponse =
  operations["get_user_monitors_api_v1_monitors__get"]["responses"][200]["content"]["application/json"];

type MonitorCreateBody =
  operations["create_new_monitor_api_v1_monitors__post"]["requestBody"]["content"]["application/json"];

type MonitorCreateResponse =
  operations["create_new_monitor_api_v1_monitors__post"]["responses"][201]["content"]["application/json"];

type MonitorDeleteResponse =
  operations["delete_monitor_by_id_api_v1_monitors__monitor_id__delete"]["responses"][200]["content"]["application/json"];

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
  const body = new URLSearchParams({ username, password }).toString();
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

/** GET /api/v1/monitors/ — the full per-user monitor list. */
export function fetchMonitors(): Promise<MonitorListResponse> {
  return apiFetch<MonitorListResponse>("/api/v1/monitors/");
}

/** POST /api/v1/monitors/ — create a monitor (201). */
export function createMonitor(body: MonitorCreateBody): Promise<MonitorCreateResponse> {
  return apiFetch<MonitorCreateResponse>("/api/v1/monitors/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** DELETE /api/v1/monitors/{id} — a 404 surfaces as `ApiError` (status 404). */
export function deleteMonitor(monitorId: number): Promise<MonitorDeleteResponse> {
  return apiFetch<MonitorDeleteResponse>(`/api/v1/monitors/${monitorId}`, {
    method: "DELETE",
  });
}

import { tokenStore } from "./token";
import { normalizeDetail } from "../../lib/api/errors";

/**
 * One fetch wrapper every API call goes through. Attaches the bearer token,
 * normalizes FastAPI error bodies into `ApiError`, and on 401 clears the
 * token and invokes the registered unauthorized handler.
 *
 * To avoid a client→router import cycle, navigation is not done here: the
 * AuthProvider registers a handler via `setUnauthorizedHandler`.
 */

const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    message: string | undefined,
    fields?: Record<string, string>,
  ) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export interface ApiFetchOptions {
  /**
   * "handler" (default): on 401 clear the token and invoke the registered
   * unauthorized handler. "ignore": still throw ApiError but leave token and
   * handler alone (used by the login call, where a 401 is just bad
   * credentials, not a session expiry).
   */
  onUnauthorized?: "handler" | "ignore";
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = tokenStore.get();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Force JSON only for string bodies the caller did not type; URLSearchParams
  // bodies (form-encoded login) set their own content type.
  if (
    typeof init?.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.ok) {
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  const text = await response.text();
  let detail: unknown = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed !== null && typeof parsed === "object" && "detail" in parsed) {
      detail = (parsed as { detail: unknown }).detail;
    }
  } catch {
    // non-JSON body: degrade to a form-level message below
  }

  if (response.status === 401 && options?.onUnauthorized !== "ignore") {
    tokenStore.clear();
    unauthorizedHandler?.();
  }

  const { message, fields } = normalizeDetail(detail);
  throw new ApiError(response.status, message, fields);
}

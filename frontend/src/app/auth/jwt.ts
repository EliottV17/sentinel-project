/**
 * JWT payload helpers for the proactive-expiry path. Expiry comes only from
 * the token's `exp` claim — no hardcoded lifetime constant.
 */

export interface JwtPayload {
  exp: number;
  sub?: string;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string | null {
  // Pad-safe base64url → binary string.
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  const segments = token.split(".");
  if (segments.length < 2 || segments[1] === "") {
    return null;
  }
  const binary = base64UrlDecode(segments[1]);
  if (binary === null) {
    return null;
  }
  try {
    const json = decodeURIComponent(
      binary
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const parsed: unknown = JSON.parse(json);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { exp?: unknown }).exp === "number"
    ) {
      return parsed as JwtPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when `now` is at or after the token's `exp` (seconds since epoch). */
export function isExpired(payload: JwtPayload, now: Date): boolean {
  return payload.exp * 1000 <= now.getTime();
}

/**
 * True when the token expires within `skewSeconds` (default 60) of `now`, or
 * is already expired. Used by the slow exp-watcher to log users out before
 * they hit a wall of 401s.
 */
export function isExpiringSoon(
  payload: JwtPayload,
  now: Date,
  skewSeconds = 60,
): boolean {
  return payload.exp * 1000 - now.getTime() < skewSeconds * 1000;
}

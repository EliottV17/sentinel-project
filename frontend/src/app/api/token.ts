/**
 * Single source of truth for the JWT access token.
 *
 * In-memory module singleton with write-through to sessionStorage
 * (key `sentinel.access_token`) and read-through restore on first get, so a
 * browser refresh restores the session. Never localStorage — the credential is
 * a 30-minute bearer token and must die with the tab. Pure module: no router
 * or React imports.
 */

const STORAGE_KEY = "sentinel.access_token";

let token: string | null = null;
let restored = false;

function readThrough(): string | null {
  if (!restored) {
    restored = true;
    if (token === null) {
      try {
        token = sessionStorage.getItem(STORAGE_KEY);
      } catch {
        token = null;
      }
    }
  }
  return token;
}

export const tokenStore = {
  get(): string | null {
    return readThrough();
  },
  set(value: string): void {
    token = value;
    restored = true;
    try {
      sessionStorage.setItem(STORAGE_KEY, value);
    } catch {
      // sessionStorage unavailable (SSR / private mode): memory-only token.
    }
  },
  clear(): void {
    token = null;
    restored = true;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};

import { describe, expect, it } from "vitest";
import { decodeJwtPayload, isExpired, isExpiringSoon } from "./jwt";
import type { JwtPayload } from "./jwt";

function b64url(input: string | object): string {
  const bytes = new TextEncoder().encode(
    typeof input === "string" ? input : JSON.stringify(input),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds a real-shape JWT (header.payload.signature) with the given payload. */
function makeToken(payload: object): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.s1gn4tur3`;
}

describe("decodeJwtPayload", () => {
  it("pad-safe decodes a real-shape token payload to {exp, sub}", () => {
    const exp = 1_736_976_000;
    const token = makeToken({ access_token: "x", exp, sub: "user-1", token_type: "bearer" });

    const payload = decodeJwtPayload(token);

    expect(payload).not.toBeNull();
    expect(payload?.exp).toBe(exp);
    expect(payload?.sub).toBe("user-1");
  });

  it("returns null for a malformed payload segment", () => {
    const token = `${b64url({ alg: "HS256" })}.!!!not-base64url!!!.sig`;
    expect(decodeJwtPayload(token)).toBeNull();
  });

  it("returns null when the token has no payload segment", () => {
    expect(decodeJwtPayload("onlyone SEGMENT".replace(" ", ""))).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });

  it("returns null when the payload is not JSON", () => {
    const token = `${b64url({ alg: "HS256" })}.${b64url("not json")}.sig`;
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe("isExpired", () => {
  const payload: JwtPayload = { exp: 1_000_000, sub: "u" };

  it("is false before exp", () => {
    expect(isExpired(payload, new Date(999_999_000))).toBe(false);
  });

  it("is true at and after exp", () => {
    expect(isExpired(payload, new Date(1_000_000_000))).toBe(true);
    expect(isExpired(payload, new Date(1_000_001_000))).toBe(true);
  });
});

describe("isExpiringSoon", () => {
  const exp = 1_000_000;
  const payload: JwtPayload = { exp, sub: "u" };

  it("is false well before the skew window", () => {
    // 120 s of remaining life, default 60 s skew → not expiring soon.
    expect(isExpiringSoon(payload, new Date((exp - 120) * 1000))).toBe(false);
  });

  it("is false exactly at the skew boundary", () => {
    expect(isExpiringSoon(payload, new Date((exp - 60) * 1000))).toBe(false);
  });

  it("is true inside the skew window", () => {
    expect(isExpiringSoon(payload, new Date((exp - 59) * 1000))).toBe(true);
    expect(isExpiringSoon(payload, new Date((exp - 1) * 1000))).toBe(true);
  });

  it("honours a custom skewSeconds", () => {
    expect(isExpiringSoon(payload, new Date((exp - 300) * 1000), 301)).toBe(true);
    expect(isExpiringSoon(payload, new Date((exp - 300) * 1000), 299)).toBe(false);
  });

  it("is true once already expired", () => {
    expect(isExpiringSoon(payload, new Date((exp + 5) * 1000))).toBe(true);
  });
});

/** Builds a real-shape JWT (header.payload.signature) for test fixtures. */
export function makeJwt(payload: { exp: number; sub?: string } & Record<string, unknown>): string {
  const b64url = (input: object | string): string => {
    const bytes = new TextEncoder().encode(
      typeof input === "string" ? input : JSON.stringify(input),
    );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.s1gn4tur3`;
}

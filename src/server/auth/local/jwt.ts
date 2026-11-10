import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A deliberately tiny HS256 JWT implementation for built-in sessions. The app is both
 * the issuer and the only verifier, so a shared secret is the right tool and there is
 * no key distribution to get wrong. Only HS256 is accepted — the header's `alg` is
 * checked against that, never used to pick an algorithm.
 *
 * Pure: the secret is passed in, so this is unit-testable and usable from the CLI.
 */
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export type JwtClaims = Record<string, unknown> & { exp: number; iat: number };

function sign(data: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signJwt(claims: Record<string, unknown>, secret: Buffer, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = Buffer.from(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds })).toString("base64url");
  const data = `${HEADER}.${body}`;
  return `${data}.${sign(data, secret).toString("base64url")}`;
}

/** Returns the claims of a correctly signed, unexpired token; null for anything else. */
export function verifyJwt(token: string, secret: Buffer, now = Date.now()): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  try {
    const { alg, typ } = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: unknown; typ?: unknown };
    if (alg !== "HS256" || (typ !== undefined && typ !== "JWT")) return null;

    const given = Buffer.from(signature, "base64url");
    const expected = sign(`${header}.${body}`, secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

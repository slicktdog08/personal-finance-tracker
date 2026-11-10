import "server-only";
import { signJwt, verifyJwt } from "./jwt";
import { getAuthSecret } from "./secret";
import { findUserById, passwordVersion, type LocalUser } from "./users";
import type { VerifiedAccessToken, VerifiedIdToken } from "../types";

/**
 * Built-in session tokens. Same three-token shape as Cognito's so the cookies, the proxy's
 * refresh path and every guard work unchanged: a one-hour access token (the credential),
 * an id token (display claims only) and a 30-day refresh token.
 */
const ISSUER = "personal-finance-tracker";
export const LOCAL_CLIENT_ID = "local";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export type LocalTokens = { accessToken: string; idToken: string; refreshToken: string };

export async function issueAccessAndIdTokens(user: LocalUser): Promise<{ accessToken: string; idToken: string }> {
  const secret = await getAuthSecret();
  const sub = String(user.id);
  return {
    accessToken: signJwt({ iss: ISSUER, sub, username: user.email, token_use: "access" }, secret, ACCESS_TTL_SECONDS),
    idToken: signJwt(
      { iss: ISSUER, sub, email: user.email, name: user.name ?? undefined, token_use: "id" },
      secret,
      ACCESS_TTL_SECONDS,
    ),
  };
}

export async function issueTokens(user: LocalUser): Promise<LocalTokens> {
  const secret = await getAuthSecret();
  return {
    ...(await issueAccessAndIdTokens(user)),
    refreshToken: signJwt({ iss: ISSUER, sub: String(user.id), pv: passwordVersion(user), token_use: "refresh" }, secret, REFRESH_TTL_SECONDS),
  };
}

/**
 * A long-lived access token for a non-browser client (Claude Code's MCP connection, a
 * script). Unlike a browser session it can't be refreshed, so it is checked against the
 * user's current password on every use: change the password and it stops working.
 */
export async function issueApiToken(user: LocalUser, days: number): Promise<string> {
  const secret = await getAuthSecret();
  return signJwt(
    { iss: ISSUER, sub: String(user.id), username: user.email, token_use: "access", api: true, pv: passwordVersion(user) },
    secret,
    Math.round(days * 24 * 60 * 60),
  );
}

async function verified(token: string, use: "access" | "id" | "refresh") {
  let secret: Buffer;
  try {
    secret = await getAuthSecret();
  } catch (error) {
    // Database unreachable: fail closed, exactly like a bad token.
    console.error("[auth] couldn't load the session signing key", error);
    return null;
  }
  const claims = verifyJwt(token, secret);
  if (!claims || claims.iss !== ISSUER || claims.token_use !== use || typeof claims.sub !== "string") return null;
  return claims;
}

async function userForVersionedToken(sub: string, pv: unknown): Promise<LocalUser | null> {
  const id = Number(sub);
  if (!Number.isInteger(id) || typeof pv !== "string") return null;
  const user = await findUserById(id).catch(() => null);
  return user && passwordVersion(user) === pv ? user : null;
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken | null> {
  const claims = await verified(token, "access");
  if (!claims) return null;
  if (claims.api === true && !(await userForVersionedToken(claims.sub as string, claims.pv))) return null;
  return {
    sub: claims.sub as string,
    username: typeof claims.username === "string" ? claims.username : (claims.sub as string),
    clientId: LOCAL_CLIENT_ID,
    scope: "",
    exp: claims.exp,
  };
}

export async function verifyIdToken(token: string): Promise<VerifiedIdToken | null> {
  const claims = await verified(token, "id");
  if (!claims) return null;
  return {
    sub: claims.sub as string,
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified: true,
    name: typeof claims.name === "string" ? claims.name : undefined,
    exp: claims.exp,
  };
}

/** The user a still-valid refresh token belongs to, or null (expired, forged, password changed, user gone). */
export async function userForRefreshToken(token: string): Promise<LocalUser | null> {
  const claims = await verified(token, "refresh");
  if (!claims) return null;
  return userForVersionedToken(claims.sub as string, claims.pv);
}

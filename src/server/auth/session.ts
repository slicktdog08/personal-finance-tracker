import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken, verifyIdToken } from "./verify";
import {
  ACCESS_TOKEN_COOKIE,
  ID_TOKEN_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIES,
  SESSION_COOKIE_OPTIONS,
} from "./cookie-names";

/**
 * Session cookies. All three are httpOnly, so no browser JS — ours or an injected
 * script — can read the tokens. The proxy and the Data Access Layer are the only
 * readers.
 */
export {
  ACCESS_TOKEN_COOKIE,
  ID_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIES,
} from "./cookie-names";

export type SessionTokens = {
  accessToken: string;
  idToken: string;
  /** Absent on a refresh — Cognito only reissues access/id tokens. */
  refreshToken?: string;
};

/** Writes the session cookies. Only valid inside a Server Action or Route Handler. */
export async function setSessionCookies(tokens: SessionTokens): Promise<void> {
  const store = await cookies();
  const opts = SESSION_COOKIE_OPTIONS;

  store.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, opts);
  store.set(ID_TOKEN_COOKIE, tokens.idToken, opts);
  if (tokens.refreshToken) {
    store.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...opts,
      maxAge: REFRESH_MAX_AGE_SECONDS,
    });
  }
}

/** Clears every session cookie. Only valid inside a Server Action or Route Handler. */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  const opts = SESSION_COOKIE_OPTIONS;
  for (const name of SESSION_COOKIES) {
    // Overwrite with an immediately-expiring value as well as delete(), so the
    // browser drops it even if attribute matching on delete() is imperfect.
    store.set(name, "", { ...opts, maxAge: 0 });
    store.delete(name);
  }
}

export type Session = {
  /** Cognito `sub` — the stable, immutable user id. */
  userId: string;
  username: string;
  email?: string;
  name?: string;
};

/** Extracts the token from `Authorization: Bearer <jwt>`, if the header is well-formed. */
function bearerFromHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim() || undefined;
}

/**
 * Reads and *cryptographically verifies* the session. Returns null when there is no
 * valid session. Never trust the mere presence of a cookie — the token's signature
 * and expiry are checked against the pool's JWKS.
 *
 * The browser app carries the token in the httpOnly cookie. Non-browser clients — the
 * MCP connector in particular — send `Authorization: Bearer`; accepting it here means
 * every guarded query and action works unchanged from a Route Handler that has already
 * been through `withMcpAuth`. Both land on the same verifier, so a bearer token can't
 * widen access beyond what a cookie would.
 *
 * Wrapped in React's `cache()` so a page that calls a dozen guarded queries verifies
 * once per request rather than a dozen times. The cache is per-request, so it can't
 * carry a session across users or outlive a sign-out.
 */
export const getSession = cache(async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const cookieToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const token = cookieToken ?? bearerFromHeader((await headers()).get("authorization"));
  const access = await verifyAccessToken(token);
  if (!access) return null;

  const id = await verifyIdToken(store.get(ID_TOKEN_COOKIE)?.value);
  // The id token is only a source of display claims; a mismatched or missing one
  // must not grant or widen access, so the access token stays authoritative.
  const idClaims = id && id.sub === access.sub ? id : null;

  return {
    userId: access.sub,
    username: access.username,
    email: idClaims?.email,
    name: idClaims?.name,
  };
});

/**
 * The Data Access Layer guard. Every Server Action and every server-side data read
 * calls this before touching the database. The proxy is an optimistic first gate;
 * this is the one that actually protects the data, per the Next.js auth guidance
 * that Server Functions are POSTs to a route and must verify auth themselves.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

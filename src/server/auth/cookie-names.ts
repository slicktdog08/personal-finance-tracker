/**
 * Cookie names and attributes, kept free of `next/headers` so that both the Server
 * Action layer (which uses `cookies()`) and the proxy (which uses NextRequest /
 * NextResponse) can share one definition.
 */
export const ACCESS_TOKEN_COOKIE = "pb_at";
export const ID_TOKEN_COOKIE = "pb_it";
export const REFRESH_TOKEN_COOKIE = "pb_rt";

export const SESSION_COOKIES = [
  ACCESS_TOKEN_COOKIE,
  ID_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
] as const;

/** Cognito refresh tokens default to a 30-day lifetime. */
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * `secure` must be off for plain-http localhost or the browser silently drops the
 * cookie and login appears to succeed but never sticks. Anything deployed is https.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax still sends the cookie on top-level navigations back to the app (so a
  // bookmark or an emailed link lands logged-in) while withholding it from
  // cross-site POSTs, which is the CSRF vector that matters for Server Actions.
  sameSite: "lax" as const,
  path: "/",
};

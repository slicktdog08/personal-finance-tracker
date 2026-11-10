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

/** Refresh tokens last 30 days under both backends (Cognito's default; built-in matches it). */
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * `secure` must be off for plain-http origins or the browser silently drops the cookie and
 * login appears to succeed but never sticks. Deployed installs are https, so production
 * defaults to on; the exceptions are a container reached over plain http (the Docker quick
 * start on http://localhost:3000, or a LAN address), which say so with an http:// APP_URL
 * or AUTH_COOKIE_SECURE=0.
 */
function secureCookies(): boolean {
  const override = process.env.AUTH_COOKIE_SECURE?.trim();
  if (override === "0" || override === "false") return false;
  if (override === "1" || override === "true") return true;
  const appUrl = process.env.APP_URL?.trim().toLowerCase();
  if (appUrl?.startsWith("http://")) return false;
  return process.env.NODE_ENV === "production";
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: secureCookies(),
  // Lax still sends the cookie on top-level navigations back to the app (so a
  // bookmark or an emailed link lands logged-in) while withholding it from
  // cross-site POSTs, which is the CSRF vector that matters for Server Actions.
  sameSite: "lax" as const,
  path: "/",
};

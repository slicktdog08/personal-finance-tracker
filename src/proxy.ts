import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  ID_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIES,
  SESSION_COOKIE_OPTIONS,
} from "@/server/auth/cookie-names";
import { refreshTokens } from "@/server/auth/refresh";
import { verifyAccessToken } from "@/server/auth/verify";
import { MCP_PATH, PROTECTED_RESOURCE_METADATA_PATH, mcpBearerChallenge } from "@/server/mcp/urls";

/**
 * Routes reachable without a session. Everything not listed here — every page, every
 * Server Action POST, every API route — requires a verified Cognito access token.
 *
 * This is an allowlist rather than a blocklist on purpose: a new page added later is
 * protected by default, and forgetting to update this file fails closed.
 */
const PUBLIC_PATHS = new Set(["/login", "/forgot-password"]);

/**
 * OAuth discovery documents are public by the RFCs' definition: a client reads them
 * *before* it has a token, to learn where to get one. Nothing here is sensitive (the
 * MCP URL and Cognito issuer).
 */
/**
 * Bank-sync callbacks are authenticated by the provider's HMAC signature over the raw
 * body (verified in the route), not by a session — an aggregator has no Cognito token. The
 * cron fallback route checks its own bearer secret for the same reason.
 */
const SYNC_WEBHOOK_PREFIX = "/api/sync/webhook/";
const SYNC_RUN_PATH = "/api/sync/run";

const PUBLIC_PREFIXES = [PROTECTED_RESOURCE_METADATA_PATH, SYNC_WEBHOOK_PREFIX];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** The cron route passes when it carries the sync secret; otherwise it needs a session. */
function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.SYNC_CRON_SECRET;
  if (!secret || request.nextUrl.pathname !== SYNC_RUN_PATH) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

/** The login-flow screens specifically — a signed-in visitor gets bounced off these. */
function isAuthScreen(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Only same-origin, path-absolute destinations survive, so `?next=` can't be used to
 * bounce a visitor to an attacker's site after login. `//evil.com` is rejected too —
 * browsers read it as a protocol-relative absolute URL.
 */
function safeReturnPath(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  const target = `${pathname}${search}`;
  if (!target.startsWith("/") || target.startsWith("//")) return "/dashboard";
  return target;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const returnTo = safeReturnPath(request);
  if (returnTo !== "/dashboard") url.searchParams.set("next", returnTo);

  const response = NextResponse.redirect(url);
  // A stale or forged token shouldn't survive the bounce and cause a redirect loop.
  for (const name of SESSION_COOKIES) response.cookies.delete(name);
  return response;
}

function unauthorizedJson(request: NextRequest): NextResponse {
  // The MCP endpoint's challenge carries the RFC 9728 `resource_metadata` pointer so the
  // connector can bootstrap OAuth; other API routes keep the plain realm.
  const challenge = request.nextUrl.pathname.startsWith(MCP_PATH)
    ? mcpBearerChallenge(request)
    : 'Bearer realm="personal-billing"';
  return NextResponse.json(
    { error: "unauthorized", message: "A valid access token is required." },
    { status: 401, headers: { "WWW-Authenticate": challenge } },
  );
}

/** Extracts a bearer token from `Authorization: Bearer <jwt>`. */
function bearerToken(request: NextRequest): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim() || undefined;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // API clients authenticate with a bearer token; the browser app uses cookies. Both
  // land on the same verification, so an API route can't be reached with a token this
  // pool didn't sign.
  const presentedToken = isApi
    ? (bearerToken(request) ?? request.cookies.get(ACCESS_TOKEN_COOKIE)?.value)
    : request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (await verifyAccessToken(presentedToken)) {
    // Already signed in and asking for the login screen — send them to the app.
    if (isAuthScreen(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // The access token is missing or expired. A bearer-token caller manages its own
  // token lifecycle, so only cookie sessions get transparently refreshed here.
  const usedBearer = isApi && bearerToken(request) !== undefined;
  const refreshToken = usedBearer
    ? undefined
    : request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    const refreshed = await refreshTokens(
      refreshToken,
      request.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    );

    if (refreshed.ok) {
      // Rewrite the *request* cookies as well as setting them on the response, so the
      // Server Components rendering this very request see the new token instead of
      // the expired one they'd otherwise read via `cookies()`.
      const headers = new Headers(request.headers);
      const forwarded = new Map(
        request.cookies.getAll().map((c) => [c.name, c.value] as const),
      );
      forwarded.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken);
      forwarded.set(ID_TOKEN_COOKIE, refreshed.idToken);
      headers.set(
        "cookie",
        [...forwarded].map(([name, value]) => `${name}=${value}`).join("; "),
      );

      if (isAuthScreen(pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.search = "";
        const response = NextResponse.redirect(url);
        response.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken, SESSION_COOKIE_OPTIONS);
        response.cookies.set(ID_TOKEN_COOKIE, refreshed.idToken, SESSION_COOKIE_OPTIONS);
        return response;
      }

      const response = NextResponse.next({ request: { headers } });
      response.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken, SESSION_COOKIE_OPTIONS);
      response.cookies.set(ID_TOKEN_COOKIE, refreshed.idToken, SESSION_COOKIE_OPTIONS);
      return response;
    }

    // reason === "error" means Cognito was unreachable rather than the token being
    // bad. Fail closed either way — this app guards financial data, so a transient
    // outage showing a login screen beats serving a page on an unverified session.
  }

  if (isPublic(pathname) || hasCronSecret(request)) return NextResponse.next();
  return isApi ? unauthorizedJson(request) : redirectToLogin(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except Next's own build output and static assets. Without
     * this exclusion the auth check would also gate CSS/JS/images and the login page
     * would render unstyled.
     *
     * Server Actions are POSTs to the page route they're used on, so they are covered
     * by this matcher — but per the Next.js docs that coverage is not something to
     * rely on alone, which is why every action also calls `requireSession()`.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};

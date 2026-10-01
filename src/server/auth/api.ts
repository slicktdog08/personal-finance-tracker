import "server-only";
import { NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "./cookie-names";
import { verifyAccessToken, verifyIdToken } from "./verify";
import { ID_TOKEN_COOKIE } from "./cookie-names";
import type { Session } from "./session";

/**
 * Route Handler guard.
 *
 * Route Handlers are public HTTP endpoints, so they get the same treatment as the
 * Server Actions: the proxy is a first gate, and this re-verifies independently. Use
 * it as the first line of every handler:
 *
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const auth = await requireApiAuth(request);
 *   if (!auth.ok) return auth.response;
 *   // ...auth.session.userId is now trustworthy
 * }
 * ```
 *
 * Accepts either `Authorization: Bearer <accessToken>` (for scripts and non-browser
 * clients) or the httpOnly session cookie (for same-origin fetches from the app).
 */
export type ApiAuthResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: "unauthorized", message },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="personal-billing"' } },
  );
}

export async function requireApiAuth(request: Request): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization");
  let token: string | undefined;

  if (header) {
    const [scheme, value] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !value?.trim()) {
      return { ok: false, response: unauthorized("Expected an `Authorization: Bearer <token>` header.") };
    }
    token = value.trim();
  }

  // Fall back to the browser session cookie for same-origin fetches from the app.
  let idToken: string | undefined;
  if (!token) {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const jar = new Map(
      cookieHeader
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf("=");
          return index === -1
            ? ([part, ""] as const)
            : ([part.slice(0, index), decodeURIComponent(part.slice(index + 1))] as const);
        }),
    );
    token = jar.get(ACCESS_TOKEN_COOKIE);
    idToken = jar.get(ID_TOKEN_COOKIE);
  }

  const access = await verifyAccessToken(token);
  if (!access) {
    return { ok: false, response: unauthorized("A valid access token is required.") };
  }

  const id = await verifyIdToken(idToken);
  const idClaims = id && id.sub === access.sub ? id : null;

  return {
    ok: true,
    session: {
      userId: access.sub,
      username: access.username,
      email: idClaims?.email,
      name: idClaims?.name,
    },
  };
}

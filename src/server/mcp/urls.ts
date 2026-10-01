// Public-facing URLs for the MCP connector. Kept free of `server-only` / `next/headers`
// so the proxy (Node runtime, NextRequest-based) can share the same definitions.

/** Path the MCP Streamable HTTP endpoint is mounted at. */
export const MCP_PATH = "/api/mcp";

/** RFC 9728 protected-resource metadata document. Must be reachable without auth. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * Origin as clients see it. Behind nginx the app only sees `http://127.0.0.1:<port>` plus
 * `Host` / `X-Forwarded-Proto`, so the deploy pins it explicitly; dev falls back to the
 * request's own origin.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** The resource identifier claude.ai must present — the MCP URL exactly as the user enters it. */
export function mcpResourceUrl(request: Request): string {
  return `${publicOrigin(request)}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(request: Request): string {
  return `${publicOrigin(request)}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

/**
 * The `WWW-Authenticate` challenge for an unauthenticated MCP request. Claude only honours
 * the `resource_metadata` pointer on a 401, and without it never discovers the
 * authorization server ("Couldn't reach the MCP server").
 */
export function mcpBearerChallenge(request: Request): string {
  return `Bearer realm="personal-billing", resource_metadata="${protectedResourceMetadataUrl(request)}"`;
}

import { NextResponse } from "next/server";
import { authProvider } from "@/server/auth/provider";
import { mcpResourceUrl } from "@/server/mcp/urls";

// Served to unauthenticated clients by design (the proxy allowlists this path).
export const dynamic = "force-dynamic";

/**
 * RFC 9728 Protected Resource Metadata. This is how an MCP client learns which
 * authorization server guards `/api/mcp`: claude.ai reads it (from the 401's
 * `resource_metadata` pointer, or by probing this well-known path), then fetches
 * Cognito's `<issuer>/.well-known/openid-configuration` to find the hosted-UI
 * authorize/token endpoints and run the PKCE code flow.
 *
 * `resource` must match the MCP URL exactly as the user typed it into claude.ai.
 *
 * Only Cognito is an OAuth authorization server. With built-in auth there is nothing to
 * point at, so this is a 404 and MCP clients connect with a bearer token instead
 * (`npm run auth -- token`; see docs/claude-mcp.md).
 */
export async function GET(request: Request) {
  if (authProvider() !== "cognito") {
    return NextResponse.json(
      { error: "not_found", message: "This install uses built-in auth; connect with a bearer token." },
      { status: 404 },
    );
  }
  const { COGNITO_ISSUER } = await import("@/server/auth/cognito/config");
  return NextResponse.json(
    {
      resource: mcpResourceUrl(request),
      authorization_servers: [COGNITO_ISSUER],
      bearer_methods_supported: ["header"],
      // Cognito requires `openid` for an id token; the access token carries the identity we
      // verify. Claude appends `offline_access` itself only if the issuer advertises it —
      // Cognito issues a refresh token on the code grant regardless.
      scopes_supported: ["openid"],
      resource_name: "Personal Billing",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

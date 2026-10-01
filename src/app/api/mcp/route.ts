import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { verifyAccessToken } from "@/server/auth/verify";
import { registerBillingServer, SERVER_INFO, SERVER_INSTRUCTIONS } from "@/server/mcp/server";
import { mcpResourceUrl, PROTECTED_RESOURCE_METADATA_PATH, publicOrigin } from "@/server/mcp/urls";

// Streams and per-request auth — never cached or prerendered.
export const dynamic = "force-dynamic";
// Tool calls fan out to several DB queries; claude.ai allows up to 240s per call.
export const maxDuration = 60;

/**
 * The MCP endpoint claude.ai connects to (Streamable HTTP, stateless).
 *
 * Auth is layered: the proxy already rejected requests without a valid Cognito access
 * token, `withMcpAuth` re-verifies here and emits the RFC 9728 challenge on failure, and
 * every tool ultimately runs through the same `requireSession()` guard as the web app —
 * `getSession` reads the bearer header when there is no cookie. Three checks, one verifier.
 */
const handler = createMcpHandler((server) => registerBillingServer(server), {
  serverInfo: SERVER_INFO,
  instructions: SERVER_INSTRUCTIONS,
  capabilities: { tools: {}, prompts: {} },
  verboseLogs: process.env.NODE_ENV !== "production",
});

async function verifyToken(request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const claims = await verifyAccessToken(bearerToken);
  if (!claims) return undefined;
  return {
    token: bearerToken!,
    clientId: claims.clientId,
    scopes: claims.scope ? claims.scope.split(" ") : [],
    expiresAt: claims.exp,
    resource: new URL(mcpResourceUrl(request)),
    extra: { userId: claims.sub, username: claims.username },
  };
}

const authed = (request: Request) =>
  withMcpAuth(handler, verifyToken, {
    required: true,
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
    // Despite the name this is the ORIGIN the metadata path is appended to.
    resourceUrl: publicOrigin(request),
  })(request);

export { authed as GET, authed as POST, authed as DELETE };

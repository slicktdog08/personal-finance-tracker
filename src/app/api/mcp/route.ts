import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { verifyAccessToken } from "@/server/auth/verify";
import { registerBillingServer, SERVER_INFO, serverInstructions } from "@/server/mcp/server";
import { getAdvisorProfile } from "@/server/mcp/advisor-context";
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
 *
 * The instructions name the owner from the advisor profile, which lives in the database — so the
 * handler is built on first request and rebuilt only if that name changes.
 */
let built: { owner: string | undefined; handler: (request: Request) => Promise<Response> } | null = null;

async function handlerFor(): Promise<(request: Request) => Promise<Response>> {
  const owner = (await getAdvisorProfile()).name;
  if (!built || built.owner !== owner) {
    built = {
      owner,
      handler: createMcpHandler((server) => registerBillingServer(server), {
        serverInfo: SERVER_INFO,
        instructions: serverInstructions(owner),
        capabilities: { tools: {}, prompts: {} },
        verboseLogs: process.env.NODE_ENV !== "production",
      }),
    };
  }
  return built.handler;
}

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

const authed = async (request: Request) =>
  withMcpAuth(await handlerFor(), verifyToken, {
    required: true,
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
    // Despite the name this is the ORIGIN the metadata path is appended to.
    resourceUrl: publicOrigin(request),
  })(request);

export { authed as GET, authed as POST, authed as DELETE };

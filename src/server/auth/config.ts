import "server-only";

/**
 * Cognito configuration.
 *
 * The pool/client IDs are not secrets (they appear in every Cognito request), which
 * is why they live under NEXT_PUBLIC_*. Nothing in the browser actually reads them —
 * the entire sign-in exchange happens in Server Actions — but the names are kept as
 * the user defined them. Non-public aliases are accepted as a fallback so a deploy
 * can supply them as plain server env vars if preferred.
 */
function required(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(
    `Missing required Cognito env var. Set one of: ${names.join(", ")}. See .env.example.`,
  );
}

export const AWS_REGION = required("NEXT_PUBLIC_AWS_REGION", "AWS_REGION");

export const COGNITO_USER_POOL_ID = required(
  "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
  "COGNITO_USER_POOL_ID",
);

export const COGNITO_CLIENT_ID = required(
  "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID",
  "COGNITO_USER_POOL_CLIENT_ID",
  "COGNITO_CLIENT_ID",
);

/**
 * Only set when the app client was created *with* a secret. Public browser-facing
 * clients normally have none; when present, Cognito requires a SECRET_HASH on every
 * InitiateAuth / RespondToAuthChallenge / ForgotPassword call.
 */
export const COGNITO_CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET?.trim() || undefined;

/**
 * OIDC issuer for the pool. Cognito publishes RFC 8414 / OIDC discovery at
 * `<issuer>/.well-known/openid-configuration`, which is how an MCP client (claude.ai)
 * finds the hosted-UI authorize/token endpoints after reading our protected-resource
 * metadata. Requires a Cognito domain to be configured on the pool.
 */
export const COGNITO_ISSUER = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

/**
 * App client used by the MCP connector (claude.ai). A separate public client from the
 * web app's so the OAuth redirect URI (`https://claude.ai/api/mcp/auth_callback`) and
 * hosted-UI settings live on their own client. Optional: when unset, the MCP route
 * still verifies tokens but only ones minted for the web client.
 */
export const COGNITO_MCP_CLIENT_ID = process.env.COGNITO_MCP_CLIENT_ID?.trim() || undefined;

/** Every app client whose access tokens this app accepts. */
export const COGNITO_ACCEPTED_CLIENT_IDS: string[] = COGNITO_MCP_CLIENT_ID
  ? [COGNITO_CLIENT_ID, COGNITO_MCP_CLIENT_ID]
  : [COGNITO_CLIENT_ID];

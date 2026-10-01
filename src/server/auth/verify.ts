import "server-only";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { COGNITO_ACCEPTED_CLIENT_IDS, COGNITO_USER_POOL_ID } from "./config";

/**
 * JWT verification against the pool's published JWKS. aws-jwt-verify checks the
 * signature, issuer, audience/client_id, token_use and expiry — so a token that
 * passes here was genuinely minted by *our* user pool for one of *our* app clients
 * (the web app's, or the MCP connector's) and is still valid. The JWKS is fetched
 * once and cached in the verifier instance.
 */
const globalForVerify = globalThis as unknown as {
  __accessVerifier?: ReturnType<typeof CognitoJwtVerifier.create>;
  __idVerifier?: ReturnType<typeof CognitoJwtVerifier.create>;
};

export const accessTokenVerifier =
  globalForVerify.__accessVerifier ??
  CognitoJwtVerifier.create({
    userPoolId: COGNITO_USER_POOL_ID,
    tokenUse: "access",
    clientId: COGNITO_ACCEPTED_CLIENT_IDS,
  });

export const idTokenVerifier =
  globalForVerify.__idVerifier ??
  CognitoJwtVerifier.create({
    userPoolId: COGNITO_USER_POOL_ID,
    tokenUse: "id",
    clientId: COGNITO_ACCEPTED_CLIENT_IDS,
  });

if (process.env.NODE_ENV !== "production") {
  globalForVerify.__accessVerifier = accessTokenVerifier;
  globalForVerify.__idVerifier = idTokenVerifier;
}

export type VerifiedAccessToken = {
  sub: string;
  username: string;
  /** App client the token was minted for. */
  clientId: string;
  /** Space-separated OAuth scopes as granted by Cognito (empty for USER_PASSWORD_AUTH tokens). */
  scope: string;
  /** Unix seconds. */
  exp: number;
};

/** Returns the verified claims, or null if the token is missing/expired/forged. */
export async function verifyAccessToken(
  token: string | undefined | null,
): Promise<VerifiedAccessToken | null> {
  if (!token) return null;
  try {
    const payload = await accessTokenVerifier.verify(token);
    return {
      sub: String(payload.sub),
      username: String(payload.username ?? payload.sub),
      clientId: String(payload.client_id),
      scope: typeof payload.scope === "string" ? payload.scope : "",
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export type VerifiedIdToken = {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  exp: number;
};

export async function verifyIdToken(
  token: string | undefined | null,
): Promise<VerifiedIdToken | null> {
  if (!token) return null;
  try {
    const payload = await idTokenVerifier.verify(token);
    return {
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : undefined,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name : undefined,
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

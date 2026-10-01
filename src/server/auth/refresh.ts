import "server-only";
import {
  InitiateAuthCommand,
  NotAuthorizedException,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito, secretHash } from "./cognito";
import { COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET } from "./config";

/**
 * Reads `username` out of a JWT *without verifying it*. Only ever used to build the
 * SECRET_HASH for a refresh call, where the token is already expired (so it cannot be
 * verified) and where a wrong value simply makes Cognito reject the refresh. Never
 * use this to make an authorization decision — that is `verifyAccessToken`'s job.
 */
function unsafeUsernameFromJwt(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    const value = json.username ?? json["cognito:username"] ?? json.sub;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export type RefreshResult =
  | { ok: true; accessToken: string; idToken: string }
  /** The refresh token is expired or revoked — the user must sign in again. */
  | { ok: false; reason: "invalid" }
  /** Cognito was unreachable or errored; the existing session should be left alone. */
  | { ok: false; reason: "error" };

/**
 * Exchanges a refresh token for a fresh access/id token pair. Cognito does not issue
 * a new refresh token here, so the stored one keeps its original 30-day lifetime.
 *
 * Deliberately free of `next/headers` so the proxy can call it directly.
 */
export async function refreshTokens(
  refreshToken: string,
  expiredAccessToken?: string,
): Promise<RefreshResult> {
  try {
    const authParameters: Record<string, string> = { REFRESH_TOKEN: refreshToken };

    if (COGNITO_CLIENT_SECRET) {
      // REFRESH_TOKEN_AUTH hashes against the username rather than the token.
      const username = unsafeUsernameFromJwt(expiredAccessToken);
      const hash = username ? secretHash(username) : undefined;
      if (!hash) return { ok: false, reason: "invalid" };
      authParameters.SECRET_HASH = hash;
    }

    const response = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: authParameters,
      }),
    );

    const result = response.AuthenticationResult;
    if (!result?.AccessToken || !result.IdToken) return { ok: false, reason: "invalid" };

    return { ok: true, accessToken: result.AccessToken, idToken: result.IdToken };
  } catch (error) {
    // A revoked/expired refresh token, or a user that was disabled or deleted.
    if (error instanceof NotAuthorizedException) return { ok: false, reason: "invalid" };
    console.error("[auth] token refresh failed", error);
    return { ok: false, reason: "error" };
  }
}

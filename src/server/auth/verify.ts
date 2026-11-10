import "server-only";
import { authProvider } from "./provider";
import type { VerifiedAccessToken, VerifiedIdToken } from "./types";

export type { VerifiedAccessToken, VerifiedIdToken } from "./types";

/**
 * Token verification, dispatched to whichever backend this install uses. Both check the
 * signature, the token's intended use and its expiry, and both return null (never throw)
 * for anything missing, expired or forged — callers treat null as "not signed in".
 *
 * The backends are imported lazily so an install on built-in auth never loads the AWS
 * SDK or trips over Cognito env vars it doesn't have, and vice versa.
 */
export async function verifyAccessToken(
  token: string | undefined | null,
): Promise<VerifiedAccessToken | null> {
  if (!token) return null;
  if (authProvider() === "cognito") return (await import("./cognito/verify")).verifyAccessToken(token);
  return (await import("./local/tokens")).verifyAccessToken(token);
}

export async function verifyIdToken(
  token: string | undefined | null,
): Promise<VerifiedIdToken | null> {
  if (!token) return null;
  if (authProvider() === "cognito") return (await import("./cognito/verify")).verifyIdToken(token);
  return (await import("./local/tokens")).verifyIdToken(token);
}

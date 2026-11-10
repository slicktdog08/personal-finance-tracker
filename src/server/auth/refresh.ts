import "server-only";
import { authProvider } from "./provider";
import type { RefreshResult } from "./types";

export type { RefreshResult } from "./types";

/**
 * Exchanges a refresh token for a fresh access/id token pair. Neither backend issues a
 * new refresh token here, so the stored one keeps its original 30-day lifetime.
 *
 * Deliberately free of `next/headers` so the proxy can call it directly.
 */
export async function refreshTokens(
  refreshToken: string,
  expiredAccessToken?: string,
): Promise<RefreshResult> {
  if (authProvider() === "cognito") {
    return (await import("./cognito/refresh")).refreshTokens(refreshToken, expiredAccessToken);
  }
  return (await import("./local/flows")).refreshTokens(refreshToken);
}

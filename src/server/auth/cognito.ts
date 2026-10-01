import "server-only";
import { createHmac } from "node:crypto";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import {
  AWS_REGION,
  COGNITO_CLIENT_ID,
  COGNITO_CLIENT_SECRET,
} from "./config";

// Reuse one SDK client (and its keep-alive agent) across hot reloads.
const globalForCognito = globalThis as unknown as {
  __cognitoClient?: CognitoIdentityProviderClient;
};

export const cognito =
  globalForCognito.__cognitoClient ??
  new CognitoIdentityProviderClient({
    region: AWS_REGION,
    // These are unauthenticated Cognito APIs (InitiateAuth, ForgotPassword, ...), so
    // no AWS credentials are needed or wanted. Supplying empty ones stops the SDK's
    // credential chain from probing IMDS/env/profile on every call, which otherwise
    // adds latency and noisy failures in environments with no AWS identity.
    credentials: { accessKeyId: "", secretAccessKey: "" },
  });

if (process.env.NODE_ENV !== "production") globalForCognito.__cognitoClient = cognito;

/**
 * Cognito's SECRET_HASH: Base64(HMAC-SHA256(username + clientId, clientSecret)).
 * Returns undefined for public clients, which is what Cognito expects there.
 */
export function secretHash(username: string): string | undefined {
  if (!COGNITO_CLIENT_SECRET) return undefined;
  return createHmac("sha256", COGNITO_CLIENT_SECRET)
    .update(username + COGNITO_CLIENT_ID)
    .digest("base64");
}

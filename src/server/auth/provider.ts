/**
 * Which sign-in backend this install uses.
 *
 *   local    built-in accounts: a password hash in the `users` table and sessions signed
 *            by the app itself. Needs nothing but the database. The default.
 *   cognito  an AWS Cognito user pool. Chosen automatically when the pool's env vars are
 *            present, so an existing Cognito deploy keeps working with no new setting.
 *
 * `AUTH_PROVIDER` forces one or the other. The public demo (`DEMO_MODE=1`) is always local:
 * it signs visitors in to a throwaway account and must never touch a real user pool.
 *
 * Kept free of `server-only` and `next/*` so the proxy and CLI scripts can share it.
 */
export type AuthProvider = "local" | "cognito";

// One definition of "is this the demo", shared with the bank-sync and advisor guards.
import { isDemoMode } from "../lib/demo/mode";
export { isDemoMode };

export function authProvider(): AuthProvider {
  if (isDemoMode()) return "local";
  const explicit = process.env.AUTH_PROVIDER?.trim().toLowerCase();
  if (explicit === "local" || explicit === "cognito") return explicit;
  if (explicit) {
    throw new Error(`AUTH_PROVIDER must be "local" or "cognito" (got "${explicit}"). See .env.example.`);
  }
  // Looked up by computed name so the bundler can't inline a build-time value: the published
  // Docker image is built once with no Cognito settings and configured when it runs.
  const env = (name: string) => process.env[name];
  const pool = env("NEXT_PUBLIC_COGNITO_USER_POOL_ID") ?? env("COGNITO_USER_POOL_ID");
  // The .env.example placeholder is not a pool.
  return pool && pool.trim() && !/X{6,}/.test(pool) ? "cognito" : "local";
}

import { SyncProviderError } from "../sync/provider";
import type { PlaidError } from "./types";

// Transport for the Plaid API. Every call is a JSON POST carrying client_id + secret in the
// body; the API version is pinned with the Plaid-Version header so a dashboard default can
// never change response shapes under us.
//
// Env (server-only):
//   PLAID_API_CLIENT_ID, PLAID_API_SECRET   — the secret is per environment
//   PLAID_ENV                                — sandbox (default) | production

export const PLAID_VERSION = "2020-09-14";
const TIMEOUT_MS = 60_000;
const MAX_RETRY_WAIT_SEC = 30;

export type PlaidEnv = "sandbox" | "production";

export function plaidEnv(): PlaidEnv {
  const env = (process.env.PLAID_ENV ?? "sandbox").trim().toLowerCase();
  if (env === "sandbox" || env === "production") return env;
  throw new Error(`PLAID_ENV must be sandbox or production, got "${env}".`);
}

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_API_CLIENT_ID?.trim() && process.env.PLAID_API_SECRET?.trim());
}

function credentials(): { client_id: string; secret: string } {
  const client_id = process.env.PLAID_API_CLIENT_ID?.trim();
  const secret = process.env.PLAID_API_SECRET?.trim();
  if (!client_id || !secret) throw new Error("PLAID_API_CLIENT_ID and PLAID_API_SECRET must be set.");
  return { client_id, secret };
}

// Item errors that mean the bank connection itself is broken and only Link update mode (or
// a fresh link) fixes it. Anything else fails the run without flipping the enrollment
// (bank-sync.md D14).
const DISCONNECT_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "ITEM_NOT_FOUND",
  "INVALID_ACCESS_TOKEN",
  "ACCESS_NOT_GRANTED",
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
  "INSUFFICIENT_CREDENTIALS",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "ITEM_LOCKED",
  "USER_SETUP_REQUIRED",
  "NO_ACCOUNTS",
]);

export function isDisconnectCode(code: string | null | undefined): boolean {
  return code != null && DISCONNECT_CODES.has(code);
}

function retryable(status: number, e: PlaidError | null): boolean {
  if (status === 429 || status >= 500) return true;
  return e?.error_type === "RATE_LIMIT_EXCEEDED" || e?.error_type === "API_ERROR" || e?.error_code === "PLANNED_MAINTENANCE";
}

export function toProviderError(status: number, e: PlaidError | null): SyncProviderError {
  const code = e?.error_code ?? "HTTP_ERROR";
  const detail = e?.display_message || e?.error_message || `HTTP ${status}`;
  let message = `Plaid ${code}: ${detail}`;
  if (code === "ITEM_LOGIN_REQUIRED") message = "The bank needs you to sign in again — use Reconnect.";
  else if (code === "PRODUCT_NOT_READY") message = "Plaid is still pulling this bank's history (usually a few minutes after linking). The next sync will pick it up.";
  else if (code === "INVALID_API_KEYS") message = `Plaid rejected the API keys for the ${plaidEnv()} environment — check PLAID_ENV and PLAID_API_SECRET.`;
  return new SyncProviderError(message, {
    code: `plaid.${code}`,
    httpStatus: status,
    disconnected: isDisconnectCode(code),
  });
}

export async function plaidPost<T>(path: string, body: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<T> {
  const url = `https://${plaidEnv()}.plaid.com${path}`;
  const payload = JSON.stringify(opts.auth === false ? body : { ...credentials(), ...body });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Plaid-Version": PLAID_VERSION, "User-Agent": "personal-billing/sync" },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const err = e as Error;
      throw new SyncProviderError(`Couldn't reach Plaid: ${err.name === "TimeoutError" ? "timed out" : err.message}`, { code: "plaid.network" });
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON error page
    }
    if (res.ok) return json as T;
    const perr = json && typeof json === "object" && "error_code" in json ? (json as PlaidError) : null;
    if (retryable(res.status, perr) && attempt < 2) {
      const after = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? after : 2 ** attempt * 2;
      if (wait <= MAX_RETRY_WAIT_SEC) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
    }
    throw toProviderError(res.status, perr);
  }
}

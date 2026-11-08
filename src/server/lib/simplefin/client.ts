import { SyncProviderError } from "../sync/provider";
import type { SfinAccountSet } from "./types";

// Transport for a SimpleFIN server (normally SimpleFIN Bridge). Two calls exist:
//   claim   — POST to the URL a Setup Token decodes to; returns the Access URL, once.
//   accounts — GET {access}/accounts with HTTP Basic auth from the Access URL's userinfo.
// The Access URL is the credential; it is what we encrypt and store as the access token.

const TIMEOUT_MS = 60_000;
const MAX_RETRY_WAIT_SEC = 60;

// Claim/access URLs must be HTTPS. Hosts are limited to simplefin.org unless
// SIMPLEFIN_ALLOW_ANY_HOST=1 (self-hosted SimpleFIN servers), since claiming makes this
// server POST to wherever the pasted token points.
function checkUrl(u: URL, what: string): void {
  if (u.protocol !== "https:") throw new Error(`${what} must be https.`);
  const host = u.hostname.toLowerCase();
  if (process.env.SIMPLEFIN_ALLOW_ANY_HOST !== "1" && host !== "simplefin.org" && !host.endsWith(".simplefin.org")) {
    throw new Error(`${what} points at ${host}, not simplefin.org (set SIMPLEFIN_ALLOW_ANY_HOST=1 for a self-hosted server).`);
  }
}

export interface AccessUrl {
  base: string; // https://host/path — no credentials, no trailing slash
  username: string;
  password: string;
}

export function parseAccessUrl(accessUrl: string): AccessUrl {
  let u: URL;
  try {
    u = new URL(accessUrl.trim());
  } catch {
    throw new Error("That isn't a SimpleFIN Access URL.");
  }
  checkUrl(u, "Access URL");
  if (!u.username || !u.password) throw new Error("The Access URL has no credentials in it.");
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  return { base: u.toString().replace(/\/+$/, ""), username, password };
}

// A Setup Token is base64 of a claim URL. Whitespace from copy/paste is ignored.
export function decodeSetupToken(token: string): URL {
  const decoded = Buffer.from(token.replace(/\s+/g, ""), "base64").toString("utf8");
  let u: URL;
  try {
    u = new URL(decoded);
  } catch {
    throw new Error("That isn't a SimpleFIN Setup Token (it should be the long base64 string from SimpleFIN Bridge).");
  }
  checkUrl(u, "Setup Token");
  return u;
}

// Exchange a Setup Token for the Access URL. Tokens are single-use: a 403 means it was
// already claimed — if not by us, someone else has the access, and it should be disabled
// in Bridge.
export async function claimSetupToken(token: string): Promise<string> {
  const url = decodeSetupToken(token);
  const res = await timedFetch(url.toString(), { method: "POST", headers: { "Content-Length": "0" } });
  const body = (await res.text()).trim();
  if (res.status === 403) {
    throw new SyncProviderError(
      "SimpleFIN refused that Setup Token: it was already claimed or doesn't exist. Create a new token in SimpleFIN Bridge (and disable the old one if you didn't claim it).",
      { code: "simplefin.claim_refused", httpStatus: 403 },
    );
  }
  if (!res.ok) throw new SyncProviderError(`SimpleFIN claim failed (HTTP ${res.status}).`, { code: "simplefin.claim_failed", httpStatus: res.status });
  parseAccessUrl(body); // validate before handing it on
  return body;
}

export interface AccountsQuery {
  startDate?: number; // unix seconds, inclusive
  endDate?: number; // unix seconds, exclusive
  pending?: boolean;
  accountIds?: string[];
  balancesOnly?: boolean;
}

export async function fetchAccountSet(accessUrl: string, q: AccountsQuery = {}): Promise<SfinAccountSet> {
  const { base, username, password } = parseAccessUrl(accessUrl);
  const qs = new URLSearchParams({ version: "2" });
  if (q.startDate != null) qs.set("start-date", String(q.startDate));
  if (q.endDate != null) qs.set("end-date", String(q.endDate));
  if (q.pending) qs.set("pending", "1");
  if (q.balancesOnly) qs.set("balances-only", "1");
  for (const id of q.accountIds ?? []) qs.append("account", id);

  const init: RequestInit = {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "User-Agent": "personal-billing/sync",
    },
  };
  for (let attempt = 0; ; attempt++) {
    const res = await timedFetch(`${base}/accounts?${qs}`, init);
    if (res.ok) {
      const set = (await res.json()) as SfinAccountSet;
      if (!set || !Array.isArray(set.accounts)) {
        throw new SyncProviderError("SimpleFIN returned an unexpected response (no accounts list).", { code: "simplefin.bad_response", httpStatus: res.status });
      }
      return set;
    }
    const text = (await res.text()).slice(0, 300);
    if (res.status === 403) {
      // Access revoked in Bridge (or wrong credentials): only a new Setup Token fixes it.
      throw new SyncProviderError("SimpleFIN rejected the access credentials — the access was revoked or disabled in SimpleFIN Bridge. Reconnect with a new Setup Token.", {
        code: "simplefin.access_revoked",
        httpStatus: 403,
        disconnected: true,
      });
    }
    if (res.status === 402) {
      throw new SyncProviderError("SimpleFIN Bridge says payment is required — check the subscription at bridge.simplefin.org.", { code: "simplefin.payment_required", httpStatus: 402 });
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const wait = res.status === 429 && Number.isFinite(retryAfter) ? retryAfter : 2 ** attempt * 2;
      if (wait <= MAX_RETRY_WAIT_SEC) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
    }
    throw new SyncProviderError(`SimpleFIN request failed (HTTP ${res.status})${text ? `: ${text}` : ""}`, {
      code: res.status === 429 ? "simplefin.rate_limited" : "simplefin.http_error",
      httpStatus: res.status,
      retryAfterSec: res.status === 429 && Number.isFinite(retryAfter) ? retryAfter : null,
    });
  }
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch (e) {
    const err = e as Error;
    throw new SyncProviderError(`Couldn't reach SimpleFIN: ${err.name === "TimeoutError" ? "timed out" : err.message}`, { code: "simplefin.network" });
  }
}

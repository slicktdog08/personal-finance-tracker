import { createHash, createPublicKey, timingSafeEqual, verify as verifySig, type JsonWebKey, type KeyObject } from "crypto";
import type {
  DateRange,
  ProviderAccount,
  ProviderBalances,
  ProviderTransaction,
  ProviderWebhookEvent,
  SyncProvider,
} from "../sync/provider";
import { SyncProviderError } from "../sync/provider";
import { isDisconnectCode, plaidEnv, plaidPost } from "./client";
import { mapAccount, mapBalances, mapTransactions } from "./map";
import type {
  PlaidAccount,
  PlaidAccountsResponse,
  PlaidExchangeResponse,
  PlaidLinkTokenResponse,
  PlaidTransaction,
  PlaidTransactionsGetResponse,
  PlaidWebhookBody,
} from "./types";

export { plaidConfigured, plaidEnv } from "./client";

// Plaid as a SyncProvider. One enrollment = one Plaid Item (one bank login); the Item's
// access token is what sync_enrollments stores, encrypted.
//
// Transactions come from /transactions/get (date-range based, which is what the engine's
// contract speaks), paged 500 at a time per account. Balances come from /accounts/get —
// free, refreshed whenever Plaid refreshes the Item — never /accounts/balance/get, which is
// billed per call. Webhooks (DEFAULT_UPDATE etc.) trigger a sync of that Item.

const CLIENT_NAME = "Personal Billing";
const CLIENT_USER_ID = "personal-billing-owner"; // single-user app
const ACCOUNTS_TTL_MS = 2 * 60_000;
const PAGE = 500;
const WEBHOOK_MAX_AGE_SEC = 5 * 60;

// ---------------------------------------------------------------------------
// Accounts (cached briefly: listAccounts then one getBalances per account in a run)
// ---------------------------------------------------------------------------

interface CachedAccounts {
  at: number;
  res: PlaidAccountsResponse;
  institutionName: string | null;
}
const g = globalThis as unknown as { __plaidAccounts?: Map<string, CachedAccounts>; __plaidInstitutions?: Map<string, string>; __plaidKeys?: Map<string, KeyObject> };
const accountsCache: Map<string, CachedAccounts> = (g.__plaidAccounts ??= new Map());
const institutionNames: Map<string, string> = (g.__plaidInstitutions ??= new Map());
const webhookKeys: Map<string, KeyObject> = (g.__plaidKeys ??= new Map());

function tokenKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export function clearPlaidCache(): void {
  accountsCache.clear();
}

async function institutionName(institutionId: string | null, fromItem?: string | null): Promise<string | null> {
  if (fromItem) return fromItem;
  if (!institutionId) return null;
  const hit = institutionNames.get(institutionId);
  if (hit) return hit;
  try {
    const res = await plaidPost<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: institutionId, country_codes: ["US"] });
    institutionNames.set(institutionId, res.institution.name);
    return res.institution.name;
  } catch {
    return null; // display nicety only
  }
}

async function accountsFor(accessToken: string, fresh = false): Promise<CachedAccounts> {
  const key = tokenKey(accessToken);
  const hit = accountsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ACCOUNTS_TTL_MS) return hit;
  const res = await plaidPost<PlaidAccountsResponse>("/accounts/get", { access_token: accessToken });
  // An Item in an error state still answers /accounts/get with `item.error` set.
  if (res.item?.error && isDisconnectCode(res.item.error.error_code)) {
    throw new SyncProviderError(
      res.item.error.error_code === "ITEM_LOGIN_REQUIRED" ? "The bank needs you to sign in again — use Reconnect." : `Plaid ${res.item.error.error_code}: ${res.item.error.display_message ?? res.item.error.error_message}`,
      { code: `plaid.${res.item.error.error_code}`, disconnected: true },
    );
  }
  const entry: CachedAccounts = { at: Date.now(), res, institutionName: await institutionName(res.item?.institution_id ?? null, res.item?.institution_name) };
  accountsCache.set(key, entry);
  return entry;
}

async function listAccounts(accessToken: string): Promise<ProviderAccount[]> {
  const { res, institutionName: inst } = await accountsFor(accessToken, true);
  const item = { itemId: res.item.item_id, institutionId: res.item.institution_id, institutionName: inst };
  return res.accounts.map((a) => mapAccount(a, item));
}

async function getBalances(accessToken: string, account: { externalId: string }): Promise<ProviderBalances> {
  const { res } = await accountsFor(accessToken);
  const a = res.accounts.find((x: PlaidAccount) => x.account_id === account.externalId);
  if (!a) throw new SyncProviderError("Plaid no longer returns this account.", { code: "plaid.account_missing", accountClosed: true });
  return mapBalances(a);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

async function listTransactions(accessToken: string, account: { externalId: string }, range: DateRange): Promise<ProviderTransaction[]> {
  const rows: PlaidTransaction[] = [];
  for (let offset = 0, guard = 0; guard < 100; guard++) {
    const page = await plaidPost<PlaidTransactionsGetResponse>("/transactions/get", {
      access_token: accessToken,
      start_date: range.startDate,
      end_date: range.endDate,
      options: { account_ids: [account.externalId], count: PAGE, offset, include_personal_finance_category: true },
    });
    rows.push(...page.transactions);
    offset += page.transactions.length;
    if (!page.transactions.length || offset >= page.total_transactions) break;
  }
  return mapTransactions(rows, range);
}

// ---------------------------------------------------------------------------
// Item lifecycle + Link
// ---------------------------------------------------------------------------

// Revokes the access token at Plaid. Note: on the Trial plan this does NOT give the Item
// slot back, and in Production a Transactions Item is billed while its token is valid.
async function deleteEnrollment(accessToken: string): Promise<void> {
  accountsCache.delete(tokenKey(accessToken));
  await plaidPost("/item/remove", { access_token: accessToken });
}

export function plaidWebhookUrl(): string | null {
  const explicit = process.env.PLAID_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const app = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return app?.startsWith("https://") ? `${app}/api/sync/webhook/plaid` : null;
}

// OAuth return page. Derived from APP_URL like the webhook URL, so production needs no extra
// env; PLAID_REDIRECT_URI overrides. Plaid only accepts it if it is also listed under
// Allowed redirect URIs in the dashboard — createLinkToken falls back without it otherwise.
export const PLAID_OAUTH_PATH = "/settings/sync/plaid-oauth";
export function plaidRedirectUri(): string | null {
  const explicit = process.env.PLAID_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const app = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return app?.startsWith("https://") ? `${app}${PLAID_OAUTH_PATH}` : null;
}

function isUnregisteredRedirect(e: unknown): boolean {
  return e instanceof SyncProviderError && e.code === "plaid.INVALID_FIELD" && /redirect/i.test(e.message);
}

// New link: products=transactions. Update mode (reconnect): pass the Item's access token and
// no products — Link then only re-authenticates (and lets the user re-pick accounts).
// `oauthUnavailable` is set (with the URI that was refused) when the redirect isn't
// registered in the dashboard: Link still opens, but banks that sign in on their own site
// can't finish.
export async function createLinkToken(
  opts: { accessToken?: string } = {},
): Promise<{ linkToken: string; expiration: string; oauthUnavailable: { redirectUri: string } | null }> {
  const body: Record<string, unknown> = {
    client_name: CLIENT_NAME,
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: CLIENT_USER_ID },
  };
  const webhook = plaidWebhookUrl();
  if (webhook) body.webhook = webhook;
  const redirect = plaidRedirectUri();
  if (redirect) body.redirect_uri = redirect;
  if (opts.accessToken) {
    body.access_token = opts.accessToken;
    body.update = { account_selection_enabled: true };
  } else {
    body.products = ["transactions"];
    body.transactions = { days_requested: 730 };
  }
  try {
    const res = await plaidPost<PlaidLinkTokenResponse>("/link/token/create", body);
    return { linkToken: res.link_token, expiration: res.expiration, oauthUnavailable: null };
  } catch (e) {
    if (!redirect || !isUnregisteredRedirect(e)) throw e;
    delete body.redirect_uri;
    const res = await plaidPost<PlaidLinkTokenResponse>("/link/token/create", body);
    return { linkToken: res.link_token, expiration: res.expiration, oauthUnavailable: { redirectUri: redirect } };
  }
}

export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const res = await plaidPost<PlaidExchangeResponse>("/item/public_token/exchange", { public_token: publicToken });
  return { accessToken: res.access_token, itemId: res.item_id };
}

// Point an existing Item's webhooks at this app (e.g. an Item linked from a laptop, where
// APP_URL wasn't https).
export async function updateItemWebhook(accessToken: string, webhook: string): Promise<void> {
  await plaidPost("/item/webhook/update", { access_token: accessToken, webhook });
}

// Sandbox-only helpers (CLI + live e2e): create an Item without the Link UI, poke webhooks,
// force the "login required" state.
export const SANDBOX_INSTITUTION = "ins_109508"; // First Platypus Bank
function assertSandbox(): void {
  if (plaidEnv() !== "sandbox") throw new Error("Sandbox-only Plaid helper called with PLAID_ENV=production.");
}
export async function sandboxCreatePublicToken(institutionId = SANDBOX_INSTITUTION): Promise<string> {
  assertSandbox();
  const options: Record<string, unknown> = {};
  const webhook = plaidWebhookUrl();
  if (webhook) options.webhook = webhook;
  const res = await plaidPost<{ public_token: string }>("/sandbox/public_token/create", {
    institution_id: institutionId,
    initial_products: ["transactions"],
    options,
  });
  return res.public_token;
}
export async function sandboxFireWebhook(accessToken: string, code = "DEFAULT_UPDATE"): Promise<void> {
  assertSandbox();
  await plaidPost("/sandbox/item/fire_webhook", { access_token: accessToken, webhook_code: code });
}
export async function sandboxResetLogin(accessToken: string): Promise<void> {
  assertSandbox();
  accountsCache.delete(tokenKey(accessToken));
  await plaidPost("/sandbox/item/reset_login", { access_token: accessToken });
}

// ---------------------------------------------------------------------------
// Webhooks: Plaid-Verification is an ES256 JWT over { iat, request_body_sha256 }, signed by
// a key fetched from /webhook_verification_key/get by its `kid`.
// ---------------------------------------------------------------------------

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function webhookKey(kid: string): Promise<KeyObject | null> {
  const hit = webhookKeys.get(kid);
  if (hit) return hit;
  const res = await plaidPost<{ key: JsonWebKey & { expired_at: number | null } }>("/webhook_verification_key/get", { key_id: kid });
  if (res.key.expired_at != null) return null;
  const { expired_at: _expired, ...jwk } = res.key;
  void _expired;
  const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  webhookKeys.set(kid, key);
  return key;
}

export async function verifyPlaidJwt(rawBody: string, jwt: string | null, nowSec = Math.floor(Date.now() / 1000), keyFor = webhookKey): Promise<boolean> {
  if (!jwt) return false;
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;
  const header = b64urlJson(h);
  if (!header || header.alg !== "ES256" || typeof header.kid !== "string") return false;
  let key: KeyObject | null;
  try {
    key = await keyFor(header.kid);
  } catch {
    return false;
  }
  if (!key) return false;
  const ok = verifySig("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  if (!ok) return false;
  const claims = b64urlJson(p);
  if (!claims || typeof claims.iat !== "number" || nowSec - claims.iat > WEBHOOK_MAX_AGE_SEC) return false;
  const expected = String(claims.request_body_sha256 ?? "");
  const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function plaidWebhookEvent(body: PlaidWebhookBody): ProviderWebhookEvent {
  const itemId = body.item_id;
  if (body.webhook_type === "TRANSACTIONS" && itemId) {
    // DEFAULT_UPDATE / INITIAL_UPDATE / HISTORICAL_UPDATE / TRANSACTIONS_REMOVED /
    // SYNC_UPDATES_AVAILABLE: new data for this Item.
    return { type: "transactions.processed", enrollmentId: itemId };
  }
  if (body.webhook_type === "ITEM" && itemId) {
    if (body.webhook_code === "WEBHOOK_UPDATE_ACKNOWLEDGED") return { type: "test" };
    if (body.webhook_code === "USER_PERMISSION_REVOKED" || body.webhook_code === "USER_ACCOUNT_REVOKED") {
      return { type: "enrollment.disconnected", enrollmentId: itemId, reason: body.webhook_code };
    }
    if (body.webhook_code === "ERROR" && isDisconnectCode(body.error?.error_code)) {
      return { type: "enrollment.disconnected", enrollmentId: itemId, reason: body.error!.error_code };
    }
  }
  return { type: "other", raw: body };
}

async function verifyWebhook(rawBody: string, headers: Headers): Promise<ProviderWebhookEvent | null> {
  if (!(await verifyPlaidJwt(rawBody, headers.get("plaid-verification")))) return null;
  try {
    return plaidWebhookEvent(JSON.parse(rawBody) as PlaidWebhookBody);
  } catch {
    return null;
  }
}

// Dry runs: the last /accounts/get response for this Item (balances as Plaid sent them).
function debugResponse(accessToken: string): unknown {
  const hit = accountsCache.get(tokenKey(accessToken));
  if (!hit) return null;
  return { fetchedAt: new Date(hit.at).toISOString(), environment: plaidEnv(), item: hit.res.item, accounts: hit.res.accounts };
}

export const plaidProvider: SyncProvider = {
  id: "plaid",
  listAccounts,
  listTransactions,
  getBalances,
  deleteEnrollment: (accessToken) => deleteEnrollment(accessToken),
  verifyWebhook,
  debugResponse,
};

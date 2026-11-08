import { createHash } from "crypto";
import { addDaysIso } from "../sync/reconcile";
import {
  SyncProviderError,
  type DateRange,
  type ExternalAccountType,
  type ProviderAccount,
  type ProviderBalances,
  type ProviderTransaction,
  type SyncProvider,
} from "../sync/provider";
import { todayIso } from "../pay-schedule";
import { fetchAccountSet, parseAccessUrl } from "./client";
import { externalAccountId, localIsoToUnix, mapAccount, mapBalances, transactionsInRange } from "./map";
import type { SfinAccount, SfinAccountSet, SfinConnection, SfinError } from "./types";

export { claimSetupToken, parseAccessUrl } from "./client";

// SimpleFIN Bridge as a SyncProvider. One "enrollment" = one Access URL, which can cover
// every bank connection the user added in Bridge; each account carries its connection's name
// as the institution.
//
// Quota: Bridge expects ≤ 24 requests a day per access and disables tokens that keep going
// over, and its data refreshes about once a day. One GET /accounts returns every account's
// balances AND transactions, so a run fetches once and serves listAccounts / listTransactions
// / getBalances for all accounts from that response (cached briefly in-process). A typical
// run is one request; only a backfill reaching further back than the cached window adds
// more (one per ≤ 87-day chunk for that account).

const CACHE_TTL_MS = 10 * 60_000;
// The first fetch of a run covers this many days, so every account's normal window
// (sync_window_days, default 10, plus a held pending row or two) is served from it.
const PREFETCH_DAYS = 30;
// Bridge caps start-date..end-date at 90 days; the fetch adds a day before and two after.
const MAX_SPAN_DAYS = 87;

interface Cached {
  at: number;
  startDate: string; // inclusive local ISO range the cached transactions cover
  endDate: string;
  set: SfinAccountSet;
}

const g = globalThis as unknown as { __simplefinCache?: Map<string, Cached> };
const cache: Map<string, Cached> = (g.__simplefinCache ??= new Map());

function cacheKey(accessUrl: string): string {
  return createHash("sha256").update(accessUrl).digest("hex");
}

export function clearSimplefinCache(): void {
  cache.clear();
}

// Stable enrollment id for an Access URL: Bridge issues a distinct username per access.
export function simplefinEnrollmentId(accessUrl: string): string {
  return `sf_${createHash("sha256").update(parseAccessUrl(accessUrl).username).digest("hex").slice(0, 16)}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((localIsoToUnix(b) - localIsoToUnix(a)) / 86_400);
}

async function fetchRange(accessUrl: string, startDate: string, endDate: string, accountIds?: string[]): Promise<SfinAccountSet> {
  const set = await fetchAccountSet(accessUrl, {
    startDate: localIsoToUnix(addDaysIso(startDate, -1)),
    endDate: localIsoToUnix(addDaysIso(endDate, 2)),
    pending: true,
    accountIds,
  });
  throwIfAuthError(set.errlist ?? []);
  for (const e of set.errlist ?? []) {
    if (!e.account_id && !e.conn_id) console.warn(`[simplefin] ${e.code}: ${e.msg}`);
  }
  return set;
}

// Every-account response covering at least `range` (or whatever is fresh, when no range
// is asked for).
async function accountSet(accessUrl: string, range?: DateRange): Promise<Cached> {
  const key = cacheKey(accessUrl);
  const hit = cache.get(key);
  const fresh = hit && Date.now() - hit.at < CACHE_TTL_MS ? hit : null;
  if (fresh && (!range || (fresh.startDate <= range.startDate && fresh.endDate >= range.endDate))) return fresh;

  const today = todayIso();
  const endDate = range && range.endDate > today ? range.endDate : today;
  let startDate = addDaysIso(today, -PREFETCH_DAYS);
  if (range && range.startDate < startDate) startDate = range.startDate;
  if (daysBetween(startDate, endDate) > MAX_SPAN_DAYS) {
    // Too wide for one request — the caller chunks per account instead.
    startDate = addDaysIso(endDate, -MAX_SPAN_DAYS);
  }
  const entry: Cached = { at: Date.now(), startDate, endDate, set: await fetchRange(accessUrl, startDate, endDate) };
  cache.set(key, entry);
  return entry;
}

// gen.auth means the access itself is no good — the whole enrollment needs reconnecting.
function throwIfAuthError(errs: SfinError[]): void {
  const auth = errs.find((e) => e.code === "gen.auth" || e.code.startsWith("gen.auth."));
  if (auth) throw new SyncProviderError(`SimpleFIN: ${auth.msg}`, { code: "simplefin.access_revoked", disconnected: true });
}

// Errors scoped to one account, or to the bank connection it belongs to (con.auth = that
// bank needs re-authenticating inside Bridge). The account's data may be stale or partial,
// so it is not synced this run — a missing pending row would otherwise be expired.
function accountError(set: SfinAccountSet, a: SfinAccount): SyncProviderError | null {
  const conn = a.conn_id ? set.connections?.find((c) => c.conn_id === a.conn_id) : undefined;
  const e = (set.errlist ?? []).find((x) => x.account_id === a.id || (a.conn_id != null && x.conn_id === a.conn_id && !x.account_id));
  if (!e) return null;
  const where = conn?.name ? `${conn.name}: ` : "";
  const hint = e.code.startsWith("con.auth") ? " — fix the connection in SimpleFIN Bridge." : "";
  return new SyncProviderError(`SimpleFIN ${where}${e.msg}${hint}`, { code: `simplefin.${e.code}` });
}

function findAccount(set: SfinAccountSet, externalId: string): SfinAccount {
  const a = set.accounts.find((x) => externalAccountId(x.id) === externalId);
  if (!a) throw new SyncProviderError("SimpleFIN didn't return this account this time (its connection may be failing in Bridge).", { code: "simplefin.account_missing" });
  return a;
}

async function listAccounts(accessUrl: string): Promise<ProviderAccount[]> {
  const { set } = await accountSet(accessUrl);
  const conns = new Map<string, SfinConnection>((set.connections ?? []).map((c) => [c.conn_id, c]));
  const enrollmentId = simplefinEnrollmentId(accessUrl);
  return set.accounts.map((a) => mapAccount(a, conns, enrollmentId));
}

async function listTransactions(accessUrl: string, account: { externalId: string }, range: DateRange): Promise<ProviderTransaction[]> {
  const today = todayIso();
  if (daysBetween(range.startDate, range.endDate) <= MAX_SPAN_DAYS) {
    const { set } = await accountSet(accessUrl, range);
    const a = findAccount(set, account.externalId);
    const err = accountError(set, a);
    if (err) throw err;
    return transactionsInRange(a, range, today);
  }
  // Long backfill (a first sync from an early sync_from): this account alone, in chunks.
  const { set: listing } = await accountSet(accessUrl);
  const rawId = findAccount(listing, account.externalId).id;
  const byId = new Map<string, ProviderTransaction>();
  for (let start = range.startDate; start <= range.endDate; start = addDaysIso(start, MAX_SPAN_DAYS + 1)) {
    const endCandidate = addDaysIso(start, MAX_SPAN_DAYS);
    const chunk: DateRange = { startDate: start, endDate: endCandidate < range.endDate ? endCandidate : range.endDate };
    const set = await fetchRange(accessUrl, chunk.startDate, chunk.endDate, [rawId]);
    const a = findAccount(set, account.externalId);
    const err = accountError(set, a);
    if (err) throw err;
    for (const t of transactionsInRange(a, chunk, today)) byId.set(t.externalId, t);
  }
  return [...byId.values()];
}

async function getBalances(accessUrl: string, account: { externalId: string; type: ExternalAccountType }): Promise<ProviderBalances> {
  const { set } = await accountSet(accessUrl);
  return mapBalances(findAccount(set, account.externalId), account.type);
}

// Every account field is kept (balances, extra, holdings); transactions are cut to a few
// samples plus a count so a run row stays small.
const DEBUG_TXN_SAMPLES = 3;
function debugResponse(accessUrl: string): unknown {
  const hit = cache.get(cacheKey(accessUrl));
  if (!hit) return null;
  return {
    fetchedAt: new Date(hit.at).toISOString(),
    window: { startDate: hit.startDate, endDate: hit.endDate },
    errlist: hit.set.errlist ?? [],
    connections: hit.set.connections ?? [],
    accounts: hit.set.accounts.map(({ transactions, ...a }) => ({
      ...a,
      transactionCount: transactions?.length ?? 0,
      transactionSamples: (transactions ?? []).slice(0, DEBUG_TXN_SAMPLES),
    })),
  };
}

export const simplefinProvider: SyncProvider = {
  id: "simplefin",
  // An account can drop out of a response while its bank connection is failing in Bridge;
  // that is not a closure.
  unlistedMeansClosed: false,
  listAccounts,
  listTransactions,
  getBalances,
  // SimpleFIN has no revoke call: access is disabled from the Bridge website. Forget the
  // cached response so nothing more is served from it.
  async deleteEnrollment(accessUrl: string) {
    cache.delete(cacheKey(accessUrl));
  },
  // No webhooks in SimpleFIN; the scheduler polls.
  verifyWebhook: () => null,
  debugResponse,
};

// Shared fixtures for the e2e suite. These tests write for real — accounts, transactions,
// imports, sync runs, settings — so they run against the throwaway database in .env.test,
// never the one the app uses. `assertLocalDatabase` below enforces that.
//
// Everything they create is still tagged and torn down, because a shared scratch database
// that accumulates junk stops being a useful test of "what does the app see": local
// accounts labelled "[e2e] …", a provider id of "e2efake", a category rule with an
// unmistakable pattern, the import batches the fixtures commit, and sync_runs created
// after the suite started.
//
// Run with: npm run test:e2e   (node --test, one file at a time)

import { and, eq, gt, inArray, like, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { accountBalances, accounts, categoryMappings, importBatches, syncAccounts, syncEnrollments, syncIgnored, syncRuns, syncSettings, transactions } from "@/server/db/schema";
import { parseDbUrl } from "@/server/lib/db-url";
import {
  registerSyncProvider,
  SyncProviderError,
  type DateRange,
  type ProviderAccount,
  type ProviderBalances,
  type ProviderTransaction,
  type ProviderWebhookEvent,
  type SyncProvider,
} from "@/server/lib/sync/provider";
import { todayIso } from "@/server/lib/pay-schedule";
import { addDaysIso } from "@/server/lib/sync/reconcile";

export const FAKE = "e2efake";
export const TODAY = todayIso();
export const daysAgo = (n: number) => addDaysIso(TODAY, -n);

// Tests need a token key; use a throwaway one when the env doesn't provide it.
if (!process.env.SYNC_TOKEN_ENCRYPTION_KEY) {
  process.env.SYNC_TOKEN_ENCRYPTION_KEY = "e2e".padEnd(64, "0").replace(/[^0-9a-f]/g, "0");
}

// ---------------------------------------------------------------------------
// In-memory provider: scripted per test.
// ---------------------------------------------------------------------------
export class FakeProvider implements SyncProvider {
  readonly id = FAKE;
  accounts: ProviderAccount[] = [];
  txns = new Map<string, ProviderTransaction[]>();
  balances = new Map<string, ProviderBalances>();
  failListAccounts: SyncProviderError | null = null;
  failTransactionsFor = new Map<string, SyncProviderError>();
  calls = { listAccounts: 0, listTransactions: 0, getBalances: 0, deleteEnrollment: 0 };
  lastRanges: DateRange[] = [];
  rangeByAccount = new Map<string, DateRange>();
  deleted: string[] = [];

  async listAccounts(): Promise<ProviderAccount[]> {
    this.calls.listAccounts++;
    if (this.failListAccounts) throw this.failListAccounts;
    return this.accounts.map((a) => ({ ...a }));
  }
  async listTransactions(_t: string, account: { externalId: string }, range: DateRange): Promise<ProviderTransaction[]> {
    this.calls.listTransactions++;
    this.lastRanges.push(range);
    this.rangeByAccount.set(account.externalId, range);
    const err = this.failTransactionsFor.get(account.externalId);
    if (err) throw err;
    return (this.txns.get(account.externalId) ?? []).filter((t) => t.txnDate >= range.startDate && t.txnDate <= range.endDate).map((t) => ({ ...t }));
  }
  async getBalances(_t: string, externalAccountId: string): Promise<ProviderBalances> {
    this.calls.getBalances++;
    return this.balances.get(externalAccountId) ?? { ledger: null, available: null };
  }
  async deleteEnrollment(_t: string, enrollmentId: string): Promise<void> {
    this.calls.deleteEnrollment++;
    this.deleted.push(enrollmentId);
  }
  verifyWebhook(rawBody: string, headers: Headers): ProviderWebhookEvent | null {
    if (headers.get("x-e2e-sig") !== "ok") return null;
    const e = JSON.parse(rawBody) as { type: string; enrollmentId?: string; reason?: string };
    if (e.type === "transactions.processed" && e.enrollmentId) return { type: "transactions.processed", enrollmentId: e.enrollmentId };
    if (e.type === "enrollment.disconnected" && e.enrollmentId) return { type: "enrollment.disconnected", enrollmentId: e.enrollmentId, reason: e.reason ?? null };
    if (e.type === "test") return { type: "test" };
    return { type: "other", raw: e };
  }
}

export const fake = new FakeProvider();
registerSyncProvider(fake);

export function acct(p: Partial<ProviderAccount> & { externalId: string; lastFour: string; type: "depository" | "credit" }): ProviderAccount {
  return {
    enrollmentId: "enr_e2e",
    name: `Fake ${p.type} ${p.lastFour}`,
    subtype: p.type === "credit" ? "credit_card" : "checking",
    currency: "USD",
    institutionId: "fakebank",
    institutionName: "Fake Bank",
    status: "open",
    ...p,
  };
}

export function txn(p: Partial<ProviderTransaction> & { externalId: string; externalAccountId: string }): ProviderTransaction {
  return {
    txnDate: daysAgo(1),
    description: "FAKE MERCHANT",
    amount: 12.34,
    direction: "Debit",
    status: "posted",
    rawCategory: null,
    kind: "card_payment",
    counterparty: null,
    runningBalance: null,
    raw: { fixture: true },
    ...p,
  };
}

// ---------------------------------------------------------------------------
// DB fixtures + teardown
// ---------------------------------------------------------------------------
export interface Fixtures {
  checkingId: number; // local account fed by the fake checking (last four 1111)
  creditId: number; // local account fed by the fake card (last four 2222)
  ruleId: number; // category rule: description contains E2E-RULE → category "Dining"
  runStartId: number; // sync_runs.id high-water mark at setup
  batchStartId: number; // import_batches.id high-water mark at setup
  settingsBefore: typeof syncSettings.$inferSelect;
}

// ---------------------------------------------------------------------------
// Where am I allowed to run?
// ---------------------------------------------------------------------------

// This suite writes: it inserts accounts, commits imports, triggers whole-ledger sync runs,
// prunes sync_runs and rewrites sync_settings. For its whole life it did all of that to the
// production database, because .env.local was the only env file the preload could actually
// read (see tests/env-test.cjs) and the only latch was the enrollment check below — which a
// database with no bank linked passes happily.
//
// So the first thing the suite checks now is the host, not the contents. Only a database on
// the loopback qualifies; anything else is someone's real data until proven otherwise.
// tests/env-test.cjs enforces the same rule at preload, before anything can open a
// connection, and that is the gate that matters. This one is a backstop for a process that
// was started without that preload, so keep the two in step: local host, or an override
// that names the exact host it unlocks (never a bare flag — a bare flag is how the
// production database got written to while this very guard was being tested).
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

export function assertLocalDatabase(): void {
  const { host, port, database } = parseDbUrl(process.env.DATABASE_URL ?? "");
  if (LOCAL_HOSTS.has(host)) return;
  if (process.env.E2E_ALLOW_REMOTE_DB === host) {
    console.warn(`\n⚠  E2E_ALLOW_REMOTE_DB=${host} — this suite will create and delete rows in ${database}.\n`);
    return;
  }
  throw new Error(
    `Refusing to run e2e against a non-local database: ${database} @ ${host}:${port}.\n\n` +
      `  This suite creates, mutates and deletes rows. Point it at the throwaway database:\n` +
      `      cp .env.test.example .env.test   (once)\n` +
      `      npm run db:test:up\n` +
      `      npm run test:e2e\n\n` +
      `  To allow it anyway, name the host: E2E_ALLOW_REMOTE_DB=${host}`,
  );
}

// Second latch, kept for the day a real bank provider is wired up: these tests trigger
// whole-ledger runs (`runSync` with no enrollment, scheduler `tick`), which would reach the
// real bank and touch real rows if a live enrollment existed here.
export async function assertNoLiveEnrollments(): Promise<void> {
  if (process.env.E2E_ALLOW_LIVE_ENROLLMENTS === "1") return;
  const live = await db
    .select({ provider: syncEnrollments.provider, name: syncEnrollments.institutionName })
    .from(syncEnrollments)
    .where(ne(syncEnrollments.provider, FAKE));
  if (live.length) {
    throw new Error(
      `Refusing to run e2e: ${live.length} live enrollment(s) exist in this database (${live
        .map((l) => `${l.provider}:${l.name ?? "?"}`)
        .join(", ")}). Point .env.test at a scratch DB, or set E2E_ALLOW_LIVE_ENROLLMENTS=1 if you accept that runs will reach the bank.`,
    );
  }
}

export async function setupFixtures(): Promise<Fixtures> {
  assertLocalDatabase(); // before any query: this one must not need a connection to fail
  await assertNoLiveEnrollments();
  await teardownFixtures(); // in case a previous run died mid-way
  await db.insert(accounts).values([
    { accountNumber: "1111", label: "[e2e] Checking", institution: "Fake Bank", accountType: "Checking" },
    { accountNumber: "2222", label: "[e2e] Card", institution: "Fake Bank", accountType: "Credit" },
  ]);
  const rows = await db.select({ id: accounts.id, n: accounts.accountNumber }).from(accounts).where(like(accounts.label, "[e2e]%"));
  const checkingId = rows.find((r) => r.n === "1111")!.id;
  const creditId = rows.find((r) => r.n === "2222")!.id;

  await db.insert(categoryMappings).values({ matchType: "contains", pattern: "E2E-RULE", field: "description", category: "Dining", priority: 1 });
  const [rule] = await db.select({ id: categoryMappings.id }).from(categoryMappings).where(eq(categoryMappings.pattern, "E2E-RULE")).limit(1);

  const [hw] = await db.select({ m: sql<number>`COALESCE(MAX(${syncRuns.id}), 0)` }).from(syncRuns);
  const [bhw] = await db.select({ m: sql<number>`COALESCE(MAX(${importBatches.id}), 0)` }).from(importBatches);
  const [settingsBefore] = await db.select().from(syncSettings).where(eq(syncSettings.id, 1)).limit(1);
  if (!settingsBefore) {
    throw new Error("sync_settings has no id=1 row — is this database built from tests/db/schema.sql?");
  }
  // Known-good defaults for the suite; restored in teardown.
  await db
    .update(syncSettings)
    .set({ enabled: false, syncWindowDays: 10, pendingExpiryDays: 7, recordBalances: true, autoCategorize: true, webhookEnabled: true, lockUntil: null, nextRunAt: null })
    .where(eq(syncSettings.id, 1));

  return { checkingId, creditId, ruleId: rule.id, runStartId: Number(hw?.m ?? 0), batchStartId: Number(bhw?.m ?? 0), settingsBefore };
}

export async function teardownFixtures(f?: Fixtures): Promise<void> {
  const fixtureAccounts = await db.select({ id: accounts.id }).from(accounts).where(like(accounts.label, "[e2e]%"));
  const ids = fixtureAccounts.map((a) => a.id);
  await db.delete(transactions).where(eq(transactions.source, FAKE));
  if (ids.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, ids));
    await db.delete(accountBalances).where(inArray(accountBalances.accountId, ids));
  }
  await db.delete(syncEnrollments).where(eq(syncEnrollments.provider, FAKE)); // cascades sync_accounts
  await db.delete(syncIgnored).where(eq(syncIgnored.source, FAKE));
  // Runs created by this suite. Only runs with no live enrollment can exist (see the latch),
  // so everything after the high-water mark is ours.
  if (f) await db.delete(syncRuns).where(gt(syncRuns.id, f.runStartId));
  if (ids.length) await db.delete(accounts).where(inArray(accounts.id, ids));
  await db.delete(categoryMappings).where(eq(categoryMappings.pattern, "E2E-RULE"));
  // Import batches the fixtures committed. Rows hang off them, not the other way around, so
  // the transaction deletes above already emptied them — same high-water-mark trick as runs.
  // (This is the table the suite silently accumulated 48 rows in before it was given its own
  // database; nothing used to clean it.)
  if (f) await db.delete(importBatches).where(gt(importBatches.id, f.batchStartId));
  if (f) {
    const b = f.settingsBefore;
    await db
      .update(syncSettings)
      .set({
        enabled: b.enabled,
        intervalMinutes: b.intervalMinutes,
        syncWindowDays: b.syncWindowDays,
        pendingExpiryDays: b.pendingExpiryDays,
        recordBalances: b.recordBalances,
        autoCategorize: b.autoCategorize,
        webhookEnabled: b.webhookEnabled,
        lockUntil: null,
        nextRunAt: b.nextRunAt,
        // Scheduler bookkeeping the runs above moved. lastRunId in particular would be left
        // pointing at a sync_run this teardown just deleted.
        lastRunId: b.lastRunId,
        lastWebhookAt: b.lastWebhookAt,
      })
      .where(eq(syncSettings.id, 1));
  }
}

// Auto-matched accounts start disabled (a guess must be confirmed); tests confirm them.
export async function enableAllFakeAccounts(): Promise<void> {
  const enr = await db.select({ id: syncEnrollments.id }).from(syncEnrollments).where(eq(syncEnrollments.provider, FAKE));
  if (enr.length) await db.update(syncAccounts).set({ enabled: true }).where(inArray(syncAccounts.enrollmentId, enr.map((e) => e.id)));
}

export async function fakeRows(accountId?: number) {
  return db
    .select()
    .from(transactions)
    .where(accountId ? and(eq(transactions.source, FAKE), eq(transactions.accountId, accountId)) : eq(transactions.source, FAKE))
    .orderBy(transactions.externalId);
}

export async function closePool(): Promise<void> {
  const g = globalThis as unknown as { __billingPool?: { end(): Promise<void> } };
  await g.__billingPool?.end();
}

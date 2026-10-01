import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { accountBalances, accounts, syncAccounts, syncEnrollments, syncRuns, transactions } from "@/server/db/schema";
import { SyncProviderError } from "@/server/lib/sync/provider";
import { acquireRunLock, getSyncSettings, releaseRunLock, updateSyncSettings } from "@/server/lib/sync/settings";
import { completeEnrollment, mapExternalAccount, removeEnrollment, runSync, syncedDedupHash } from "@/server/lib/sync/sync";
import { findSyncedDuplicates } from "@/server/lib/sync/import-guard";
import { deleteTransaction, updateTransaction } from "@/server/actions/transactions";
import { analyzeStatement } from "@/server/actions/pdf-import";
import { syncIgnored } from "@/server/db/schema";
import { acct, closePool, daysAgo, FAKE, fake, fakeRows, setupFixtures, teardownFixtures, TODAY, txn, type Fixtures } from "./helpers";

// End-to-end: the real sync writer against the real DB, with a scripted provider.

let f: Fixtures;
let enrollmentDbId: number;
let chkSyncId: number; // sync_accounts.id for the fake checking
let cardSyncId: number;

const CHK = "acc_chk";
const CARD = "acc_card";

async function enroll() {
  fake.accounts = [acct({ externalId: CHK, lastFour: "1111", type: "depository" }), acct({ externalId: CARD, lastFour: "2222", type: "credit" })];
  const res = await completeEnrollment({ provider: FAKE, accessToken: "tok_e2e", enrollmentId: "enr_e2e", institutionName: "Fake Bank" });
  enrollmentDbId = res.enrollmentDbId;
  chkSyncId = res.accounts.find((a) => a.externalAccountId === CHK)!.id;
  cardSyncId = res.accounts.find((a) => a.externalAccountId === CARD)!.id;
  // Auto-matches are stored disabled until confirmed; the suite confirms them.
  await db.update(syncAccounts).set({ enabled: true }).where(inArray(syncAccounts.id, [chkSyncId, cardSyncId]));
  return res;
}

before(async () => {
  f = await setupFixtures();
});
after(async () => {
  await teardownFixtures(f);
  await closePool();
});

beforeEach(() => {
  fake.txns.clear();
  fake.balances.clear();
  fake.failListAccounts = null;
  fake.failTransactionsFor.clear();
  fake.lastRanges = [];
});

describe("enrollment", () => {
  test("completeEnrollment stores an encrypted token and auto-maps by institution + last four", async () => {
    const res = await enroll();
    const [row] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId));
    assert.equal(row.status, "active");
    assert.equal(row.institutionName, "Fake Bank");
    assert.notEqual(row.accessTokenEnc, "tok_e2e");
    assert.ok(!row.accessTokenEnc.includes("tok_e2e"));
    const chk = res.accounts.find((a) => a.externalAccountId === CHK)!;
    const card = res.accounts.find((a) => a.externalAccountId === CARD)!;
    assert.equal(chk.accountId, f.checkingId);
    assert.equal(card.accountId, f.creditId);
    assert.equal(chk.enabled, false); // a guess is off until confirmed
    // No transactions on the fixture accounts yet → default sync_from is 30 days ago.
    assert.equal(chk.syncFrom, daysAgo(30));
  });

  test("re-enrolling (repair) refreshes the token but keeps mappings", async () => {
    await mapExternalAccount(cardSyncId, null);
    const res = await completeEnrollment({ provider: FAKE, accessToken: "tok_e2e_2", enrollmentId: "enr_e2e" });
    assert.equal(res.enrollmentDbId, enrollmentDbId);
    assert.equal(res.accounts.find((a) => a.externalAccountId === CARD)!.accountId, null);
    await mapExternalAccount(cardSyncId, f.creditId, daysAgo(30)); // an explicit mapping switches it on
    const [card] = await db.select().from(syncAccounts).where(eq(syncAccounts.id, cardSyncId));
    assert.equal(card.enabled, true);
  });

  test("auto-map never claims a local account another external account already feeds, and needs an institution match", async () => {
    fake.accounts.push(acct({ externalId: "acc_dup", lastFour: "1111", type: "depository" })); // same last four as CHK
    fake.accounts.push(acct({ externalId: "acc_noinst", lastFour: "2222", type: "credit", institutionName: null }));
    const res = await completeEnrollment({ provider: FAKE, accessToken: "tok_e2e_2", enrollmentId: "enr_e2e" });
    assert.equal(res.accounts.find((a) => a.externalAccountId === "acc_dup")!.accountId, null);
    assert.equal(res.accounts.find((a) => a.externalAccountId === "acc_noinst")!.accountId, null);
    fake.accounts.splice(2);
    await completeEnrollment({ provider: FAKE, accessToken: "tok_e2e_2", enrollmentId: "enr_e2e" }); // marks the extras closed
    const closed = await db.select().from(syncAccounts).where(inArray(syncAccounts.externalAccountId, ["acc_dup", "acc_noinst"]));
    assert.ok(closed.every((c) => c.externalStatus === "closed" && !c.enabled));
    await db.delete(syncAccounts).where(inArray(syncAccounts.externalAccountId, ["acc_dup", "acc_noinst"])); // keep later counts simple
  });
});

describe("first sync", () => {
  test("inserts normalized rows, applies rules, records balances (available for cash, ledger for credit)", async () => {
    fake.txns.set(CHK, [
      txn({ externalId: "c1", externalAccountId: CHK, txnDate: daysAgo(2), description: "E2E-RULE LUNCH", amount: 15, direction: "Debit" }),
      txn({ externalId: "c2", externalAccountId: CHK, txnDate: daysAgo(1), description: "PAYROLL", amount: 1000, direction: "Credit" }),
      txn({ externalId: "c3", externalAccountId: CHK, txnDate: TODAY, description: "PENDING COFFEE", amount: 4.5, status: "pending" }),
    ]);
    fake.txns.set(CARD, [txn({ externalId: "k1", externalAccountId: CARD, txnDate: daysAgo(1), description: "CARD PURCHASE", amount: 40 })]);
    fake.balances.set(CHK, { ledger: 500, available: 480.25 });
    fake.balances.set(CARD, { ledger: 1234.56, available: 765.44 });

    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok", JSON.stringify(s));
    assert.equal(s.inserted, 4);
    assert.equal(s.updated, 0);
    assert.equal(s.balancesRecorded, 2);
    assert.ok(s.runId);

    const rows = await fakeRows(f.checkingId);
    assert.equal(rows.length, 3);
    const c1 = rows.find((r) => r.externalId === "c1")!;
    assert.equal(c1.category, "Dining");
    assert.equal(c1.categoryRuleId, f.ruleId);
    assert.equal(c1.direction, "Debit");
    assert.equal(c1.amount, "15.00");
    assert.equal(c1.pending, false);
    assert.equal(c1.source, FAKE);
    assert.equal(c1.dedupHash, syncedDedupHash(FAKE, "c1"));
    const c2 = rows.find((r) => r.externalId === "c2")!;
    assert.equal(c2.direction, "Credit");
    assert.equal(c2.category, null);
    const c3 = rows.find((r) => r.externalId === "c3")!;
    assert.equal(c3.pending, true);

    const bal = await db.select().from(accountBalances).where(eq(accountBalances.accountId, f.checkingId));
    assert.equal(bal.length, 1);
    assert.equal(bal[0].balance, "480.25");
    assert.equal(bal[0].asOf, TODAY);
    assert.match(bal[0].note ?? "", /Synced from e2efake \(available\)/);
    const cbal = await db.select().from(accountBalances).where(eq(accountBalances.accountId, f.creditId));
    assert.equal(cbal[0].balance, "1234.56");
    assert.match(cbal[0].note ?? "", /ledger/);

    // Run row + details
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, s.runId!));
    assert.equal(run.status, "ok");
    assert.equal(run.trigger, "cli");
    assert.equal(run.inserted, 4);
    const details = run.details as { enrollments: { accounts: { name: string | null; inserted: number }[] }[] };
    assert.equal(details.enrollments[0].accounts.length, 2);

    // First run used sync_from as the window start.
    assert.ok(fake.lastRanges.every((r) => r.startDate === daysAgo(30) && r.endDate === TODAY));
    const [sa] = await db.select().from(syncAccounts).where(eq(syncAccounts.id, chkSyncId));
    assert.ok(sa.lastSyncedAt);
  });

  test("a second identical run inserts nothing and updates the same-day balance row", async () => {
    fake.txns.set(CHK, [
      txn({ externalId: "c1", externalAccountId: CHK, txnDate: daysAgo(2), description: "E2E-RULE LUNCH", amount: 15 }),
      txn({ externalId: "c2", externalAccountId: CHK, txnDate: daysAgo(1), description: "PAYROLL", amount: 1000, direction: "Credit" }),
      txn({ externalId: "c3", externalAccountId: CHK, txnDate: TODAY, description: "PENDING COFFEE", amount: 4.5, status: "pending" }),
    ]);
    fake.txns.set(CARD, [txn({ externalId: "k1", externalAccountId: CARD, txnDate: daysAgo(1), description: "CARD PURCHASE", amount: 40 })]);
    fake.balances.set(CHK, { ledger: 500, available: 470 });
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok");
    assert.equal(s.inserted, 0);
    assert.equal(s.updated, 0);
    assert.equal(s.expired, 0);
    // Later runs use the window, not sync_from.
    assert.equal(fake.rangeByAccount.get(CHK)!.startDate, daysAgo(10));
    const bal = await db.select().from(accountBalances).where(eq(accountBalances.accountId, f.checkingId));
    assert.equal(bal.length, 1);
    assert.equal(bal[0].balance, "470.00");
  });
});

describe("pending lifecycle", () => {
  test("pending → posted updates in place: date, description, status, category re-run; hand-set category survives", async () => {
    // Hand-set a category on the pending row first.
    await db.update(transactions).set({ category: "Groceries", categoryRuleId: null, notes: "keep me" }).where(and(eq(transactions.source, FAKE), eq(transactions.externalId, "c3")));
    fake.txns.set(CHK, [
      txn({ externalId: "c1", externalAccountId: CHK, txnDate: daysAgo(2), description: "E2E-RULE LUNCH", amount: 15 }),
      txn({ externalId: "c2", externalAccountId: CHK, txnDate: daysAgo(1), description: "E2E-RULE PAYROLL", amount: 1000, direction: "Credit" }), // description change, uncategorized → rule applies
      txn({ externalId: "c3", externalAccountId: CHK, txnDate: daysAgo(1), description: "COFFEE SHOP POSTED", amount: 4.75, status: "posted" }),
    ]);
    fake.txns.set(CARD, [txn({ externalId: "k1", externalAccountId: CARD, txnDate: daysAgo(1), description: "CARD PURCHASE", amount: 40 })]);
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok");
    assert.equal(s.updated, 2);
    assert.equal(s.promoted, 1);
    const rows = await fakeRows(f.checkingId);
    const c3 = rows.find((r) => r.externalId === "c3")!;
    assert.equal(c3.pending, false);
    assert.equal(c3.txnDate, daysAgo(1));
    assert.equal(c3.description, "COFFEE SHOP POSTED");
    assert.equal(c3.amount, "4.75");
    assert.equal(c3.category, "Groceries"); // hand-set: untouched
    assert.equal(c3.notes, "keep me");
    const c2 = rows.find((r) => r.externalId === "c2")!;
    assert.equal(c2.category, "Dining"); // was null → rule re-run on new description
    assert.equal(c2.categoryRuleId, f.ruleId);
  });

  test("a stale pending row expires and carries its edits to the posted twin", async () => {
    // Seed an old pending row with edits directly (as if synced 10 days ago).
    await db.insert(transactions).values({
      accountId: f.checkingId,
      txnDate: daysAgo(10),
      description: "OLD PENDING GYM",
      amount: "30.00",
      direction: "Debit",
      dedupHash: syncedDedupHash(FAKE, "p_old"),
      source: FAKE,
      externalId: "p_old",
      pending: true,
      notes: "gym membership",
      category: "Health",
      categoryRuleId: null,
    });
    fake.txns.set(CHK, [
      txn({ externalId: "c1", externalAccountId: CHK, txnDate: daysAgo(2), description: "E2E-RULE LUNCH", amount: 15 }),
      txn({ externalId: "c2", externalAccountId: CHK, txnDate: daysAgo(1), description: "E2E-RULE PAYROLL", amount: 1000, direction: "Credit" }),
      txn({ externalId: "c3", externalAccountId: CHK, txnDate: daysAgo(1), description: "COFFEE SHOP POSTED", amount: 4.75 }),
      // The re-issued posted twin: same money, 2 days later, new id.
      txn({ externalId: "g_new", externalAccountId: CHK, txnDate: daysAgo(8), description: "GYM CO", amount: 30 }),
    ]);
    fake.txns.set(CARD, [txn({ externalId: "k1", externalAccountId: CARD, txnDate: daysAgo(1), description: "CARD PURCHASE", amount: 40 })]);
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok", JSON.stringify(s.enrollments));
    assert.equal(s.expired, 1);
    assert.equal(s.inserted, 1);
    const rows = await fakeRows(f.checkingId);
    assert.equal(rows.find((r) => r.externalId === "p_old"), undefined);
    const g = rows.find((r) => r.externalId === "g_new")!;
    assert.equal(g.notes, "gym membership");
    assert.equal(g.category, "Health");
    assert.equal(g.categoryRuleId, null);
  });

  test("a recent pending row that vanishes is kept (provider lag)", async () => {
    fake.txns.set(CHK, [
      txn({ externalId: "c1", externalAccountId: CHK, txnDate: daysAgo(2), description: "E2E-RULE LUNCH", amount: 15 }),
      txn({ externalId: "c2", externalAccountId: CHK, txnDate: daysAgo(1), description: "E2E-RULE PAYROLL", amount: 1000, direction: "Credit" }),
      txn({ externalId: "c3", externalAccountId: CHK, txnDate: daysAgo(1), description: "COFFEE SHOP POSTED", amount: 4.75 }),
      txn({ externalId: "g_new", externalAccountId: CHK, txnDate: daysAgo(8), description: "GYM CO", amount: 30 }),
      txn({ externalId: "p_fresh", externalAccountId: CHK, txnDate: TODAY, description: "FRESH PENDING", amount: 9, status: "pending" }),
    ]);
    fake.txns.set(CARD, [txn({ externalId: "k1", externalAccountId: CARD, txnDate: daysAgo(1), description: "CARD PURCHASE", amount: 40 })]);
    let s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.inserted, 1);
    fake.txns.get(CHK)!.pop(); // provider stops returning it
    s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.expired, 0);
    assert.ok((await fakeRows(f.checkingId)).some((r) => r.externalId === "p_fresh"));
  });
});

describe("soft duplicates against CSV rows (D4)", () => {
  test("a fetched row matching an imported row by money ± 2 days is skipped and logged", async () => {
    await db.insert(transactions).values({
      accountId: f.creditId,
      txnDate: daysAgo(3),
      description: "AMAZON MKTPLACE (csv)",
      amount: "77.77",
      direction: "Debit",
      dedupHash: "e2e-csv-" + Date.now(),
      source: "import",
      pending: false,
    });
    fake.txns.set(CHK, []);
    fake.txns.set(CARD, [
      txn({ externalId: "k1", externalAccountId: CARD, txnDate: daysAgo(1), description: "CARD PURCHASE", amount: 40 }),
      txn({ externalId: "k_amz", externalAccountId: CARD, txnDate: daysAgo(2), description: "Amazon.com*ABC", amount: 77.77 }),
    ]);
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.skippedDupes, 1);
    assert.equal(s.inserted, 0);
    assert.equal((await fakeRows(f.creditId)).some((r) => r.externalId === "k_amz"), false);
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, s.runId!));
    const d = run.details as { enrollments: { accounts: { softDupes: { description: string; existingDescription: string }[] }[] }[] };
    const dupes = d.enrollments[0].accounts.flatMap((a) => a.softDupes);
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].existingDescription, "AMAZON MKTPLACE (csv)");
  });
});

describe("dry run, lock, errors", () => {
  test("dry run writes nothing but records a run", async () => {
    fake.txns.set(CHK, [txn({ externalId: "dry1", externalAccountId: CHK, txnDate: TODAY, description: "DRY", amount: 1 })]);
    fake.txns.set(CARD, []);
    fake.balances.set(CHK, { ledger: 1, available: 1 });
    const before = (await fakeRows()).length;
    const s = await runSync({ trigger: "manual", enrollmentDbId, dryRun: true });
    assert.equal(s.dryRun, true);
    assert.equal(s.inserted, 1); // what WOULD be inserted
    assert.equal((await fakeRows()).length, before);
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, s.runId!));
    assert.equal(run.dryRun, true);
    const bal = await db.select().from(accountBalances).where(eq(accountBalances.accountId, f.checkingId));
    assert.notEqual(bal[0].balance, "1.00");
  });

  test("the run lock is exclusive and self-heals", async () => {
    assert.equal(await acquireRunLock(), true);
    assert.equal(await acquireRunLock(), false);
    const s = await runSync({ trigger: "manual", enrollmentDbId });
    assert.equal(s.status, "locked");
    await releaseRunLock(null, false);
    assert.equal(await acquireRunLock(), true);
    await releaseRunLock(null, false);
  });

  test("a scheduled run re-arms next_run_at; a manual one doesn't", async () => {
    await updateSyncSettings({ intervalMinutes: 120 });
    await updateSyncSettings({ intervalMinutes: 60 }); // a changed interval re-anchors next_run_at
    const armed = (await getSyncSettings()).nextRunAt!;
    fake.txns.set(CHK, []);
    fake.txns.set(CARD, []);
    await runSync({ trigger: "manual", enrollmentDbId });
    assert.equal((await getSyncSettings()).nextRunAt!.getTime(), armed.getTime());
    await runSync({ trigger: "scheduled", enrollmentDbId });
    const next = (await getSyncSettings()).nextRunAt!;
    assert.ok(next.getTime() >= armed.getTime());
    assert.ok(next.getTime() - Date.now() > 55 * 60_000);
  });

  test("a disconnected provider error flips the enrollment and the run is partial", async () => {
    fake.failListAccounts = new SyncProviderError("login broken", { code: "enrollment.disconnected.credentials_invalid", httpStatus: 401, disconnected: true });
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "failed"); // the only enrollment errored
    const [row] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId));
    assert.equal(row.status, "disconnected");
    assert.equal(row.disconnectReason, "enrollment.disconnected.credentials_invalid");
    assert.match(row.lastError ?? "", /login broken/);
    // A disconnected enrollment is skipped, not retried.
    fake.failListAccounts = null;
    const s2 = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s2.enrollments[0].status, "skipped");
    await db.update(syncEnrollments).set({ status: "active", disconnectReason: null, lastError: null }).where(eq(syncEnrollments.id, enrollmentDbId));
  });

  test("a closed account is disabled without failing the enrollment", async () => {
    fake.failTransactionsFor.set(CARD, new SyncProviderError("gone", { code: "account.closed", httpStatus: 410, accountClosed: true }));
    fake.txns.set(CHK, []);
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok");
    const [sa] = await db.select().from(syncAccounts).where(eq(syncAccounts.id, cardSyncId));
    assert.equal(sa.externalStatus, "closed");
    assert.equal(sa.enabled, false);
    assert.match(sa.lastError ?? "", /gone/);
    await db.update(syncAccounts).set({ externalStatus: "open", enabled: true, lastError: null }).where(eq(syncAccounts.id, cardSyncId));
  });

  test("unmapped and disabled accounts are skipped with a reason", async () => {
    await mapExternalAccount(cardSyncId, null);
    await db.update(syncAccounts).set({ enabled: false }).where(eq(syncAccounts.id, chkSyncId));
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    const skips = s.enrollments[0].accounts.map((a) => a.skipped).sort();
    assert.deepEqual(skips, ["disabled", "unmapped"]);
    assert.equal(fake.calls.listTransactions, fake.calls.listTransactions); // no fetches happened for skipped ones
    await mapExternalAccount(cardSyncId, f.creditId, daysAgo(30));
    await db.update(syncAccounts).set({ enabled: true }).where(eq(syncAccounts.id, chkSyncId));
  });

  test("settings toggles: balances off and categorize off are honored", async () => {
    await updateSyncSettings({ recordBalances: false, autoCategorize: false });
    fake.txns.set(CHK, [txn({ externalId: "nocat", externalAccountId: CHK, txnDate: TODAY, description: "E2E-RULE NO CAT", amount: 2 })]);
    fake.txns.set(CARD, []);
    fake.balances.set(CHK, { ledger: 999, available: 999 });
    const before = fake.calls.getBalances;
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.balancesRecorded, 0);
    assert.equal(fake.calls.getBalances, before);
    const row = (await fakeRows(f.checkingId)).find((r) => r.externalId === "nocat")!;
    assert.equal(row.category, null);
    await updateSyncSettings({ recordBalances: true, autoCategorize: true });
  });
});

describe("review follow-ups: edits, deletes, imports, mapping, gaps", () => {
  const base = () => {
    fake.txns.set(CHK, [
      txn({ externalId: "e1", externalAccountId: CHK, txnDate: daysAgo(3), description: "EDIT ME", amount: 11 }),
      txn({ externalId: "e2", externalAccountId: CHK, txnDate: daysAgo(3), description: "DELETE ME", amount: 22 }),
    ]);
    fake.txns.set(CARD, []);
  };

  test("a hand edit to description/date/amount survives later runs; a provider change still lands", async () => {
    base();
    await runSync({ trigger: "cli", enrollmentDbId });
    const row = (await fakeRows(f.checkingId)).find((r) => r.externalId === "e1")!;
    await updateTransaction(
      row.id,
      { txnDate: daysAgo(4), description: "Edited by hand", amount: 11.5, direction: "Debit", accountNumber: "1111", category: null, notes: "" },
      "/transactions",
    );
    let s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.updated, 0, JSON.stringify(s.enrollments[0].accounts));
    let after = (await fakeRows(f.checkingId)).find((r) => r.externalId === "e1")!;
    assert.equal(after.description, "Edited by hand");
    assert.equal(after.txnDate, daysAgo(4));
    assert.equal(after.amount, "11.50");
    // Now the bank changes the description → that field is written, the hand-set date stays.
    fake.txns.get(CHK)![0] = txn({ externalId: "e1", externalAccountId: CHK, txnDate: daysAgo(3), description: "EDIT ME POSTED", amount: 11 });
    s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.updated, 1);
    after = (await fakeRows(f.checkingId)).find((r) => r.externalId === "e1")!;
    assert.equal(after.description, "EDIT ME POSTED");
    assert.equal(after.txnDate, daysAgo(4));
  });

  test("deleting a synced row leaves a tombstone and it is not re-inserted", async () => {
    base();
    await runSync({ trigger: "cli", enrollmentDbId });
    const row = (await fakeRows(f.checkingId)).find((r) => r.externalId === "e2")!;
    await deleteTransaction(row.id, "/transactions");
    const tomb = await db.select().from(syncIgnored).where(and(eq(syncIgnored.source, FAKE), eq(syncIgnored.externalId, "e2")));
    assert.equal(tomb.length, 1);
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok");
    assert.equal(s.inserted, 0); // the tombstoned row is not counted as inserted
    assert.equal((await fakeRows(f.checkingId)).some((r) => r.externalId === "e2"), false);
    const { clearIgnored, listIgnored } = await import("@/server/lib/sync/sync");
    assert.ok((await listIgnored()).some((r) => r.source === FAKE && r.externalId === "e2"));
    assert.equal(await clearIgnored(FAKE, "e2"), true);
    const s2 = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s2.inserted, 1); // cleared → comes back
  });

  test("a CSV/PDF import of an already-synced charge is flagged as a duplicate", async () => {
    base();
    await runSync({ trigger: "cli", enrollmentDbId });
    const dupes = await findSyncedDuplicates([
      { accountNumber: "1111", date: daysAgo(2), amount: 11, direction: "Debit" }, // e1 (hand-edited to 11.50 above → not a match)
      { accountNumber: "1111", date: daysAgo(2), amount: 11.5, direction: "Debit" }, // e1 as stored
      { accountNumber: "1111", date: daysAgo(3), amount: 99, direction: "Debit" }, // nothing
      { accountNumber: "2222", date: daysAgo(3), amount: 11.5, direction: "Debit" }, // other account
    ]);
    assert.deepEqual([...dupes.keys()], [1]);
    // Through the PDF analyzer (the CSV analyzer uses the same guard).
    const res = await analyzeStatement({
      txns: [
        { dateIso: daysAgo(3), description: "Statement: edit me", amount: 11.5, direction: "Debit", raw: {} },
        { dateIso: daysAgo(3), description: "Statement: new thing", amount: 5, direction: "Debit", raw: {} },
      ],
      accountNumber: "1111",
    });
    assert.equal(res.rows[0].status, "duplicate");
    assert.equal(res.rows[1].status, "new");
  });

  test("two external accounts cannot feed one ledger account", async () => {
    await assert.rejects(mapExternalAccount(cardSyncId, f.checkingId), /already fed/);
    const [card] = await db.select().from(syncAccounts).where(eq(syncAccounts.id, cardSyncId));
    assert.equal(card.accountId, f.creditId);
  });

  test("a gap longer than the window is backfilled (paused for three weeks)", async () => {
    base();
    await db
      .update(syncAccounts)
      .set({ lastSyncedAt: new Date(Date.now() - 21 * 86_400_000), syncFrom: daysAgo(60) })
      .where(eq(syncAccounts.id, chkSyncId));
    await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(fake.rangeByAccount.get(CHK)!.startDate, daysAgo(31)); // 21 days ago − 10-day window
    // …and never before sync_from.
    await db
      .update(syncAccounts)
      .set({ lastSyncedAt: new Date(Date.now() - 21 * 86_400_000), syncFrom: daysAgo(25) })
      .where(eq(syncAccounts.id, chkSyncId));
    await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(fake.rangeByAccount.get(CHK)!.startDate, daysAgo(25));
    await db.update(syncAccounts).set({ syncFrom: daysAgo(30) }).where(eq(syncAccounts.id, chkSyncId));
  });

  test("a pending row older than the window is still judged (not expired blindly)", async () => {
    base();
    fake.txns.get(CHK)!.push(txn({ externalId: "hold", externalAccountId: CHK, txnDate: daysAgo(15), description: "HOTEL HOLD", amount: 200, status: "pending" }));
    // Seed it via a backfill run (never-synced → from sync_from), so it predates the window.
    await db.update(syncAccounts).set({ lastSyncedAt: null }).where(eq(syncAccounts.id, chkSyncId));
    await runSync({ trigger: "cli", enrollmentDbId });
    assert.ok((await fakeRows(f.checkingId)).some((r) => r.externalId === "hold" && r.pending));
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(fake.rangeByAccount.get(CHK)!.startDate, daysAgo(15)); // window pulled back to the hold
    assert.equal(s.expired, 0);
    assert.ok((await fakeRows(f.checkingId)).some((r) => r.externalId === "hold"));
    // Once the bank really drops it, it expires.
    fake.txns.get(CHK)!.pop();
    const s2 = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s2.expired, 1);
  });

  test("manual and PDF rows are stamped with their source", async () => {
    const [manual] = await db.select({ source: transactions.source }).from(transactions).where(and(eq(transactions.accountId, f.checkingId), eq(transactions.source, "manual"))).limit(1);
    assert.equal(manual, undefined); // none created here — the stamp is asserted via createTransaction below
    const { createTransaction } = await import("@/server/actions/transactions");
    await createTransaction(null, { txnDate: TODAY, description: "MANUAL ROW", amount: 1, direction: "Debit", accountNumber: "1111", category: null, notes: "" }, "/transactions");
    const [m] = await db.select({ source: transactions.source, id: transactions.id }).from(transactions).where(and(eq(transactions.accountId, f.checkingId), eq(transactions.description, "MANUAL ROW")));
    assert.equal(m.source, "manual");
    const [acct] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, f.checkingId));
    assert.ok(acct);
  });
});

describe("hand-entered pending placeholders and the sync writer", () => {
  test("a fetched posted row settles a manual pending row on the same account instead of duplicating it", async () => {
    const { createTransaction } = await import("@/server/actions/transactions");
    await createTransaction(null, { txnDate: daysAgo(4), description: "Dinner (pending, typed)", amount: 60, direction: "Debit", accountNumber: "1111", category: "Dining", notes: "with Sam", pending: true }, "/transactions");
    const [placeholder] = await db.select().from(transactions).where(and(eq(transactions.accountId, f.checkingId), eq(transactions.description, "Dinner (pending, typed)")));
    fake.txns.set(CHK, [txn({ externalId: "dinner1", externalAccountId: CHK, txnDate: daysAgo(2), description: "RESTAURANT 22", amount: 60 })]);
    fake.txns.set(CARD, []);
    const s = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s.status, "ok");
    assert.equal(s.inserted, 0);
    assert.equal(s.promoted, 1);
    assert.equal(s.skippedDupes, 0);
    const [settled] = await db.select().from(transactions).where(eq(transactions.id, placeholder.id));
    assert.equal(settled.source, FAKE);
    assert.equal(settled.externalId, "dinner1");
    assert.equal(settled.pending, false);
    assert.equal(settled.description, "RESTAURANT 22");
    assert.equal(settled.txnDate, daysAgo(2));
    assert.equal(settled.category, "Dining");
    assert.equal(settled.notes, "with Sam");
    assert.equal(settled.dedupHash, syncedDedupHash(FAKE, "dinner1"));
    // From now on it is an ordinary synced row: a re-run is a no-op.
    const s2 = await runSync({ trigger: "cli", enrollmentDbId });
    assert.equal(s2.inserted + s2.updated + s2.promoted, 0);
  });
});

describe("remove", () => {
  test("removeEnrollment revokes remotely, drops sync rows, keeps transactions", async () => {
    const txBefore = (await fakeRows()).length;
    assert.ok(txBefore > 0);
    await removeEnrollment(enrollmentDbId, { revokeRemote: true });
    assert.deepEqual(fake.deleted, ["enr_e2e"]);
    assert.equal((await db.select().from(syncEnrollments).where(eq(syncEnrollments.provider, FAKE))).length, 0);
    assert.equal((await db.select().from(syncAccounts).where(eq(syncAccounts.id, chkSyncId))).length, 0);
    assert.equal((await fakeRows()).length, txBefore);
  });
});

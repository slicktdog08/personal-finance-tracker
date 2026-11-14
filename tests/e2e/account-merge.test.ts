import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accountAliases, accountBalances, accounts, categoryMappings, transactions } from "@/server/db/schema";
import { changeAccountNumber, createAccount, createLiabilityAccount, mergeAccount, previewAccountMerge } from "@/server/actions/accounts";
import { createTransaction } from "@/server/actions/transactions";
import { analyzeStatement, commitPdfStatements } from "@/server/actions/pdf-import";
import { closePool, daysAgo, setupFixtures, teardownFixtures, type Fixtures } from "./helpers";

// A reissued card changes its last four, so an old statement makes a second account. Merging
// folds it into the current one and keeps the old number as an alias — the part that matters
// most is what the importers do with that number afterwards.

const OLD = "3333"; // the card's number before it was reissued as 2222 (f.creditId)
let f: Fixtures;
let oldId: number;

const OLD_STATEMENT = [
  { dateIso: daysAgo(40), description: "GROCER ANYTOWN", amount: 42.5, direction: "Debit" as const, raw: {} },
  { dateIso: daysAgo(38), description: "CARD A EPAY", amount: 100, direction: "Credit" as const, raw: {} },
];

const importAs = async (accountNumber: string, txns: typeof OLD_STATEMENT, filename = "old.pdf") => {
  const preview = await analyzeStatement({ txns, accountNumber });
  const res = await commitPdfStatements([{ filename, accountNumber, institution: null, accountType: null, rows: preview.rows, balances: [] }]);
  return { preview, res };
};
const accountByNumber = async (n: string) => (await db.select().from(accounts).where(eq(accounts.accountNumber, n)))[0];
const txnsOn = (id: number) => db.select().from(transactions).where(eq(transactions.accountId, id));
const balancesOn = (id: number) => db.select().from(accountBalances).where(eq(accountBalances.accountId, id)).orderBy(accountBalances.asOf);

before(async () => {
  f = await setupFixtures();
  // The old statement is imported first — that is how the duplicate account comes to exist.
  const { res } = await importAs(OLD, OLD_STATEMENT);
  assert.equal(res.inserted, 2);
  oldId = (await accountByNumber(OLD)).id;
  await db.update(accounts).set({ label: "[e2e] Old card", accountType: "Credit", openedOn: "2020-01-15" }).where(eq(accounts.id, oldId));
  await db.insert(accountBalances).values([
    { accountId: oldId, balance: "500.00", asOf: daysAgo(40) },
    { accountId: oldId, balance: "0.00", asOf: daysAgo(10) }, // same day as the new card's first
    { accountId: f.creditId, balance: "520.00", asOf: daysAgo(10) },
    { accountId: f.creditId, balance: "530.00", asOf: daysAgo(5) },
  ]);
  await db.insert(categoryMappings).values({ matchType: "contains", pattern: "E2E-RULE", field: "description", category: "Groceries", accountId: oldId, priority: 2 });
});
after(async () => {
  await teardownFixtures(f);
  await closePool();
});

describe("merging a reissued card's old account into the current one", () => {
  test("the preview counts what would move and changes nothing", async () => {
    const res = await previewAccountMerge(oldId, f.creditId);
    assert.ok(res.ok);
    assert.equal(res.plan.transactions, 2);
    assert.equal(res.plan.balances, 1);
    assert.equal(res.plan.balancesDropped, 1);
    assert.equal(res.plan.rules, 1);
    assert.deepEqual(res.plan.aliases, [OLD]);
    assert.equal(res.plan.blocked, null);
    assert.equal(res.plan.warnings.length, 1); // the same-day balance
    assert.equal((await txnsOn(oldId)).length, 2);
    assert.equal((await db.select().from(accountAliases)).filter((a) => a.accountNumber === OLD).length, 0);
  });

  test("accounts of different kinds are refused, and nothing moves", async () => {
    const plan = await previewAccountMerge(oldId, f.checkingId);
    assert.ok(plan.ok && plan.plan.blocked);
    const res = await mergeAccount(oldId, f.checkingId);
    assert.equal(res.ok, false);
    assert.equal((await txnsOn(oldId)).length, 2);
    assert.equal((await txnsOn(f.checkingId)).length, 0);
    assert.ok(await accountByNumber(OLD));
    assert.equal((await mergeAccount(oldId, oldId)).ok, false);
  });

  test("the merge moves the history, keeps the old number as an alias and deletes the old account", async () => {
    const res = await mergeAccount(oldId, f.creditId);
    assert.ok(res.ok);
    assert.equal(await accountByNumber(OLD), undefined);
    assert.equal((await txnsOn(f.creditId)).length, 2);
    // The kept account's reading wins on the shared day; the older snapshot comes across.
    assert.deepEqual((await balancesOn(f.creditId)).map((b) => b.balance), ["500.00", "520.00", "530.00"]);
    const [alias] = await db.select().from(accountAliases).where(eq(accountAliases.accountNumber, OLD));
    assert.equal(alias.accountId, f.creditId);
    // An account-locked rule would have cascade-deleted with the old account.
    const rules = await db.select().from(categoryMappings).where(eq(categoryMappings.pattern, "E2E-RULE"));
    assert.equal(rules.find((r) => r.category === "Groceries")?.accountId, f.creditId);
    // Facts the kept account lacked are filled in from the one that went away.
    assert.equal((await accountByNumber("2222")).openedOn, "2020-01-15");
  });
});

describe("importing after the merge", () => {
  test("the same old statement is all duplicates and recreates nothing", async () => {
    const { preview, res } = await importAs(OLD, OLD_STATEMENT, "old-again.pdf");
    assert.deepEqual(preview.rows.map((r) => r.status), ["duplicate", "duplicate"]);
    assert.equal(res.inserted, 0);
    assert.equal(await accountByNumber(OLD), undefined);
    assert.equal((await txnsOn(f.creditId)).length, 2);
  });

  test("another statement with the old number lands on the kept account", async () => {
    const { res } = await importAs(OLD, [{ dateIso: daysAgo(70), description: "BOOKSHOP ANYTOWN", amount: 18, direction: "Debit", raw: {} }], "older.pdf");
    assert.equal(res.inserted, 1);
    assert.equal(await accountByNumber(OLD), undefined);
    assert.equal((await txnsOn(f.creditId)).length, 3);
  });

  test("a transaction typed in under the old number goes to the kept account too", async () => {
    await createTransaction(null, { txnDate: daysAgo(3), description: "Typed under the old number", amount: 9, direction: "Debit", accountNumber: OLD }, "/transactions");
    assert.equal(await accountByNumber(OLD), undefined);
    assert.equal((await txnsOn(f.creditId)).length, 4);
  });

  test("a pending row on the kept account is settled by a statement carrying the old number", async () => {
    await createTransaction(null, { txnDate: daysAgo(3), description: "Hotel hold", amount: 120, direction: "Debit", accountNumber: "2222", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "HOTEL CHAIN", amount: 120, direction: "Debit", raw: {} }], accountNumber: OLD });
    assert.equal(preview.rows[0].status, "finalizes");
  });

  test("adding the old number back by hand makes it its own account again", async () => {
    await createAccount(OLD, "[e2e] Reborn", "Credit");
    assert.ok(await accountByNumber(OLD));
    assert.equal((await db.select().from(accountAliases).where(eq(accountAliases.accountNumber, OLD))).length, 0);
  });
});

describe("changing an account's number", () => {
  const STATEMENT = [{ dateIso: daysAgo(20), description: "PHARMACY ANYTOWN", amount: 12.34, direction: "Debit" as const, raw: {} }];
  const aliasesOf = async (id: number) => (await db.select().from(accountAliases).where(eq(accountAliases.accountId, id))).map((a) => a.accountNumber).sort();

  test("the old number stays on as a former number, and its statements are still recognized", async () => {
    await importAs("1111", STATEMENT, "chk.pdf");
    const before = (await txnsOn(f.checkingId)).length;
    assert.deepEqual(await changeAccountNumber(f.checkingId, " 7777 "), { ok: true, keptOld: true });
    assert.equal((await accountByNumber("7777")).id, f.checkingId);
    assert.deepEqual(await aliasesOf(f.checkingId), ["1111"]);
    // The statement again, printed with the old number and then picked under the new one.
    for (const n of ["1111", "7777"]) {
      const { preview, res } = await importAs(n, STATEMENT, `chk-${n}.pdf`);
      assert.equal(preview.rows[0].status, "duplicate", `under ${n}`);
      assert.equal(res.inserted, 0);
    }
    assert.equal((await txnsOn(f.checkingId)).length, before);
    assert.equal(await accountByNumber("1111"), undefined);
  });

  test("a number another account uses, or used to use, is refused", async () => {
    const taken = await changeAccountNumber(f.checkingId, "2222");
    assert.ok(!taken.ok && /merge them/.test(taken.error));
    await changeAccountNumber(f.creditId, "8888"); // 2222 is now a former number of the card
    const former = await changeAccountNumber(f.checkingId, "2222");
    assert.ok(!former.ok && /former number/.test(former.error));
    assert.equal((await changeAccountNumber(f.checkingId, "")).ok, false);
    assert.equal((await changeAccountNumber(f.checkingId, "123456789")).ok, false);
    assert.equal((await accountByNumber("7777")).id, f.checkingId);
  });

  test("going back to its own former number makes that one current again", async () => {
    assert.deepEqual(await changeAccountNumber(f.checkingId, "1111"), { ok: true, keptOld: true });
    assert.deepEqual(await aliasesOf(f.checkingId), ["7777"]);
  });

  test("a debt added by name gets its real last four, and the made-up key is not kept", async () => {
    assert.ok((await createLiabilityAccount("[e2e] Store card", "Credit")).ok);
    const [made] = await db.select().from(accounts).where(eq(accounts.label, "[e2e] Store card"));
    assert.ok(!/^\d+$/.test(made.accountNumber));
    assert.deepEqual(await changeAccountNumber(made.id, "4242"), { ok: true, keptOld: false });
    assert.deepEqual(await aliasesOf(made.id), []);
  });
});

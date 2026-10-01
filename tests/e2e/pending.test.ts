import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { periods, transactions } from "@/server/db/schema";
import { createTransaction, setTransactionPending, updateTransaction } from "@/server/actions/transactions";
import { analyzeStatement, commitPdfStatements } from "@/server/actions/pdf-import";
import { commitImport } from "@/server/actions/import";
import { closePool, daysAgo, setupFixtures, teardownFixtures, TODAY, type Fixtures } from "./helpers";

// Manual pending transactions (planning/features/pending-transactions.md): entered by hand
// before the bank posts them, then settled in place by the import that carries the posted
// version — never duplicated.

let f: Fixtures;

before(async () => {
  f = await setupFixtures();
});
after(async () => {
  await teardownFixtures(f);
  await closePool();
});

const rowsOn = (accountId: number) => db.select().from(transactions).where(eq(transactions.accountId, accountId)).orderBy(transactions.id);

describe("manual pending → settled by a PDF/CSV import", () => {
  test("createTransaction(pending) stores status=pending, source=manual", async () => {
    await createTransaction(
      null,
      { txnDate: daysAgo(3), description: "Hotel hold (typed in)", amount: 120, direction: "Debit", accountNumber: "2222", category: "Travel", notes: "conference", pending: true },
      "/transactions",
    );
    const [row] = await rowsOn(f.creditId);
    assert.equal(row.pending, true);
    assert.equal(row.source, "manual");
    assert.equal(row.category, "Travel");
  });

  test("the import preview flags the posted twin as 'finalizes' (same money, within the window)", async () => {
    const res = await analyzeStatement({
      txns: [
        { dateIso: daysAgo(1), description: "HOTEL CHAIN #4421", amount: 120, direction: "Debit", raw: {} },
        { dateIso: daysAgo(1), description: "COFFEE", amount: 4, direction: "Debit", raw: {} },
        { dateIso: daysAgo(1), description: "Wrong amount", amount: 121, direction: "Debit", raw: {} },
        { dateIso: daysAgo(1), description: "Wrong direction", amount: 120, direction: "Credit", raw: {} },
      ],
      accountNumber: "2222",
    });
    const [pend] = await rowsOn(f.creditId);
    assert.equal(res.rows[0].status, "finalizes");
    assert.equal(res.rows[0].pendingMatchId, pend.id);
    assert.equal(res.rows[0].pendingMatchDescription, "Hotel hold (typed in)");
    assert.equal(res.rows[0].pendingMatchCategory, "Travel");
    assert.equal(res.rows[1].status, "new");
    assert.equal(res.rows[2].status, "new");
    assert.equal(res.rows[3].status, "new");
    assert.equal(res.finalizeCount, 1);
    // Outside the window (posted 10 days after the pending date) it is not a match.
    const late = await analyzeStatement({ txns: [{ dateIso: daysAgo(-7), description: "HOTEL", amount: 120, direction: "Debit", raw: {} }], accountNumber: "2222" });
    assert.equal(late.rows[0].status, "new");
    // Two import rows can't both settle one placeholder.
    const twice = await analyzeStatement({
      txns: [
        { dateIso: daysAgo(1), description: "HOTEL A", amount: 120, direction: "Debit", raw: {} },
        { dateIso: daysAgo(2), description: "HOTEL B", amount: 120, direction: "Debit", raw: {} },
      ],
      accountNumber: "2222",
    });
    assert.deepEqual(twice.rows.map((r) => r.status), ["finalizes", "new"]);
  });

  test("commit settles the pending row in place: bank title/amount/date, category stays, typed name moves to notes, no duplicate", async () => {
    const [pend] = await rowsOn(f.creditId);
    const preview = await analyzeStatement({
      txns: [
        { dateIso: daysAgo(1), description: "HOTEL CHAIN #4421", amount: 120, direction: "Debit", raw: {} },
        { dateIso: daysAgo(1), description: "COFFEE", amount: 4, direction: "Debit", raw: {} },
      ],
      accountNumber: "2222",
    });
    const res = await commitImport("stmt.pdf", preview.rows.map((r) => ({ ...r, accountNumber: "2222" })), [], "pdf");
    assert.equal(res.finalized, 1);
    assert.equal(res.inserted, 1);
    assert.equal(res.duplicates, 0);
    const rows = await rowsOn(f.creditId);
    assert.equal(rows.length, 2);
    const settled = rows.find((r) => r.id === pend.id)!;
    assert.equal(settled.pending, false);
    assert.equal(settled.description, "HOTEL CHAIN #4421");
    assert.equal(settled.txnDate, daysAgo(1));
    assert.equal(settled.source, "pdf");
    assert.equal(settled.category, "Travel");
    assert.equal(settled.notes, "Hotel hold (typed in)\nconference");
    assert.equal(settled.dedupHash, preview.rows[0].dedupHash);
    assert.ok(settled.importBatchId);
    // Re-importing the same statement is now a plain duplicate on the content hash.
    const again = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "HOTEL CHAIN #4421", amount: 120, direction: "Debit", raw: {} }], accountNumber: "2222" });
    assert.equal(again.rows[0].status, "duplicate");
  });

  test("the whole PDF commit path reports settled rows and dedups across statements", async () => {
    await createTransaction(null, { txnDate: daysAgo(2), description: "Gas (pending)", amount: 55, direction: "Debit", accountNumber: "1111", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "SHELL OIL", amount: 55, direction: "Debit", raw: {} }], accountNumber: "1111" });
    assert.equal(preview.rows[0].status, "finalizes");
    const res = await commitPdfStatements([
      { filename: "a.pdf", accountNumber: "1111", institution: null, accountType: null, rows: preview.rows, balances: [] },
      { filename: "b.pdf", accountNumber: "1111", institution: null, accountType: null, rows: preview.rows, balances: [] }, // same statement twice
    ]);
    assert.equal(res.finalized, 1);
    assert.equal(res.inserted, 0);
    assert.equal(res.duplicates, 1);
    const rows = await rowsOn(f.checkingId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pending, false);
    assert.equal(rows[0].description, "SHELL OIL");
  });

  test("a placeholder settled (or deleted) between preview and commit falls back to a normal insert", async () => {
    await createTransaction(null, { txnDate: daysAgo(2), description: "Lunch (pending)", amount: 18, direction: "Debit", accountNumber: "1111", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "DELI", amount: 18, direction: "Debit", raw: {} }], accountNumber: "1111" });
    assert.equal(preview.rows[0].status, "finalizes");
    await setTransactionPending(preview.rows[0].pendingMatchId!, false, "/transactions"); // user marked it posted meanwhile
    const res = await commitImport("c.csv", preview.rows.map((r) => ({ ...r, accountNumber: "1111" })));
    assert.equal(res.finalized, 0);
    assert.equal(res.inserted, 1);
  });
});

describe("ordering and month boundaries", () => {
  test("an already-imported duplicate dated inside the window does not eat the placeholder", async () => {
    // A $50 charge already in the ledger (posted, imported), then a $50 pending typed by hand.
    const first = await analyzeStatement({ txns: [{ dateIso: daysAgo(4), description: "MARKET", amount: 50, direction: "Debit", raw: {} }], accountNumber: "1111" });
    await commitImport("d1.csv", first.rows.map((r) => ({ ...r, accountNumber: "1111" })));
    await createTransaction(null, { txnDate: daysAgo(3), description: "Market (pending)", amount: 50, direction: "Debit", accountNumber: "1111", pending: true }, "/transactions");
    // The next export overlaps: the old $50 row (hash duplicate, dated inside the window) comes
    // BEFORE the real posted $50. The duplicate must not consume the placeholder.
    const preview = await analyzeStatement({
      txns: [
        { dateIso: daysAgo(4), description: "MARKET", amount: 50, direction: "Debit", raw: {} },
        { dateIso: daysAgo(1), description: "MARKET", amount: 50, direction: "Debit", raw: {} },
      ],
      accountNumber: "1111",
    });
    assert.deepEqual(preview.rows.map((r) => r.status), ["duplicate", "finalizes"]);
    const res = await commitImport("d2.csv", preview.rows.map((r) => ({ ...r, accountNumber: "1111" })));
    assert.equal(res.finalized, 1);
    assert.equal(res.duplicates, 1);
    assert.equal(res.inserted, 0);
    const fifties = (await rowsOn(f.checkingId)).filter((r) => Number(r.amount) === 50);
    assert.equal(fifties.length, 2); // the old posted row + the settled placeholder, no third
    assert.ok(fifties.every((r) => !r.pending));
  });

  test("settling into a month with no sheet yet creates the period instead of orphaning the row", async () => {
    // Far-future dates so no real period exists; cleaned up below.
    await createTransaction(null, { txnDate: "2031-01-30", description: "Boundary (pending)", amount: 9, direction: "Debit", accountNumber: "1111", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: "2031-02-02", description: "BOUNDARY CO", amount: 9, direction: "Debit", raw: {} }], accountNumber: "1111" });
    assert.equal(preview.rows[0].status, "finalizes");
    await commitImport("m.csv", preview.rows.map((r) => ({ ...r, accountNumber: "1111" })));
    const [row] = await db.select().from(transactions).where(and(eq(transactions.accountId, f.checkingId), eq(transactions.description, "BOUNDARY CO")));
    assert.equal(row.txnDate, "2031-02-02");
    assert.ok(row.periodId, "period assigned");
    const [p] = await db.select().from(periods).where(eq(periods.id, row.periodId!));
    assert.equal(`${p.year}-${p.month}`, "2031-2");
    await db.delete(transactions).where(eq(transactions.id, row.id));
    await db.delete(periods).where(and(eq(periods.year, 2031), eq(periods.month, 1)));
    await db.delete(periods).where(and(eq(periods.year, 2031), eq(periods.month, 2)));
  });
});

describe("what settling keeps", () => {
  test("a statement of only duplicates and pending settles still commits", async () => {
    await createTransaction(null, { txnDate: daysAgo(2), description: "Only settle", amount: 33, direction: "Debit", accountNumber: "2222", category: "Travel", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "ONLY SETTLE CO", amount: 33, direction: "Debit", raw: {} }], accountNumber: "2222" });
    assert.deepEqual(preview.rows.map((r) => r.status), ["finalizes"]);
    assert.equal(preview.newCount, 0);
    const res = await commitImport("only.csv", preview.rows.map((r) => ({ ...r, accountNumber: "2222" })));
    assert.equal(res.finalized, 1);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, preview.rows[0].pendingMatchId!));
    assert.equal(row.pending, false);
    assert.equal(row.category, "Travel");
  });

  test("auto-settle: a category picked in the preview wins; a rule's guess does not; notes are combined", async () => {
    await createTransaction(null, { txnDate: daysAgo(2), description: "Picked", amount: 71, direction: "Debit", accountNumber: "2222", category: "Travel", notes: "typed first", pending: true }, "/transactions");
    await createTransaction(null, { txnDate: daysAgo(2), description: "Guessed", amount: 72, direction: "Debit", accountNumber: "2222", category: "Travel", pending: true }, "/transactions");
    const preview = await analyzeStatement({
      txns: [
        { dateIso: daysAgo(1), description: "PICKED CO", amount: 71, direction: "Debit", raw: {} },
        { dateIso: daysAgo(1), description: "GUESSED CO", amount: 72, direction: "Debit", raw: {} },
      ],
      accountNumber: "2222",
    });
    assert.deepEqual(preview.rows.map((r) => r.status), ["finalizes", "finalizes"]);
    const rows = preview.rows.map((r, i) =>
      i === 0
        ? { ...r, accountNumber: "2222", category: "Food/Groceries", categoryRuleId: null, categoryPicked: true, notes: "typed later" }
        : { ...r, accountNumber: "2222", category: "Food/Groceries", categoryRuleId: 999999 },
    );
    await commitImport("pick.csv", rows);
    const [picked] = await db.select().from(transactions).where(eq(transactions.id, preview.rows[0].pendingMatchId!));
    const [guessed] = await db.select().from(transactions).where(eq(transactions.id, preview.rows[1].pendingMatchId!));
    assert.equal(picked.category, "Food/Groceries");
    assert.equal(picked.notes, "typed later\nPicked\ntyped first");
    assert.equal(guessed.category, "Travel");
    assert.equal(guessed.description, "GUESSED CO");
    assert.equal(guessed.notes, "Guessed");
  });

  test("merge (amount differs): the import's title, amount and date; category and notes from the pending entry", async () => {
    await createTransaction(null, { txnDate: daysAgo(3), description: "Dinner with Sam", amount: 50, direction: "Debit", accountNumber: "1111", category: "Travel", notes: "n", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "SQ *JG 8842", amount: 58.5, direction: "Debit", raw: {} }], accountNumber: "1111" });
    const [r] = preview.rows;
    assert.equal(r.status, "new");
    assert.ok(r.pendingMatch);
    assert.equal(r.pendingMatch!.category, "Travel");
    assert.equal(r.mergeWith, r.pendingMatch!.id);
    const res = await commitImport("tip.csv", [{ ...r, accountNumber: "1111" }]);
    assert.equal(res.merged, 1);
    const after = (await rowsOn(f.checkingId)).filter((x) => x.dedupHash === r.dedupHash);
    assert.equal(after.length, 1);
    const [m] = after;
    assert.equal(m.description, "SQ *JG 8842");
    assert.equal(m.category, "Travel");
    assert.equal(m.notes, "Dinner with Sam\nn");
    assert.equal(Number(m.amount), 58.5);
    assert.equal(m.txnDate, daysAgo(1));
    assert.equal(m.pending, false);
    const gone = await db.select().from(transactions).where(eq(transactions.id, r.pendingMatch!.id));
    assert.equal(gone.length, 0);
  });

  test("merge: a category picked in the preview beats the pending entry's", async () => {
    await createTransaction(null, { txnDate: daysAgo(3), description: "Brunch", amount: 20, direction: "Debit", accountNumber: "1111", category: "Travel", pending: true }, "/transactions");
    const preview = await analyzeStatement({ txns: [{ dateIso: daysAgo(1), description: "BRUNCH SPOT", amount: 24, direction: "Debit", raw: {} }], accountNumber: "1111" });
    const [r] = preview.rows;
    assert.equal(r.mergeWith, r.pendingMatch!.id);
    await commitImport("brunch.csv", [{ ...r, accountNumber: "1111", category: "Food/Groceries", categoryRuleId: null, categoryPicked: true }]);
    const [m] = await db.select().from(transactions).where(eq(transactions.dedupHash, r.dedupHash));
    assert.equal(m.category, "Food/Groceries");
    assert.equal(m.description, "BRUNCH SPOT");
  });
});

describe("status controls", () => {
  test("setTransactionPending flips hand-entered rows and refuses bank-synced ones", async () => {
    await createTransaction(null, { txnDate: TODAY, description: "Toggle me", amount: 1, direction: "Debit", accountNumber: "1111", pending: true }, "/transactions");
    const [row] = await db.select().from(transactions).where(and(eq(transactions.accountId, f.checkingId), eq(transactions.description, "Toggle me")));
    assert.equal(row.pending, true);
    assert.equal((await setTransactionPending(row.id, false, "/transactions")).ok, true);
    assert.equal((await db.select().from(transactions).where(eq(transactions.id, row.id)))[0].pending, false);
    // updateTransaction can set it back for a local row
    const upd = await updateTransaction(row.id, { txnDate: TODAY, description: "Toggle me", amount: 1, direction: "Debit", accountNumber: "1111", category: null, notes: "", pending: true }, "/transactions");
    assert.equal(upd.ok, true);
    assert.equal((await db.select().from(transactions).where(eq(transactions.id, row.id)))[0].pending, true);
    // a synced row (has an external id) is refused
    await db.update(transactions).set({ source: "fakebank", externalId: "x1" }).where(eq(transactions.id, row.id));
    const refused = await setTransactionPending(row.id, false, "/transactions");
    assert.equal(refused.ok, false);
    await db.delete(transactions).where(eq(transactions.id, row.id));
  });
});

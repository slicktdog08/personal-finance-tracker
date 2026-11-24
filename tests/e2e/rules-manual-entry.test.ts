import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { billInstances, bills, categoryMappings, periods, transactions } from "@/server/db/schema";
import { ensurePeriod } from "@/server/periods";
import { createTransaction, setTransactionBill, setTransactionPending } from "@/server/actions/transactions";
import { applySavedRules } from "@/server/actions/categorize";
import { closePool, setupFixtures, teardownFixtures, type Fixtures } from "./helpers";

// Saved rules run on hand-entered transactions the same as on synced/imported ones, and a
// payment linked to a month's bill marks that bill paid.

const BILL = "[e2e] Utility";
const PATTERN = "E2E-BILLPAY";
// A month well clear of anything else the suite touches.
const Y = 2033;
const M = 6;
const day = (d: number) => `${Y}-0${M}-${String(d).padStart(2, "0")}`;

let f: Fixtures;
let billId: number;
let periodId: number;

async function instance(status: string): Promise<number> {
  await db.insert(billInstances).values({ periodId, billId, name: BILL, amount: "80.00", status });
  const [r] = await db.select({ id: billInstances.id }).from(billInstances).where(eq(billInstances.periodId, periodId)).orderBy(desc(billInstances.id)).limit(1);
  return r.id;
}
const statusOf = async (id: number) => (await db.select({ s: billInstances.status }).from(billInstances).where(eq(billInstances.id, id)))[0].s;
const reset = async () => {
  await db.delete(transactions).where(eq(transactions.periodId, periodId));
  await db.delete(billInstances).where(eq(billInstances.periodId, periodId));
};

before(async () => {
  f = await setupFixtures();
  await db.delete(categoryMappings).where(eq(categoryMappings.pattern, PATTERN));
  await db.delete(bills).where(eq(bills.name, BILL));
  await db.insert(bills).values({ name: BILL });
  billId = (await db.select({ id: bills.id }).from(bills).where(eq(bills.name, BILL)))[0].id;
  await db.insert(categoryMappings).values({ matchType: "contains", pattern: PATTERN, field: "description", category: "Utilities", billId, priority: 1 });
  periodId = await ensurePeriod(Y, M);
  await reset();
});
after(async () => {
  await reset();
  await db.delete(periods).where(and(eq(periods.year, Y), eq(periods.month, M)));
  await db.delete(categoryMappings).where(eq(categoryMappings.pattern, PATTERN));
  await db.delete(bills).where(eq(bills.name, BILL));
  await teardownFixtures(f);
  await closePool();
});

describe("saved rules on hand-entered transactions", () => {
  test("categorizes, links the bill and marks it paid — and says so", async () => {
    await reset();
    const inst = await instance("Not Due Yet");
    const res = await createTransaction(null, { txnDate: day(10), description: `${PATTERN} ACME POWER`, amount: 80, direction: "Debit", accountNumber: "1111" }, "/transactions");
    const [row] = await db.select().from(transactions).where(eq(transactions.id, res.transactionId!));
    assert.equal(row.category, "Utilities");
    assert.equal(row.billId, billId);
    assert.equal(row.billInstanceId, inst);
    assert.equal(await statusOf(inst), "Paid/Purchased");
    assert.deepEqual(res.rules, { category: "Utilities", billName: BILL, billPaid: true });
  });

  test("a category picked by hand is kept; the bill is still linked", async () => {
    await reset();
    const inst = await instance("Unpaid");
    const res = await createTransaction(null, { txnDate: day(11), description: `${PATTERN} hand`, amount: 80, direction: "Debit", accountNumber: "1111", category: "Housing" }, "/transactions");
    const [row] = await db.select().from(transactions).where(eq(transactions.id, res.transactionId!));
    assert.equal(row.category, "Housing");
    assert.equal(row.billId, billId);
    assert.equal(await statusOf(inst), "Paid/Purchased");
    assert.equal(res.rules?.category, null);
  });

  test("a pending row is categorized now, linked (and paid) once it posts", async () => {
    await reset();
    const inst = await instance("Not Due Yet");
    const res = await createTransaction(null, { txnDate: day(12), description: `${PATTERN} hold`, amount: 80, direction: "Debit", accountNumber: "1111", pending: true }, "/transactions");
    let [row] = await db.select().from(transactions).where(eq(transactions.id, res.transactionId!));
    assert.equal(row.category, "Utilities");
    assert.equal(row.billId, null);
    assert.equal(await statusOf(inst), "Not Due Yet");
    await setTransactionPending(row.id, false, "/transactions");
    [row] = await db.select().from(transactions).where(eq(transactions.id, row.id));
    assert.equal(row.billId, billId);
    assert.equal(await statusOf(inst), "Paid/Purchased");
  });

  test("statuses the user chose (Skipped) are left alone; a refund doesn't pay a bill", async () => {
    await reset();
    const skipped = await instance("Skipped");
    await createTransaction(null, { txnDate: day(13), description: `${PATTERN} a`, amount: 80, direction: "Debit", accountNumber: "1111" }, "/transactions");
    assert.equal(await statusOf(skipped), "Skipped");

    await reset();
    const open = await instance("Unpaid");
    await createTransaction(null, { txnDate: day(14), description: `${PATTERN} refund`, amount: 5, direction: "Credit", accountNumber: "1111" }, "/transactions");
    assert.equal(await statusOf(open), "Unpaid");
  });
});

describe("auto-paid from other link paths", () => {
  test("linking by hand marks the month's bill paid", async () => {
    await reset();
    const inst = await instance("Ready for Payment");
    const res = await createTransaction(null, { txnDate: day(15), description: "ACME POWER (no rule)", amount: 80, direction: "Debit", accountNumber: "1111" }, "/transactions");
    assert.equal(res.rules, undefined);
    assert.equal(await statusOf(inst), "Ready for Payment");
    await setTransactionBill(res.transactionId!, billId, "/transactions");
    assert.equal(await statusOf(inst), "Paid/Purchased");
  });

  test("'Apply saved rules' sweeps bills that already had a payment linked", async () => {
    await reset();
    const inst = await instance("Past Due");
    const res = await createTransaction(null, { txnDate: day(16), description: "older link", amount: 80, direction: "Debit", accountNumber: "1111" }, "/transactions");
    // A link made before auto-paid existed: written straight to the row.
    await db.update(transactions).set({ billId, billInstanceId: inst }).where(inArray(transactions.id, [res.transactionId!]));
    assert.equal(await statusOf(inst), "Past Due");
    const out = await applySavedRules();
    assert.ok((out.billsPaid ?? 0) >= 1);
    assert.equal(await statusOf(inst), "Paid/Purchased");
  });
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { transactions, uiLayouts } from "@/server/db/schema";
import { getLatestTransactionId, getNavCounts, getNewTransactionCount } from "@/server/queries";
import { markTransactionsSeen } from "@/server/actions/transactions-seen";
import { TXN_SEEN_KEY } from "@/lib/transactions-seen";
import { closePool, FAKE, setupFixtures, teardownFixtures, TODAY, type Fixtures } from "./helpers";

// The nav's "new transactions" badge: rows that arrived (import / PDF / sync) since the user last
// opened Transactions, tracked as a transaction-id watermark in ui_layouts.

let f: Fixtures;
let savedWatermark: unknown;

const watermark = async () => {
  const [row] = await db.select({ layout: uiLayouts.layout }).from(uiLayouts).where(eq(uiLayouts.layoutKey, TXN_SEEN_KEY));
  return row ? Number((row.layout as { lastSeenId: number }).lastSeenId) : null;
};

let n = 0;
async function addTxn(source: string): Promise<number> {
  n++;
  await db.insert(transactions).values({
    accountId: f.checkingId,
    txnDate: TODAY,
    description: `E2E SEEN ${source} ${n}`,
    amount: "10.00",
    direction: "debit",
    dedupHash: `e2e-seen-${Date.now()}-${n}`.padEnd(64, "0").slice(0, 64),
    source,
  });
  return getLatestTransactionId();
}

before(async () => {
  f = await setupFixtures();
  const [row] = await db.select({ layout: uiLayouts.layout }).from(uiLayouts).where(eq(uiLayouts.layoutKey, TXN_SEEN_KEY));
  savedWatermark = row?.layout;
  await db.delete(uiLayouts).where(eq(uiLayouts.layoutKey, TXN_SEEN_KEY));
});
after(async () => {
  await db.delete(uiLayouts).where(eq(uiLayouts.layoutKey, TXN_SEEN_KEY));
  if (savedWatermark !== undefined) await db.insert(uiLayouts).values({ layoutKey: TXN_SEEN_KEY, layout: savedWatermark });
  await teardownFixtures(f);
  await closePool();
});

test("first count seeds the watermark at the newest row instead of calling everything new", async () => {
  assert.equal(await watermark(), null);
  assert.equal(await getNewTransactionCount(), 0);
  assert.equal(await watermark(), await getLatestTransactionId());
});

test("imported and synced rows count as new; rows typed in by hand don't", async () => {
  const first = await addTxn("import");
  await addTxn(FAKE);
  await addTxn("manual");
  assert.equal(await getNewTransactionCount(), 2);
  assert.equal((await getNavCounts()).newTransactions, 2);

  // Seeing up to the first one leaves only the synced row.
  assert.deepEqual(await markTransactionsSeen(first), { ok: true });
  assert.equal(await watermark(), first);
  assert.equal(await getNewTransactionCount(), 1);
});

test("the watermark never moves backwards and never past a real row", async () => {
  const before = (await watermark())!;
  await markTransactionsSeen(before - 1);
  assert.equal(await watermark(), before, "an older tab must not rewind it");

  await markTransactionsSeen(Number.MAX_SAFE_INTEGER);
  assert.equal(await watermark(), await getLatestTransactionId(), "clamped to the newest id");
  assert.equal(await getNewTransactionCount(), 0);

  assert.deepEqual(await markTransactionsSeen("nope"), { ok: false });
  assert.deepEqual(await markTransactionsSeen(-3), { ok: false });
});

test("a row that lands after the page rendered stays new", async () => {
  const rendered = await getLatestTransactionId();
  await addTxn(FAKE); // sync arrives while Transactions is open
  await markTransactionsSeen(rendered);
  assert.equal(await getNewTransactionCount(), 1);
  const [c] = await db.select({ c: sql<number>`COUNT(*)` }).from(transactions).where(eq(transactions.source, FAKE));
  assert.ok(Number(c.c) >= 1);
});

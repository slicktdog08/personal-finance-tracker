import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accountBalances, accounts } from "@/server/db/schema";
import { moveAccountBalances } from "@/server/actions/accounts";
import { closePool, daysAgo, setupFixtures, teardownFixtures, type Fixtures } from "./helpers";

// Moving hand-picked balance snapshots between two accounts: only the chosen rows move, every
// field on them comes along, and a date the destination already has is skipped or replaced.

let f: Fixtures;
let otherId: number;
const ids: Record<string, number> = {};

const balancesOn = (id: number) => db.select().from(accountBalances).where(eq(accountBalances.accountId, id)).orderBy(accountBalances.asOf);

before(async () => {
  f = await setupFixtures();
  await db.insert(accounts).values({ accountNumber: "4444", label: "[e2e] Other card", institution: "Fake Bank", accountType: "Credit" });
  otherId = (await db.select().from(accounts).where(eq(accounts.accountNumber, "4444")))[0].id;
  await db.insert(accountBalances).values([
    { accountId: otherId, balance: "900.00", creditLimit: "2000.00", apr: "24.99", minPayment: "35.00", asOf: daysAgo(60), note: "a" },
    { accountId: otherId, balance: "800.00", creditLimit: "2000.00", apr: "24.99", minPayment: "30.00", asOf: daysAgo(30), note: "b" },
    { accountId: otherId, balance: "700.00", asOf: daysAgo(10), note: "c" },
    { accountId: f.creditId, balance: "50.00", asOf: daysAgo(10), note: "kept" },
  ]);
  for (const r of await db.select().from(accountBalances)) if (r.note) ids[r.note] = r.id;
});
after(async () => {
  await db.delete(accountBalances).where(eq(accountBalances.accountId, otherId));
  await db.delete(accounts).where(eq(accounts.id, otherId));
  await teardownFixtures(f);
  await closePool();
});

describe("moving balance snapshots between accounts", () => {
  test("rows that aren't on the source account are refused, and nothing moves", async () => {
    const res = await moveAccountBalances([ids.a, ids.kept], otherId, f.creditId);
    assert.equal(res.ok, false);
    assert.equal((await balancesOn(otherId)).length, 3);
    assert.equal((await moveAccountBalances([ids.a], otherId, otherId)).ok, false);
    assert.equal((await moveAccountBalances([], otherId, f.creditId)).ok, false);
  });

  test("only the picked snapshots move, with their limit, APR and minimum payment", async () => {
    const res = await moveAccountBalances([ids.a], otherId, f.creditId);
    assert.ok(res.ok);
    assert.deepEqual(res.moved, [ids.a]);
    const [moved] = (await balancesOn(f.creditId)).filter((b) => b.id === ids.a);
    assert.equal(moved.balance, "900.00");
    assert.equal(moved.creditLimit, "2000.00");
    assert.equal(moved.apr, "24.99");
    assert.equal(moved.minPayment, "35.00");
    assert.equal((await balancesOn(otherId)).length, 2);
  });

  test("moving them back is an undo", async () => {
    const res = await moveAccountBalances([ids.a], f.creditId, otherId);
    assert.ok(res.ok);
    assert.equal((await balancesOn(otherId)).length, 3);
  });

  test("a date the destination already has is left behind when skipping", async () => {
    const res = await moveAccountBalances([ids.b, ids.c], otherId, f.creditId, "skip");
    assert.ok(res.ok);
    assert.deepEqual(res.moved, [ids.b]);
    assert.equal(res.skipped, 1);
    assert.deepEqual((await balancesOn(otherId)).map((b) => b.note), ["a", "c"]);
    assert.deepEqual((await balancesOn(f.creditId)).map((b) => b.note), ["b", "kept"]);
  });

  test("replacing deletes the destination's snapshot on that date", async () => {
    const res = await moveAccountBalances([ids.c], otherId, f.creditId, "replace");
    assert.ok(res.ok);
    assert.equal(res.replaced, 1);
    assert.deepEqual((await balancesOn(f.creditId)).map((b) => b.note), ["b", "c"]);
    assert.deepEqual((await balancesOn(otherId)).map((b) => b.note), ["a"]);
  });
});

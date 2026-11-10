import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, decodeDemoToken, demoBalances, demoFeed, demoIsPending, eachDay, encodeDemoToken, DEMO_ACCOUNTS } from "@/server/lib/demo/bank";
import { demoProvider } from "@/server/lib/demo/provider";
import { simulateDemo } from "@/server/lib/demo/seed";

// The demo data is generated, so what is worth pinning down is that it stays coherent: the
// same day always produces the same ledger, balances never go somewhere absurd, and the mock
// bank hands the sync engine exactly the rows the seed has not already written.

const TODAY = "2026-11-10";

test("the feed is deterministic and its external ids are unique", () => {
  const ids = new Set<string>();
  for (const day of eachDay("2026-01-01", "2026-12-31")) {
    for (const kind of ["checking", "card"] as const) {
      const a = demoFeed(kind, day);
      assert.deepEqual(a, demoFeed(kind, day));
      for (const item of a) {
        assert.ok(!ids.has(item.externalId), `duplicate ${item.externalId}`);
        ids.add(item.externalId);
        assert.ok(item.amount > 0);
        assert.ok(item.externalId.length <= 64);
      }
    }
    // The daily coffee: a sync always has at least one new row for a new day.
    assert.ok(demoFeed("checking", day).some((i) => i.hour === 0));
  }
});

test("the simulation is deterministic for a given day", () => {
  assert.deepEqual(simulateDemo(TODAY), simulateDemo(TODAY));
});

for (const today of [TODAY, "2026-03-01", "2027-01-31", "2028-02-29", "2026-12-15"]) {
  test(`simulated ledger is coherent for ${today}`, () => {
    const sim = simulateDemo(today);
    assert.equal(sim.months.length, 7);
    assert.equal(sim.months[6].label, today.slice(0, 7));

    // Nothing is dated in the future or before the first month.
    for (const t of sim.txns) {
      assert.ok(t.date >= sim.months[0].start && t.date <= today, `${t.description} dated ${t.date}`);
      assert.ok(t.amount > 0);
    }

    // Checking never overdraws at any point in the history.
    let checking = sim.snapshots.find((s) => s.acct === "checking")!.balance;
    for (const t of sim.txns.filter((x) => x.acct === "checking").sort((a, b) => a.date.localeCompare(b.date))) {
      checking += t.direction === "Credit" ? t.amount : -t.amount;
      assert.ok(checking > 0, `checking went to ${checking.toFixed(2)} on ${t.date}`);
    }
    assert.ok(Math.abs(checking - sim.final.checking) < 0.01, "snapshots and transactions agree on the checking balance");

    // Debts stay debts: owed, and under the card limits.
    assert.ok(sim.final.cardA > 0 && sim.final.cardA < 6000);
    assert.ok(sim.final.cardB > 0 && sim.final.cardB < 3500);
    assert.ok(sim.final.loan > 0);
    assert.ok(sim.final.savings > 3000);

    // Every account has a snapshot for every month end plus opening and today.
    for (const acct of ["checking", "savings", "wallet", "cardA", "cardB", "loan", "retirement"]) {
      const snaps = sim.snapshots.filter((s) => s.acct === acct);
      assert.ok(snaps.length >= 8, `${acct} has ${snaps.length} snapshots`);
      assert.equal(snaps[snaps.length - 1].asOf, today);
    }

    // Past months: every bill was paid. This month: at most one is late, and it has no payment.
    for (const mo of sim.months.slice(0, 6)) {
      for (const [bill, byMonth] of sim.paidBy) assert.ok(byMonth.has(mo.label), `${bill} unpaid in ${mo.label}`);
    }
    if (sim.pastDueBill) assert.ok(!sim.paidBy.get(sim.pastDueBill)?.has(today.slice(0, 7)));

    // Bank-synced rows: only the last three days, none for today, holds only from yesterday.
    const synced = sim.txns.filter((t) => t.source === "demo");
    assert.ok(synced.length >= 3);
    for (const t of synced) {
      assert.ok(t.date >= sim.feedStart && t.date < today);
      assert.equal(!!t.pending, t.date === addDays(today, -1));
      assert.ok(t.externalId);
    }
    assert.ok(sim.txns.some((t) => t.category == null), "something is left to categorize");
    assert.ok(sim.txns.some((t) => t.pending));
  });
}

test("the provider serves the rows the seed left out, and balances that agree with it", async () => {
  const sim = simulateDemo(TODAY);
  const token = encodeDemoToken({ seedDay: TODAY, ledger: sim.bankLedger });
  assert.deepEqual(decodeDemoToken(token), { seedDay: TODAY, ledger: sim.bankLedger });
  assert.equal(decodeDemoToken("https://user:pass@bridge.example/simplefin"), null);

  const accounts = await demoProvider.listAccounts(token);
  assert.deepEqual(accounts.map((a) => a.lastFour), ["1111", "3333"]);
  await assert.rejects(() => demoProvider.listAccounts("not-a-demo-token"));

  // A window in the past is fully posted and matches the feed exactly.
  const range = { startDate: "2026-03-01", endDate: "2026-03-10" };
  const rows = await demoProvider.listTransactions(token, { externalId: DEMO_ACCOUNTS.checking.externalId, type: "depository" }, range);
  const expected = eachDay(range.startDate, range.endDate).flatMap((d) => demoFeed("checking", d));
  assert.deepEqual(rows.map((r) => r.externalId), expected.map((e) => e.externalId));
  assert.ok(rows.every((r) => r.status === "posted" && r.direction === "Debit"));

  // Nothing from the future, whatever range is asked for.
  const future = await demoProvider.listTransactions(token, { externalId: DEMO_ACCOUNTS.card.externalId, type: "credit" }, { startDate: "2999-01-01", endDate: "2999-01-31" });
  assert.equal(future.length, 0);

  // On the seed day the bank's ledger is the seeded one; holds are yesterday's and today's rows.
  assert.equal(demoIsPending(addDays(TODAY, -1), TODAY), true);
  assert.equal(demoIsPending(addDays(TODAY, -2), TODAY), false);
  const state = { seedDay: TODAY, ledger: sim.bankLedger };
  const seedDay = demoBalances(state, "checking", TODAY, 23);
  assert.equal(seedDay.ledger, sim.bankLedger.checking);
  const held = [...demoFeed("checking", addDays(TODAY, -1)), ...demoFeed("checking", TODAY)].reduce((s, i) => s + i.amount, 0);
  assert.ok(Math.abs(seedDay.pending - held) < 0.01);
  // Two days on, yesterday's and the seed day's rows have posted to the ledger.
  const later = demoBalances(state, "checking", addDays(TODAY, 2), 23);
  const posted = [...demoFeed("checking", addDays(TODAY, -1)), ...demoFeed("checking", TODAY)].reduce((s, i) => s + i.amount, 0);
  assert.ok(Math.abs(later.ledger - (sim.bankLedger.checking - posted)) < 0.01);
});

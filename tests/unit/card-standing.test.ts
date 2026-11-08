import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cardRebalance, cardStanding, type CardRebalanceInput } from "@/server/lib/card-rebalance";

// Runs a card through the dashboard's own rule first, then the standing — exactly what the budget
// page does, so these also pin that the two can't drift.
const standing = (card: Partial<CardRebalanceInput>, plan = { planned: 0, apr: null as number | null, paid: 0 }) => {
  const { rows } = cardRebalance([
    { accountId: 5, label: "Example Card", start: 1000, startAsOf: "2026-09-30", balance: 1000, nowAsOf: "2026-10-17", pending: 0, plan, ...card },
  ]);
  return cardStanding(rows[0]);
};

describe("cardStanding", () => {
  test("October card, had the balance moved with the transactions: $150.72 behind, pending included", () => {
    // Start $3,868.01; charges $1,230.72 ($239.64 still pending) vs payments $1,080 → posted
    // balance 3,868.01 + 991.08 − 1,080 = 3,779.09, plus the pending = 4,018.73.
    const s = standing({ start: 3868.01, balance: 3779.09, pending: 239.64 }, { planned: 2558.07, apr: 29.99, paid: 0 });
    assert.equal(s.toCover, 150.72);
    assert.equal(s.pending, 239.64);
    // Plan: 3,868.01 + 96.67 interest − 2,558.07 = 1,406.61 by month end.
    assert.equal(s.expected, 1406.61);
    assert.equal(s.toPlan, 2461.4);
    assert.equal(s.total, 2612.12);
  });

  test("October card as actually synced (balance dropped $342 on Oct 17): not behind start", () => {
    const s = standing({ start: 3868.01, balance: 3471.55, pending: 239.64 }, { planned: 2558.07, apr: 29.99, paid: 0 });
    assert.equal(s.toCover, 0);
    assert.equal(s.toPlan, 2304.58);
  });

  test("charges > payments: the growth is owed", () => {
    assert.equal(standing({ balance: 1250 }).toCover, 250);
  });

  test("charges < payments: nothing to cover", () => {
    const s = standing({ balance: 800 });
    assert.equal(s.toCover, 0);
    assert.equal(s.total, 0);
  });

  test("charges exactly equal payments: break-even, nothing owed", () => {
    assert.equal(standing({ balance: 1000 }).toCover, 0);
  });

  test("pending-only charges count — the dashboard includes pending", () => {
    const s = standing({ balance: 1000, pending: 75.5 });
    assert.equal(s.toCover, 75.5);
    assert.equal(s.pending, 75.5);
  });

  test("no payments this month: every charge is owed, plus the whole plan", () => {
    const s = standing({ balance: 1300 }, { planned: 200, apr: null, paid: 0 });
    assert.equal(s.toCover, 300);
    assert.equal(s.toPlan, 200);
    assert.equal(s.total, 500);
  });

  test("balance above month start but on plan (no paydown planned): only the cover is owed", () => {
    const s = standing({ balance: 1100 }, { planned: 0, apr: 20, paid: 0 });
    assert.equal(s.toCover, 100);
    assert.equal(s.toPlan, 0);
    assert.equal(s.expected, null);
  });

  test("below month start but behind plan: nothing to cover, plan shortfall remains", () => {
    const s = standing({ balance: 900 }, { planned: 500, apr: null, paid: 0 });
    assert.equal(s.toCover, 0);
    assert.equal(s.toPlan, 400);
  });

  test("at or past the plan's balance: nothing owed at all", () => {
    const s = standing({ balance: 450 }, { planned: 500, apr: null, paid: 0 });
    assert.equal(s.total, 0);
  });

  test("payoff paid: measured against the plan's balance, so later charges show as cover", () => {
    // Paid the $500 plan; card at 500, then $120 of new charges → 620 vs. the plan's 500.
    const s = standing({ balance: 620 }, { planned: 500, apr: null, paid: 500 });
    assert.equal(s.expected, 500);
    assert.equal(s.toCover, 120);
    assert.equal(s.toPlan, 0);
    assert.equal(s.total, 120);
  });
});

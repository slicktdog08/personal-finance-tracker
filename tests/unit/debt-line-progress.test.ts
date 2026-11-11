import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { debtLineProgress } from "@/server/lib/debt";

describe("debtLineProgress", () => {
  test("a minimum-only card paid in full is done even with a new charge on it", () => {
    const p = debtLineProgress({ planned: 100, minimum: 100, paid: 100, charged: 12.5, billPaid: false });
    assert.equal(p.actual, 100);
    assert.equal(p.due, 100);
    assert.equal(p.minimumMet, true);
    assert.equal(p.rebalance, 0);
  });

  test("a bill marked paid at less than the plan meets the minimum at what was paid", () => {
    const p = debtLineProgress({ planned: 150, minimum: 150, paid: 140, charged: 0, billPaid: true });
    assert.equal(p.actual, 140);
    assert.equal(p.due, 140);
    assert.equal(p.minimumMet, true);
  });

  test("short of the minimum with the bill not settled stays short", () => {
    const p = debtLineProgress({ planned: 150, minimum: 150, paid: 140, charged: 0, billPaid: false });
    assert.equal(p.due, 150);
    assert.equal(p.minimumMet, false);
  });

  test("new charges eat into the extra, not the minimum", () => {
    // $1,000 planned = $50 minimum + $950 extra; paid $1,000 with $300 charged → $650 extra payoff.
    const p = debtLineProgress({ planned: 1000, minimum: 50, paid: 1000, charged: 300, billPaid: true });
    assert.equal(p.actual, 700);
    assert.equal(p.rebalance, 300);
    assert.equal(p.due, 1000);
  });

  test("paying back exactly the new charges on top of the minimum is still no extra", () => {
    const p = debtLineProgress({ planned: 1000, minimum: 50, paid: 350, charged: 300, billPaid: true });
    assert.equal(p.actual, 50);
    assert.equal(p.rebalance, 300);
  });

  test("nothing paid is never met, even if the bill is marked settled", () => {
    const p = debtLineProgress({ planned: 80, minimum: 80, paid: 0, charged: 0, billPaid: true });
    assert.equal(p.minimumMet, false);
    assert.equal(p.due, 80);
  });

  test("no minimum known treats the whole plan as the minimum", () => {
    const p = debtLineProgress({ planned: 200, minimum: null, paid: 200, charged: 40, billPaid: false });
    assert.equal(p.actual, 200);
  });
});

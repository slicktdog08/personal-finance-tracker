import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { repaymentRebalance } from "@/server/lib/debt";

describe("repaymentRebalance", () => {
  test("a linked payment that only covers the card's new charges is all rebalance", () => {
    assert.equal(repaymentRebalance([{ paid: 300, charged: 300 }], 0), 300);
  });

  test("paying more than was charged: only the charges come off; the rest is paydown", () => {
    assert.equal(repaymentRebalance([{ paid: 2000, charged: 450 }], 0), 450);
  });

  test("charges with no payment yet take nothing off", () => {
    assert.equal(repaymentRebalance([{ paid: 0, charged: 500 }], 0), 0);
  });

  test("unlinked Debt Repayment covers whatever charges the linked payments left", () => {
    // Card A: 200 charged, 50 paid (linked) → 150 uncovered. Card B: 100 charged, nothing linked.
    // 400 unlinked covers the 250 still open; the other 150 is paydown.
    assert.equal(repaymentRebalance([{ paid: 50, charged: 200 }, { paid: 0, charged: 100 }], 400), 300);
  });

  test("refunds (negative charges) and cents", () => {
    assert.equal(repaymentRebalance([{ paid: 100, charged: -20 }, { paid: 0.1, charged: 0.2 }], 0.15), 0.2);
  });
});

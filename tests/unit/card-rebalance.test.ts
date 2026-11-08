import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cardRebalance, cardRebalanceFrom, type CardRebalanceInput } from "@/server/lib/card-rebalance";

const card = (over: Partial<CardRebalanceInput>): CardRebalanceInput => ({
  accountId: 1,
  label: "Visa",
  start: 1000,
  startAsOf: "2026-09-30",
  balance: 1000,
  nowAsOf: "2026-10-10",
  pending: 0,
  ...over,
});

describe("cardRebalance", () => {
  test("the growth over the starting balance is owed", () => {
    const r = cardRebalance([card({ balance: 1250 })]);
    assert.equal(r.owe, 250);
    assert.equal(r.rows[0].change, 250);
  });

  test("at or under the starting balance owes nothing", () => {
    const r = cardRebalance([card({ balance: 1000 }), card({ accountId: 2, balance: 700 })]);
    assert.equal(r.owe, 0);
    assert.deepEqual(r.rows.map((x) => x.owe), [0, 0]);
    assert.equal(r.rows.find((x) => x.accountId === 2)!.change, -300);
  });

  test("cards without both balances are listed as missing; rows sort by what's owed", () => {
    const r = cardRebalance([
      card({ accountId: 1, label: "A", balance: 1010 }),
      card({ accountId: 2, label: "B", start: null }),
      card({ accountId: 3, label: "C", balance: 1500 }),
    ]);
    assert.deepEqual(r.rows.map((x) => x.label), ["C", "A"]);
    assert.deepEqual(r.missing, ["B"]);
    assert.equal(r.owe, 510);
  });

  test("pending charges count toward today; pending credits come off", () => {
    // Posted balance hasn't moved, but $180 is pending — the card is really $180 over.
    const r = cardRebalance([card({ balance: 1000, pending: 180 })]);
    assert.equal(r.rows[0].now, 1180);
    assert.equal(r.owe, 180);
    // A pending payment nets against pending charges.
    const r2 = cardRebalance([card({ balance: 1100, pending: -50 })]);
    assert.equal(r2.rows[0].now, 1050);
    assert.equal(r2.owe, 50);
  });

  test("cents don't drift", () => {
    const r = cardRebalance([card({ start: 0.1, balance: 0.3 }), card({ accountId: 2, start: 0.2, balance: 0.3 })]);
    assert.equal(r.owe, 0.3);
  });

  test("cardRebalanceFrom nets pending per card and skips loans and inactive cards", () => {
    const acct = (id: number, over: object = {}) => ({
      id,
      label: `Card ${id}`,
      institution: null,
      accountNumber: "0000" + id,
      accountType: "Credit",
      active: true,
      balance: "1000.00",
      asOf: "2026-10-10",
      ...over,
    });
    const start = new Map([
      [1, { balance: 900, asOf: "2026-09-30" }],
      [2, { balance: 1000, asOf: "2026-09-30" }],
      [3, { balance: 500, asOf: "2026-09-30" }],
      [4, { balance: 500, asOf: "2026-09-30" }],
    ]);
    const r = cardRebalanceFrom(
      [acct(1), acct(2), acct(3, { accountType: "Loan" }), acct(4, { active: false })],
      start,
      [
        { accountId: 1, amount: "40.10", direction: "Debit" },
        { accountId: 1, amount: "10.00", direction: "Credit" },
        { accountId: 2, amount: "25.00", direction: "Debit" },
        { accountId: 99, amount: "500.00", direction: "Debit" }, // checking, not a card
        { accountId: null, amount: "5.00", direction: "Debit" },
      ],
    );
    assert.deepEqual(r.rows.map((x) => [x.accountId, x.pending, x.now, x.owe]), [
      [1, 30.1, 1030.1, 130.1],
      [2, 25, 1025, 25],
    ]);
    assert.equal(r.owe, 155.1);
  });

  describe("with the month's payoff plan", () => {
    const plan = { planned: 2000, apr: null, paid: 0 };

    test("payoff not made yet: growth over the starting balance, the payoff left out", () => {
      const r = cardRebalance([card({ balance: 1250, plan })]);
      assert.equal(r.rows[0].planPaid, false);
      assert.equal(r.rows[0].target, 1000);
      assert.equal(r.owe, 250);
    });

    test("rebalance payments short of the plan don't count as the payoff", () => {
      // Charged 300, paid 300 back: still at start, nothing owed — the payoff is still to come.
      const r = cardRebalance([card({ start: 3000, balance: 3000, plan: { ...plan, paid: 300 } })]);
      assert.equal(r.rows[0].planPaid, false);
      assert.equal(r.owe, 0);
    });

    test("payoff made: charges after it are owed instead of hidden under it", () => {
      // Start 3000, paid the 2000 payoff, then charged 400 → 1400 vs. the plan's 1000.
      const r = cardRebalance([card({ start: 3000, balance: 1400, plan: { ...plan, paid: 2000 } })]);
      assert.equal(r.rows[0].planPaid, true);
      assert.equal(r.rows[0].target, 1000);
      assert.equal(r.rows[0].change, -1600);
      assert.equal(r.owe, 400);
    });

    test("payoff made: the plan's balance includes a month's interest", () => {
      // 3000 × 24% / 12 = 60 → target 3000 + 60 − 2000 = 1060.
      const r = cardRebalance([card({ start: 3000, balance: 1100, plan: { planned: 2000, apr: 24, paid: 2000 } })]);
      assert.equal(r.rows[0].target, 1060);
      assert.equal(r.owe, 40);
    });

    test("payoff made and nothing charged since: not over", () => {
      const r = cardRebalance([card({ start: 3000, balance: 950, plan: { ...plan, paid: 2050 } })]);
      assert.equal(r.owe, 0);
    });
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { budgetOutcome } from "@/server/lib/budget-outcome";

const base = {
  periodLabel: "2024-04",
  plannedIncome: 4000,
  actualIncome: 4000,
  unplanned: { total: 0, categories: [] },
  interest: 0,
  rewards: 0,
  cash: { start: 1000, end: 1500 },
  debt: { start: 5000, end: 4600 },
};

describe("budgetOutcome", () => {
  test("sweeps unspent envelopes and subtracts overspending", () => {
    const o = budgetOutcome({
      ...base,
      lines: [
        { kind: "category", label: "Groceries", planned: 500, actual: 420 },
        { kind: "category", label: "Dining", planned: 200, actual: 260 },
        { kind: "debt", label: "Card A", planned: 400, actual: 400, due: 400, paid: 400 },
        { kind: "savings", label: "Savings", planned: 500, actual: 0 },
      ],
    });
    assert.equal(o.plannedTotal, 1600);
    assert.equal(o.unallocated, 2400);
    assert.equal(o.everyday.swept, 80);
    assert.equal(o.everyday.overspent, 60);
    assert.equal(o.leftover, 2420);
    assert.equal(o.outcome, 2420);
    // The worst envelope comes first.
    assert.equal(o.everyday.lines[0].label, "Dining");
  });

  test("interest comes off the outcome, rewards go back on", () => {
    const o = budgetOutcome({
      ...base,
      plannedIncome: 1000,
      actualIncome: 900,
      interest: 75.5,
      rewards: 10,
      lines: [{ kind: "category", label: "Gas", planned: 1000, actual: 1000 }],
      unplanned: { total: 40, categories: [{ category: "Gifts", amount: 40 }] },
    });
    assert.equal(o.income.variance, -100);
    assert.equal(o.leftover, -140);
    assert.equal(o.outcome, -205.5);
  });

  test("paying extra on a debt uses the leftover; paying less frees it", () => {
    const o = budgetOutcome({
      ...base,
      plannedIncome: 1000,
      actualIncome: 1000,
      lines: [
        { kind: "debt", label: "Card A", planned: 300, actual: 450, due: 300, paid: 500 },
        { kind: "debt", label: "Loan B", planned: 200, actual: 150, due: 200, paid: 150 },
      ],
    });
    assert.equal(o.debt.variance, -100);
    assert.equal(o.debt.paidTotal, 650);
    assert.equal(o.leftover, 400);
  });

  test("by the balances: cash up and debt down both count", () => {
    const o = budgetOutcome({ ...base, lines: [] });
    assert.equal(o.savings.cashChange, 500);
    assert.equal(o.debt.change, -400);
    assert.equal(o.netChange, 900);
  });
});

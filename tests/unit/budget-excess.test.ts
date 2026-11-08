import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { budgetExcess } from "@/server/lib/budget";

const base = { savingsPlanned: 0, plannedIncome: 5000, plannedTotal: 5000, actualIncome: 5000 };

describe("budgetExcess", () => {
  test("September 2026: cash grew past planned savings — $420.32 unbudgeted, $194.14 of it income above plan", () => {
    const r = budgetExcess({ cashStart: 4885.35, cashEnd: 6935.67, savingsPlanned: 1630, plannedIncome: 7836.46, plannedTotal: 7836.46, actualIncome: 8030.6 });
    assert.equal(r.excess, 420.32);
    assert.equal(r.incomeAbovePlan, 194.14);
    assert.equal(r.unallocated, 0);
  });

  test("October 2026: projected short of the plan", () => {
    const r = budgetExcess({ cashStart: 6946.46, cashEnd: 6850.53, savingsPlanned: 250, plannedIncome: 7836.46, plannedTotal: 7836.46, actualIncome: 4153.24 });
    assert.equal(r.excess, -345.93);
    assert.equal(r.incomeAbovePlan, 0);
  });

  test("exactly on plan: cash grows by the savings and nothing else", () => {
    assert.equal(budgetExcess({ ...base, cashStart: 1000, cashEnd: 1300, savingsPlanned: 300 }).excess, 0);
  });

  test("income left unassigned in the plan is reported", () => {
    const r = budgetExcess({ ...base, plannedTotal: 4600, cashStart: 1000, cashEnd: 1400 });
    assert.equal(r.unallocated, 400);
    assert.equal(r.excess, 400);
  });

  test("over-planned income never reads as negative unallocated", () => {
    assert.equal(budgetExcess({ ...base, plannedTotal: 5200, cashStart: 0, cashEnd: 0 }).unallocated, 0);
  });

  test("no cash balance recorded: excess unknown, sources still reported", () => {
    const r = budgetExcess({ ...base, actualIncome: 5300, cashStart: null, cashEnd: 900 });
    assert.equal(r.excess, null);
    assert.equal(r.incomeAbovePlan, 300);
  });

  test("no planned income: sources are zero", () => {
    const r = budgetExcess({ ...base, plannedIncome: null, cashStart: 100, cashEnd: 200 });
    assert.deepEqual(r, { excess: 100, unallocated: 0, incomeAbovePlan: 0 });
  });
});

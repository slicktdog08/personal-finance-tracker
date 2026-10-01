import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEPOSIT_MATCH,
  isPayrollDescription,
  reconcilePaydays,
  type ObservedDeposit,
} from "@/server/lib/payday-reconcile";

const dep = (date: string, amount: number, description = "PAYROLL"): ObservedDeposit => ({ date, amount, description });

describe("reconcilePaydays", () => {
  test("a split deposit straddling the payday nets to zero residual", () => {
    // A typical split shape: schedule says $3,000.01 on the 21st; the bank pays two halves on
    // the 20th and the 22nd.
    const r = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 3000.01 }],
      deposits: [dep("2026-09-20", 1500.01), dep("2026-09-22", 1500.01)],
    });
    assert.deepEqual(r.residuals, []);
    assert.equal(r.matches[0].arrived, 3000.02);
    assert.equal(r.matches[0].complete, true);
    assert.equal(r.unmatched.length, 0);
  });

  test("only the arrived half is netted out — the rest is still projected", () => {
    // This is the bug that overstated month-end by one half ($1,500.00): anchored on the 20th, one
    // half is inside the balance and the other is genuinely still coming.
    const r = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 3000.01 }],
      deposits: [dep("2026-09-20", 1500.01)],
    });
    assert.deepEqual(r.residuals, [{ date: "2026-09-21", amount: 1500.00 }]);
    assert.equal(r.matches[0].complete, false);
  });

  test("nothing arrived → the whole payday is still projected", () => {
    const r = reconcilePaydays({ scheduled: [{ date: "2026-09-21", amount: 3000.01 }], deposits: [] });
    assert.deepEqual(r.residuals, [{ date: "2026-09-21", amount: 3000.01 }]);
  });

  test("a deposit outside the window belongs to no payday", () => {
    const r = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 3000.01 }],
      deposits: [dep("2026-09-17", 1500.01)], // 4 days out, window is 3
    });
    assert.deepEqual(r.residuals, [{ date: "2026-09-21", amount: 3000.01 }]);
    assert.equal(r.unmatched.length, 1);
  });

  test("the window is configurable — ±3 is only the default", () => {
    const args = { scheduled: [{ date: "2026-09-21", amount: 3000.01 }], deposits: [dep("2026-09-17", 3000.01)] };
    assert.equal(reconcilePaydays({ ...args, windowDays: 3 }).residuals.length, 1);
    assert.equal(reconcilePaydays({ ...args, windowDays: 4 }).residuals.length, 0);
    // 0 means "the nominal date or nothing".
    assert.equal(reconcilePaydays({ scheduled: args.scheduled, deposits: [dep("2026-09-21", 3000.01)], windowDays: 0 }).residuals.length, 0);
  });

  test("halves land on the SAME half-filled payday rather than drifting to a neighbour", () => {
    // Two paydays 5 days apart with a ±3 window overlap in the middle. The second half must find
    // the bucket the first half started, not the nearer-but-satisfied neighbour.
    const r = reconcilePaydays({
      scheduled: [
        { date: "2026-09-16", amount: 1000 },
        { date: "2026-09-21", amount: 1000 },
      ],
      deposits: [dep("2026-09-16", 1000), dep("2026-09-19", 500), dep("2026-09-20", 500)],
      windowDays: 3,
    });
    assert.deepEqual(r.residuals, []);
    assert.equal(r.matches[0].arrived, 1000);
    assert.equal(r.matches[1].arrived, 1000);
  });

  test("uneven splits and a rounding half-cent still read as complete", () => {
    const r = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 3000.01 }],
      deposits: [dep("2026-09-21", 2000), dep("2026-09-21", 999.78)],
    });
    // 23¢ short: well past split rounding, so it stays visible as money still owed.
    assert.deepEqual(r.residuals, [{ date: "2026-09-21", amount: 0.23 }]);
    const exact = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 3000.01 }],
      deposits: [dep("2026-09-21", 2000), dep("2026-09-21", 999.78), dep("2026-09-21", 0.23)],
    });
    assert.deepEqual(exact.residuals, []);
  });

  test("more than two splits work — the bucket just keeps filling", () => {
    const r = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 3000 }],
      deposits: [dep("2026-09-20", 1000), dep("2026-09-21", 1000), dep("2026-09-22", 1000)],
    });
    assert.deepEqual(r.residuals, []);
    assert.equal(r.matches[0].deposits.length, 3);
  });

  test("a bonus on top of a full payday is surplus, not a negative residual", () => {
    const r = reconcilePaydays({
      scheduled: [{ date: "2026-09-21", amount: 1000 }],
      deposits: [dep("2026-09-21", 1000), dep("2026-09-22", 400)],
    });
    assert.deepEqual(r.residuals, []);
    assert.equal(r.matches[0].arrived, 1400); // visible, and never negative
  });

  test("residual keeps its nominal date so the caller can see it is late", () => {
    const r = reconcilePaydays({ scheduled: [{ date: "2026-09-06", amount: 100 }], deposits: [] });
    assert.equal(r.residuals[0].date, "2026-09-06");
  });
});

describe("isPayrollDescription", () => {
  test("recognises typical bank payroll descriptions", () => {
    assert.ok(isPayrollDescription("Deposit from 12345678ACMECORP PAYROLL"));
    assert.ok(isPayrollDescription("...678ACMECORP PAYROLL 260904~ Tran: A"));
  });

  test("ignores other credits", () => {
    assert.equal(isPayrollDescription("DSB-MANUAL DRAFT - Check Deposit (Mobile)"), false);
    assert.equal(isPayrollDescription("Instant transfer received from Robinhood Securities"), false);
    assert.equal(isPayrollDescription(null), false);
  });

  test("an override pattern replaces the default", () => {
    assert.equal(isPayrollDescription("ACME DD", DEFAULT_DEPOSIT_MATCH), false);
    assert.ok(isPayrollDescription("ACME DD", "acme dd"));
  });

  test("an invalid regex matches nothing instead of throwing", () => {
    assert.equal(isPayrollDescription("PAYROLL", "([unclosed"), false);
  });
});

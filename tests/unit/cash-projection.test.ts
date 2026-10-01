import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { projectCash, type MonthSegment, type ProjectionLine } from "@/server/lib/cash-projection";
import { round2 } from "@/server/lib/budget";
import type { ObservedDeposit } from "@/server/lib/payday-reconcile";

const cat = (id: number, planned: number, actual: number): ProjectionLine => ({
  id,
  kind: "category",
  label: `cat${id}`,
  planned,
  actual,
  accountId: null,
});

function september(over: Partial<MonthSegment> = {}): MonthSegment {
  return {
    label: "2026-09",
    start: "2026-09-01",
    end: "2026-09-30",
    paydays: [
      { date: "2026-09-06", amount: 3000.01 },
      { date: "2026-09-21", amount: 3000.01 },
    ],
    bills: [],
    lines: [],
    ...over,
  };
}

const october = (over: Partial<MonthSegment> = {}): MonthSegment => ({
  label: "2026-10",
  start: "2026-10-01",
  end: "2026-10-31",
  paydays: [
    { date: "2026-10-06", amount: 3000.01 },
    { date: "2026-10-21", amount: 3000.01 },
  ],
  bills: [],
  lines: [],
  ...over,
});

// Four payroll halves landing in 2026-09: two around the 6th, two around the 21st.
const SEP_DEPOSITS: ObservedDeposit[] = [
  { date: "2026-09-03", amount: 1500.01 },
  { date: "2026-09-04", amount: 1500.01 },
  { date: "2026-09-20", amount: 1500.01 },
  { date: "2026-09-22", amount: 1500.01 },
];

describe("projectCash — payday double-count (the 2026-09-20 regression)", () => {
  // Illustrative snapshot: anchored on 2026-09-20 with $5,210.37 on hand, $1,823.45 of
  // bills/debt left and $1,096.28 of budget left. Checking A's half of the 21st payday had
  // already landed; Checking B's had not.
  const scenario = (deposits: ObservedDeposit[]) =>
    projectCash({
      asOf: "2026-09-20",
      cashNow: 5210.37,
      segments: [
        september({
          observedDeposits: deposits,
          bills: [{ id: 1, name: "rest of the month", amount: 1823.45, dueDay: 30, paid: false, lineId: null, accountId: null }],
          lines: [cat(1, 1096.28, 0)],
        }),
      ],
      debts: [],
    });

  test("blind to the deposits it reproduces the wrong number exactly", () => {
    // $5,290.65 is what the buggy projection reports: the whole $3,000.01 added on top of a
    // balance that already held half of it.
    assert.equal(scenario([]).endBalance, 5290.65);
  });

  test("netting the arrived half out gives the honest number", () => {
    const p = scenario(SEP_DEPOSITS);
    // 5210.37 + 1500.00 (the half still coming) − 1823.45 − 1096.28
    assert.equal(p.endBalance, 3790.64);
    // …and that is within a few dollars of what the next day's clean snapshot would say ($3,912.40,
    // with a day less of spending left to spread), rather than $1,500 above it.
    assert.ok(Math.abs(p.endBalance - 3912.4) < 200);
  });

  test("the reconciliation is reported, not just applied", () => {
    const p = scenario(SEP_DEPOSITS);
    const twentyFirst = p.paydays.find((m) => m.date === "2026-09-21")!;
    assert.equal(twentyFirst.expected, 3000.01);
    assert.equal(twentyFirst.arrived, 1500.01);
    assert.equal(twentyFirst.residual, 1500.00);
    assert.equal(twentyFirst.complete, false);
    // The 6th is fully in — both halves landed within 3 days of it.
    assert.equal(p.paydays.find((m) => m.date === "2026-09-06")!.complete, true);
    assert.equal(p.totals.inflow, 1500.00);
  });

  test("a payday long past with nothing matched is dropped, not resurrected as income", () => {
    // If the payroll matcher misses a description, the money already arrived — inventing it as a
    // future inflow would be worse than the bug being fixed.
    const p = projectCash({
      asOf: "2026-09-20",
      cashNow: 5210.37,
      segments: [september({ observedDeposits: [{ date: "2026-09-20", amount: 1500.01 }] })],
      debts: [],
    });
    assert.equal(p.events.filter((e) => e.kind === "paycheck").length, 1); // only the 21st's residual
    assert.equal(p.paydays.find((m) => m.date === "2026-09-06")!.complete, false); // still visible
  });

  test("a payday a day or two late is carried to tomorrow, not lost", () => {
    const p = projectCash({
      asOf: "2026-09-22",
      cashNow: 1000,
      segments: [september({ paydays: [{ date: "2026-09-21", amount: 500 }], observedDeposits: [] })],
      debts: [],
    });
    const pay = p.events.filter((e) => e.kind === "paycheck");
    assert.equal(pay.length, 1);
    assert.equal(pay[0].date, "2026-09-23"); // the first projected day
    assert.equal(pay[0].overdue, true);
  });

  test("income near no payday is surfaced instead of silently eaten", () => {
    const p = projectCash({
      asOf: "2026-09-20",
      cashNow: 100,
      segments: [september({ observedDeposits: [...SEP_DEPOSITS, { date: "2026-09-12", amount: 42.5 }] })],
      debts: [],
    });
    assert.equal(p.months[0].unexpectedIncome, 42.5);
  });
});

describe("projectCash — pending outflows", () => {
  test("a pending charge dated ahead of the anchor leaves cash on its own day", () => {
    const p = projectCash({
      asOf: "2026-09-28",
      cashNow: 1000,
      segments: [
        september({
          paydays: [],
          pending: [{ id: 9, label: "card payment (pending)", date: "2026-09-30", amount: 250, lineId: null }],
        }),
      ],
      debts: [],
    });
    assert.equal(p.endBalance, 750);
    assert.equal(p.totals.pending, 250);
    assert.equal(p.events.find((e) => e.kind === "pending")!.date, "2026-09-30");
  });

  test("a pending charge already past is assumed to settle on the first projected day", () => {
    const p = projectCash({
      asOf: "2026-09-28",
      cashNow: 1000,
      segments: [september({ paydays: [], pending: [{ id: 9, label: "late", date: "2026-09-25", amount: 100, lineId: null }] })],
      debts: [],
    });
    assert.equal(p.events.find((e) => e.kind === "pending")!.date, "2026-09-29");
    assert.equal(p.endBalance, 900);
  });

  test("a pending charge that a budget line does NOT already count is deducted from it once", () => {
    // lineId set = the line's `actual` is blind to this row, so its remaining must shrink too,
    // otherwise the same dollars get spread across the month AND paid on the day.
    const p = projectCash({
      asOf: "2026-09-28",
      cashNow: 1000,
      segments: [
        september({
          paydays: [],
          lines: [cat(1, 300, 0)],
          pending: [{ id: 9, label: "groceries", date: "2026-09-30", amount: 100, lineId: 1 }],
        }),
      ],
      debts: [],
    });
    assert.equal(p.spreadTotal, 200); // 300 planned − 100 already committed
    assert.equal(p.endBalance, 700); // 1000 − 200 spread − 100 pending, counted once
  });
});

describe("projectCash — overspend is credited forward", () => {
  const twoLines = (gasActual: number) =>
    projectCash({
      asOf: "2026-09-20",
      cashNow: 1000,
      segments: [september({ paydays: [], lines: [cat(1, 160, gasActual), cat(2, 400, 200)] })],
      debts: [],
    });

  test("blowing one envelope leaves the month with less to spend, not the same", () => {
    // Gas $20 over its $160, Restaurant $200 left of its $400. Net remaining is $180.
    const over = twoLines(180);
    assert.equal(over.spreadTotal, 180);
    assert.equal(over.months[0].overspend, 20);
    // Exactly on plan, the same month has the full $200 left — so the $20 overspend is what
    // moved it. The old per-line floor clamped Gas at 0 and left $200 either way.
    assert.equal(twoLines(160).spreadTotal, 200);
    assert.equal(twoLines(160).months[0].overspend, 0);
  });

  test("a big enough overspend floors the month at zero rather than going negative", () => {
    const p = projectCash({
      asOf: "2026-09-20",
      cashNow: 1000,
      segments: [september({ paydays: [], lines: [cat(1, 100, 900), cat(2, 200, 0)] })],
      debts: [],
    });
    assert.equal(p.spreadTotal, 0); // 200 left − 800 over → floored
    assert.equal(p.months[0].overspend, 800);
    assert.equal(p.endBalance, 1000); // nothing further is assumed to leave
  });

  test("a bill bigger than its line eats into the rest of the month's budget", () => {
    const p = projectCash({
      asOf: "2026-09-20",
      cashNow: 1000,
      segments: [
        september({
          paydays: [],
          lines: [cat(1, 50, 0), cat(2, 300, 0)],
          bills: [{ id: 1, name: "big", amount: 200, dueDay: 25, paid: false, lineId: 1, accountId: null }],
        }),
      ],
      debts: [],
    });
    // 50 + 300 planned, a 200 bill against the 50 line → 150 of it comes out of the other envelope.
    assert.equal(p.spreadTotal, 150);
    assert.equal(p.endBalance, 650); // 1000 − 200 bill − 150 spread
  });
});

describe("projectCash — reserved cash", () => {
  const withReserve = (reservedCash: number) =>
    projectCash({
      asOf: "2026-09-28",
      cashNow: 5412.5,
      segments: [september({ paydays: [], lines: [cat(1, 412.3, 0)] })],
      reservedCash,
      debts: [],
    });

  test("the walk is untouched — a reserve changes what's FREE, not what's there", () => {
    assert.equal(withReserve(3200).endBalance, withReserve(0).endBalance);
  });

  test("spendable strips the reserve out of every landmark", () => {
    const p = withReserve(3200);
    assert.equal(p.spendable.reserved, 3200);
    assert.equal(p.spendable.now, 2212.5);
    assert.equal(p.spendable.end, 1800.2);
    assert.equal(p.spendable.low.balance, round2(p.low.balance - 3200));
    assert.equal(p.spendable.low.date, p.low.date);
  });

  test("spendable can go negative — that is the point", () => {
    const p = withReserve(7000);
    assert.ok(p.spendable.end < 0);
    assert.equal(p.endBalance > 0, true);
  });

  test("no reserve leaves spendable equal to cash", () => {
    const p = withReserve(0);
    assert.equal(p.spendable.now, p.start);
    assert.equal(p.spendable.end, p.endBalance);
  });
});

describe("projectCash — focus month and lead-in", () => {
  const leadIn = () =>
    projectCash({
      asOf: "2026-09-28",
      cashNow: 5412.5,
      segments: [
        september({ paydays: [], lines: [cat(1, 412.3, 0)] }), // September's tail: the rest of its budget
        october({ paydays: [], lines: [cat(2, 3100, 0)] }),
      ],
      focusIndex: 1,
      debts: [],
    });

  test("a future month opens at the anchor month's projected end, not at today's cash", () => {
    const p = leadIn();
    assert.equal(p.months[0].endBalance, 5000.2); // 5412.5 − 412.3 of September left
    assert.equal(p.months[1].label, "2026-10");
    assert.equal(p.endBalance, 1900.2); // 5000.2 − 3100 of October
    assert.equal(p.focusIndex, 1);
    assert.equal(p.end, "2026-10-31"); // the focus month's end, not the anchor's
  });

  test("each month's spread only drains on days that belong to it", () => {
    const p = leadIn();
    // 2 days left in September at 412.3/2, then October at 3100/31.
    assert.equal(p.days.find((d) => d.date === "2026-09-29")!.spread, 206.15);
    assert.equal(p.days.find((d) => d.date === "2026-10-01")!.spread, 100);
  });

  test("a month's low point comes from its own days", () => {
    const p = leadIn();
    // Regression: the low used to be seeded with today's cash, so a month that never dipped below
    // it reported a date outside itself.
    assert.ok(p.months[1].low.date >= "2026-10-01" && p.months[1].low.date <= "2026-10-31");
    assert.equal(p.lowThisMonth.date, p.months[1].low.date);
  });

  test("days outside every segment never borrow the last segment's burn rate", () => {
    // Anchored in August with segments for September and October: the August tail must not drain
    // October's daily allowance.
    const p = projectCash({
      asOf: "2026-08-30",
      cashNow: 1000,
      segments: [september({ paydays: [], lines: [cat(1, 300, 0)] }), october({ paydays: [], lines: [cat(2, 3100, 0)] })],
      focusIndex: 0,
      debts: [],
    });
    assert.equal(p.days.find((d) => d.date === "2026-08-31")!.spread, 0);
    assert.equal(p.days.find((d) => d.date === "2026-08-31")!.balance, 1000);
  });
});

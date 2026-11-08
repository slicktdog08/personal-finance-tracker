import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planMonth, projectCash, type MonthSegment, type ProjectionLine } from "@/server/lib/cash-projection";
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
    assert.equal(over.envelope.total, 180);
    assert.equal(over.months[0].overspend, 20);
    // Exactly on plan, the same month has the full $200 left — so the $20 overspend is what
    // moved it. The old per-line floor clamped Gas at 0 and left $200 either way.
    assert.equal(twoLines(160).envelope.total, 200);
    assert.equal(twoLines(160).months[0].overspend, 0);
  });

  test("a big enough overspend floors the month at zero rather than going negative", () => {
    const p = projectCash({
      asOf: "2026-09-20",
      cashNow: 1000,
      segments: [september({ paydays: [], lines: [cat(1, 100, 900), cat(2, 200, 0)] })],
      debts: [],
    });
    assert.equal(p.envelope.total, 0); // 200 left − 800 over → floored
    assert.equal(p.months[0].overspend, 800);
    assert.equal(p.envelope.endBalance, 1000); // on the envelope bookend, nothing further leaves
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
    assert.equal(p.envelope.total, 150);
    assert.equal(p.envelope.endBalance, 650); // 1000 − 200 bill − 150 envelope
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

describe("projectCash — observed pace vs. the envelope bookend", () => {
  test("the last day of the month no longer absorbs the whole unspent remainder", () => {
    // The case this was built for. Anchored 2026-09-29 with one day left and $275.09 of envelope
    // unspent, the envelope rate is "everything left ÷ 1 day" — it put the entire remainder on
    // the 30th, more than twice the month's own average. Pace spreads nothing: it just keeps
    // spending at the rate the month has actually run at.
    const p = projectCash({
      asOf: "2026-09-29",
      cashNow: 7027.12,
      // $2,900 spent over 29 days ≈ $100/day, with $275.09 of envelope left.
      segments: [september({ paydays: [], lines: [cat(1, 3175.09, 2900)] })],
      debts: [],
    });
    assert.equal(p.spreadDays, 1);
    assert.equal(p.envelope.total, 275.09); // the old number, still reported
    assert.equal(p.envelope.daily, 275.09); // …and still a cliff: all of it on one day
    assert.equal(p.spreadDaily, 100); // 2900 / 29 — what the month has actually been doing
    assert.equal(p.endBalance, 6927.12); // 7027.12 − 100
    assert.equal(p.envelope.endBalance, 6752.03); // 7027.12 − 275.09, the conservative bookend
  });

  test("the envelope rate accelerates toward month end; a steady pace does not", () => {
    const at = (asOf: string, spent: number) =>
      projectCash({ asOf, cashNow: 5000, segments: [september({ paydays: [], lines: [cat(1, 3000, spent)] })], debts: [] });
    // Envelope: the same $2,000 left on both days, but fewer days to force it into, so the rate
    // climbs — 2000/10 on the 20th against 2000/5 on the 25th.
    assert.equal(at("2026-09-20", 1000).envelope.total, 2000);
    assert.equal(at("2026-09-25", 1000).envelope.total, 2000);
    assert.ok(at("2026-09-25", 1000).envelope.daily > at("2026-09-20", 1000).envelope.daily * 1.9);
    // Pace, held at a genuine $50/day on both anchors, reads $50/day on both. It tracks what the
    // month is doing rather than how much calendar is left to cram the budget into.
    assert.equal(at("2026-09-20", 1000).spreadDaily, 50);
    assert.equal(at("2026-09-25", 1250).spreadDaily, 50);
  });

  test("running hot projects over budget — pace is not capped at the envelope", () => {
    // $2,500 spent in 10 days against a $3,000 plan: at this rate the budget is gone by the 12th.
    const p = projectCash({
      asOf: "2026-09-10",
      cashNow: 9000,
      segments: [september({ paydays: [], lines: [cat(1, 3000, 2500)] })],
      debts: [],
    });
    assert.equal(p.spreadDaily, 250);
    assert.equal(p.spreadTotal, 5000); // 250 × 20 remaining days
    assert.equal(p.envelope.total, 500); // what the plan actually leaves
    assert.ok(p.endBalance < p.envelope.endBalance); // the honest read is worse, and says so
  });

  test("a month with nothing spent yet falls back to the envelope rate", () => {
    const p = projectCash({
      asOf: "2026-09-01",
      cashNow: 1000,
      segments: [september({ paydays: [], lines: [cat(1, 290, 0)] })],
      debts: [],
    });
    assert.equal(p.months[0].pacedFromHistory, false);
    assert.equal(p.spreadDaily, p.envelope.daily);
    assert.equal(p.endBalance, p.envelope.endBalance);
  });

  test("a future month has no history to pace from and uses its own envelope", () => {
    const p = projectCash({
      asOf: "2026-09-29",
      cashNow: 5000,
      segments: [september({ paydays: [], lines: [cat(1, 1000, 900)] }), october({ paydays: [], lines: [cat(2, 3100, 0)] })],
      focusIndex: 0,
      debts: [],
    });
    assert.equal(p.months[1].pacedFromHistory, false);
    assert.equal(p.months[1].spreadDaily, p.months[1].envelopeDaily);
  });

  test("a thin sample is blended toward the plan, not extrapolated off a cliff", () => {
    // Day 1 of the month, one $300 grocery run. Raw pace would be $300/day → a $9,300 month
    // against a $3,100 plan. The blend weights it 1/7 pace, 6/7 plan.
    const d1 = projectCash({
      asOf: "2026-09-01",
      cashNow: 20000,
      segments: [september({ paydays: [], lines: [cat(1, 3100, 300)] })],
      debts: [],
    });
    assert.equal(d1.months[0].paceWeight, 0.14); // 1/7
    assert.ok(d1.spreadDaily < 150, `blended rate ${d1.spreadDaily} should be nowhere near 300`);
    // By day 7 the sample is trusted on its own.
    const d7 = projectCash({
      asOf: "2026-09-07",
      cashNow: 20000,
      segments: [september({ paydays: [], lines: [cat(1, 3100, 700)] })],
      debts: [],
    });
    assert.equal(d7.months[0].paceWeight, 1);
    assert.equal(d7.spreadDaily, 100); // 700 / 7, no blending left
  });

  test("the pace measurement is reported so the UI can show its working", () => {
    const p = projectCash({
      asOf: "2026-09-10",
      cashNow: 1000,
      segments: [september({ paydays: [], lines: [cat(1, 600, 300)] })],
      debts: [],
    });
    assert.equal(p.months[0].observedSpend, 300);
    assert.equal(p.months[0].elapsedDays, 10);
    assert.equal(p.months[0].pacedFromHistory, true);
    assert.equal(p.spreadDaily, 30);
  });
});

describe("projectCash — pace measures everyday spending, not bills", () => {
  // The regression. A category line's `actual` is EVERY transaction in that category, bill
  // payments included. Measuring a daily rate off it raw extrapolates each paid bill across the
  // whole month: four days into 2026-10, rent ($1,410) and a utility ($165.24) made $1,949 of
  // "spend" read as $487/day and projected rent roughly seven more times — month-end $883 and a
  // −$1,368 low on a budget that nets to zero.
  const octoberish = (paid: boolean) =>
    projectCash({
      asOf: "2026-10-04",
      cashNow: 5125.13,
      segments: [
        october({
          paydays: [],
          // $1,575.24 of bills + ~$374 of real everyday spending.
          lines: [cat(1, 1414, 1413.95), cat(2, 240, 165.24), cat(3, 2645, 369.94)],
          bills: [
            { id: 1, name: "Riverside Apartments", amount: 1410, dueDay: 1, paid, lineId: 1, accountId: null },
            { id: 2, name: "City Power & Light", amount: 165.24, dueDay: 2, paid, lineId: 2, accountId: null },
          ],
        }),
      ],
      focusIndex: 0,
      debts: [],
    });

  test("a paid bill is taken out of the pace measurement", () => {
    const p = octoberish(true);
    const m = p.months[0];
    assert.equal(m.categoryActual, 1949.13); // everything in the category lines
    assert.equal(m.paidBillsInLines, 1575.24); // …of which this much was bills
    assert.equal(m.observedSpend, 373.89); // leaving the everyday spending
    // ~$93/day, not the ~$487/day the raw figure would have given.
    assert.ok(m.observedSpend / m.elapsedDays < 100);
  });

  test("…so the month no longer projects rent seven more times", () => {
    const p = octoberish(true);
    // The broken version put 27 × $308 = $8,325 of everyday spending ahead of a $2,350 envelope.
    // Now the two assumptions agree closely, which is the real signal: a pace measured off
    // everyday spending lands near the plan instead of several times it.
    assert.ok(p.spreadTotal < 3000, `spreadTotal ${p.spreadTotal} should be near the envelope`);
    assert.ok(
      Math.abs(p.endBalance - p.envelope.endBalance) < 300,
      `pace end ${p.endBalance} and envelope end ${p.envelope.endBalance} should be close`,
    );
    assert.ok(p.low.balance > 0, `low ${p.low.balance} should not go negative`);
  });

  test("an UNPAID bill stays out of the measurement too — its money hasn't moved yet", () => {
    // Unpaid bills aren't in `actual` at all, so there is nothing to subtract and nothing to
    // extrapolate; they are future events instead. Pace sees only the everyday spending.
    const p = octoberish(false);
    const m = p.months[0];
    // Same category actuals, but the bills are still ahead, so none is credited as "paid".
    assert.equal(m.paidBillsInLines, 0);
    assert.equal(m.observedSpend, 1949.13);
  });

  test("pace is never negative, even if bills exceed what the lines recorded", () => {
    const p = projectCash({
      asOf: "2026-10-04",
      cashNow: 5000,
      segments: [
        october({
          paydays: [],
          lines: [cat(1, 1414, 100)], // the line records less than the bill claims
          bills: [{ id: 1, name: "Rent", amount: 1410, dueDay: 1, paid: true, lineId: 1, accountId: null }],
        }),
      ],
      debts: [],
    });
    assert.equal(p.months[0].observedSpend, 0);
    assert.ok(p.spreadDaily >= 0);
  });
});

describe("projectCash — a bill draws from its envelope", () => {
  // The whole point: a bill and the category line that plans for it describe the SAME money, so
  // the month must not pay it twice. The link is `lineId`; when it is null the bill is pure extra
  // outflow, which is correct for a genuinely unplanned bill and a $1,575/month bug otherwise.
  const withBill = (lineId: number | null, envelope = 1440, bill = 1410) =>
    projectCash({
      asOf: "2026-09-01",
      cashNow: 10000,
      segments: [
        september({
          paydays: [],
          lines: [cat(1, envelope, 0)],
          bills: [{ id: 1, name: "Riverside Apartments", amount: bill, dueDay: 1, paid: false, lineId, accountId: null }],
        }),
      ],
      debts: [],
    });

  test("envelope covers the bill exactly → the month nets to the envelope, not envelope + bill", () => {
    const p = withBill(1, 1410, 1410);
    assert.equal(p.spreadTotal, 0); // the bill consumed the whole envelope
    assert.equal(p.endBalance, 8590); // 10000 − 1410, counted ONCE
    assert.equal(p.months[0].unbudgetedBillTotal, 0);
  });

  test("a bill bigger than its envelope only adds the overage", () => {
    const p = withBill(1, 1000, 1410);
    assert.equal(p.spreadTotal, 0);
    assert.equal(p.endBalance, 8590); // still just the bill — the $410 over is not charged twice
    assert.equal(p.months[0].overspend, 410); // …but it IS reported as over plan
  });

  test("an unlinked bill is counted twice — the bug, pinned so it cannot come back quietly", () => {
    const linked = withBill(1);
    const orphan = withBill(null);
    // 10000 − 1410 bill − (1440 envelope − 1410 consumed) = 8560
    assert.equal(linked.endBalance, 8560);
    // 10000 − 1410 bill − 1440 envelope spread in full = 7150. That $1,410 gap is the double count.
    assert.equal(orphan.endBalance, 7150);
    assert.equal(round2(linked.endBalance - orphan.endBalance), 1410);
  });

  test("an unlinked bill is reported, not silently absorbed", () => {
    const p = withBill(null);
    assert.equal(p.months[0].unbudgetedBillTotal, 1410);
    assert.deepEqual(
      p.months[0].unbudgetedBills.map((b) => b.name),
      ["Riverside Apartments"],
    );
  });

  test("a zero-based month where every bill finds its envelope projects flat", () => {
    // Income = debt + envelopes, and each bill draws from a line. Month-end should equal start.
    const p = projectCash({
      asOf: "2026-09-01",
      cashNow: 5000,
      segments: [
        september({
          paydays: [{ date: "2026-09-06", amount: 2000 }],
          lines: [cat(1, 1200, 0), cat(2, 800, 0)],
          bills: [
            { id: 1, name: "Rent", amount: 1000, dueDay: 1, paid: false, lineId: 1, accountId: null },
            { id: 2, name: "Power", amount: 150, dueDay: 2, paid: false, lineId: 2, accountId: null },
          ],
        }),
      ],
      debts: [],
    });
    // 2000 in; out = 1150 of bills + (2000 planned − 1150 consumed) = 2000. Net zero.
    assert.equal(p.endBalance, 5000);
    assert.equal(p.months[0].unbudgetedBillTotal, 0);
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

describe("planMonth — the fixed budgeted path", () => {
  const seg = () =>
    october({
      // Half of October's payroll already landed and half the groceries are spent — none of which
      // the plan may look at.
      observedDeposits: [{ date: "2026-10-06", amount: 3000.02 }],
      pending: [{ id: 1, label: "Pending", date: "2026-10-09", amount: 80, lineId: 1 }],
      bills: [
        { id: 1, name: "Rent", amount: 1410, dueDay: 1, paid: true, lineId: null, accountId: null },
        { id: 2, name: "Gym", amount: 50, dueDay: 9, paid: false, lineId: 1, accountId: null },
      ],
      lines: [cat(1, 620, 310)],
    });

  test("walks every day of the month from the opening balance", () => {
    const plan = planMonth(seg(), 5000);
    assert.equal(plan.start, 5000);
    assert.equal(plan.days.length, 31);
    assert.equal(plan.days[0].date, "2026-10-01");
    assert.equal(plan.days[30].date, "2026-10-31");
  });

  test("ignores actuals, paid marks, matched deposits and pending", () => {
    // In full: +2 paydays, −rent, −gym, and the grocery line's 620 (gym comes out of it, so 570
    // is spread). Nothing that happened changes that.
    const expected = round2(5000 + 3000.01 * 2 - 1410 - 50 - 570);
    assert.equal(planMonth(seg(), 5000).endBalance, expected);
    const untouched = { ...seg(), observedDeposits: [], pending: [], bills: seg().bills.map((b) => ({ ...b, paid: false })), lines: [cat(1, 620, 0)] };
    assert.deepEqual(planMonth(untouched, 5000), planMonth(seg(), 5000));
  });

  test("bills leave on their due day, paydays land on theirs", () => {
    const by = new Map(planMonth(seg(), 5000).days.map((d) => [d.date, d.balance]));
    const daily = 570 / 31;
    assert.equal(by.get("2026-10-01"), round2(5000 - 1410 - daily));
    assert.equal(by.get("2026-10-06"), round2(5000 - 1410 + 3000.01 - daily * 6));
    assert.equal(by.get("2026-10-09"), round2(5000 - 1410 + 3000.01 - 50 - daily * 9));
  });
});

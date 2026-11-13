import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { autoBucket, bucketEnds, bucketFlows, bucketKey, bucketLedger, bucketName, cumulativeNet, flowTotals, monthlyLedger, seriesStats, windowStartLabel, type TrendMonth } from "@/server/lib/trends";

describe("windowStartLabel", () => {
  test("counts the current month as one of the n", () => {
    assert.equal(windowStartLabel("2026-11", 3), "2026-09");
    assert.equal(windowStartLabel("2026-02", 6), "2025-09");
    assert.equal(windowStartLabel("2026-01", 1), "2026-01");
  });
});

describe("seriesStats", () => {
  test("needs two recorded months", () => {
    assert.equal(seriesStats([{ label: "a", value: null }, { label: "b", value: 5 }]), null);
  });

  test("change, high/low, average and moves skip leading gaps", () => {
    const st = seriesStats([
      { label: "Jan", value: null },
      { label: "Feb", value: 1000 },
      { label: "Mar", value: 1500 },
      { label: "Apr", value: 900 },
      { label: "May", value: 1200 },
    ])!;
    assert.equal(st.first.label, "Feb");
    assert.equal(st.change, 200);
    assert.equal(st.changePct, 20);
    assert.deepEqual(st.high, { label: "Mar", value: 1500 });
    assert.deepEqual(st.low, { label: "Apr", value: 900 });
    assert.equal(st.avg, 1150);
    assert.equal(st.span, 3);
    assert.equal(st.perMonth, 66.67);
    assert.deepEqual(st.bestMove, { label: "Mar", value: 500 });
    assert.deepEqual(st.worstMove, { label: "Apr", value: -600 });
  });

  test("a gap in the middle isn't counted as one month's move", () => {
    const st = seriesStats([
      { label: "Jan", value: 100 },
      { label: "Feb", value: null },
      { label: "Mar", value: 5000 },
    ])!;
    assert.equal(st.bestMove, null);
    assert.equal(st.span, 2);
  });

  test("no percent change from zero", () => {
    assert.equal(seriesStats([{ label: "a", value: 0 }, { label: "b", value: 50 }])!.changePct, null);
  });
});

describe("flowTotals / cumulativeNet", () => {
  const flows = [
    { label: "2026-01", in: 3000, out: 2500 },
    { label: "2026-02", in: 3000, out: 3200 },
    { label: "2026-03", in: 4000, out: 2000 },
  ];

  test("totals, averages and savings rate", () => {
    const t = flowTotals(flows);
    assert.equal(t.income, 10000);
    assert.equal(t.spending, 7700);
    assert.equal(t.net, 2300);
    assert.equal(t.savingsRate, 23);
    assert.equal(t.avgNet, 766.67);
    assert.equal(t.positiveMonths, 2);
  });

  test("empty input has no rate", () => {
    const t = flowTotals([]);
    assert.equal(t.savingsRate, null);
    assert.equal(t.avgIncome, 0);
  });

  test("running total of in − out", () => {
    assert.deepEqual(
      cumulativeNet(flows).map((p) => p.value),
      [500, 300, 2300],
    );
  });
});

describe("monthlyLedger", () => {
  const m = (label: string, cash: number | null, credit: number | null): TrendMonth => ({ label, cash, credit, loans: null, retirement: 0, assets: 0 });
  const netOf = (t: TrendMonth) => (t.cash == null || t.credit == null ? null : t.cash - t.credit);

  test("joins balances to flows and chains net-worth change", () => {
    const rows = monthlyLedger(
      [m("2026-01", 1000, null), m("2026-02", 1200, 500), m("2026-03", 1500, 400)],
      [
        { label: "2026-02", in: 2000, out: 1500 },
        { label: "2026-03", in: 2000, out: 2500 },
      ],
    netOf,
    );
    assert.deepEqual(
      rows.map((r) => r.label),
      ["2026-01", "2026-02", "2026-03"],
    );
    assert.equal(rows[0].income, null);
    assert.equal(rows[0].netWorth, null);
    assert.equal(rows[1].netWorth, 700);
    assert.equal(rows[1].netWorthChange, null); // nothing comparable before it
    assert.equal(rows[2].netWorthChange, 400);
    assert.equal(rows[2].net, -500);
    assert.equal(rows[1].savingsRate, 25);
    assert.equal(rows[2].debt, 400);
  });
});

describe("buckets", () => {
  test("autoBucket picks months, then quarters, then years", () => {
    assert.equal(autoBucket(12), "month");
    assert.equal(autoBucket(36), "month");
    assert.equal(autoBucket(95), "quarter");
    assert.equal(autoBucket(120), "year");
  });

  test("bucketKey and bucketName", () => {
    assert.equal(bucketKey("2026-05", "quarter"), "2026-Q2");
    assert.equal(bucketKey("2026-12", "quarter"), "2026-Q4");
    assert.equal(bucketKey("2026-05", "year"), "2026");
    assert.equal(bucketName("2026-Q2", "quarter", (l) => l), "Q2 '26");
    assert.equal(bucketName("2026-05", "month", () => "May '26"), "May '26");
  });

  test("bucketFlows sums in and out per quarter", () => {
    const f = bucketFlows(
      [
        { label: "2025-12", in: 100, out: 50 },
        { label: "2026-01", in: 10, out: 5 },
        { label: "2026-02", in: 20, out: 5 },
      ],
      "quarter",
    );
    assert.deepEqual(f, [
      { label: "2025-Q4", in: 100, out: 50 },
      { label: "2026-Q1", in: 30, out: 10 },
    ]);
  });

  test("bucketEnds takes the last recorded value in each bucket", () => {
    const e = bucketEnds(["2025-01", "2025-02", "2026-01", "2026-02"], [1, 2, 3, null], "year");
    assert.deepEqual(e, [
      { key: "2025", value: 2 },
      { key: "2026", value: 3 },
    ]);
  });

  test("bucketLedger sums flows and measures net worth change bucket to bucket", () => {
    const months: TrendMonth[] = [
      { label: "2025-11", cash: 100, credit: null, loans: null, retirement: 0, assets: 0 },
      { label: "2025-12", cash: 200, credit: null, loans: null, retirement: 0, assets: 0 },
      { label: "2026-01", cash: 260, credit: null, loans: null, retirement: 0, assets: 0 },
    ];
    const rows = monthlyLedger(
      months,
      [
        { label: "2025-11", in: 50, out: 10 },
        { label: "2025-12", in: 50, out: 20 },
        { label: "2026-01", in: 100, out: 40 },
      ],
      (m) => m.cash,
    );
    const y = bucketLedger(rows, "year");
    assert.equal(y.length, 2);
    assert.deepEqual(
      { label: y[0].label, months: y[0].months, income: y[0].income, net: y[0].net, netWorth: y[0].netWorth, change: y[0].netWorthChange },
      { label: "2025", months: 2, income: 100, net: 70, netWorth: 200, change: null },
    );
    assert.equal(y[1].netWorthChange, 60);
    assert.equal(y[1].savingsRate, 60);
  });
});

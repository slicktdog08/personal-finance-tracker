import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeVitals, yearToDate, type FlowPoint } from "@/server/lib/dashboard-vitals";

const f = (label: string, income: number, outgoing: number): FlowPoint => ({ label, income, outgoing });

describe("computeVitals", () => {
  const flows = [f("2026-01", 9000, 1000), f("2026-02", 4000, 3000), f("2026-03", 4000, 3500), f("2026-04", 4000, 2500), f("2026-05", 500, 2000)];

  test("averages the three complete months before the one viewed", () => {
    const v = computeVitals(flows, "2026-05", 6000);
    assert.deepEqual(v.basis, ["2026-02", "2026-03", "2026-04"]);
    assert.equal(v.avgOutgoing, 3000);
    assert.equal(v.runwayMonths, 2);
    assert.equal(v.savingsRate, 25);
    assert.equal(v.avgKept, 1000);
  });

  test("the month in progress never counts, and empty months are skipped", () => {
    const v = computeVitals([f("2026-01", 2000, 1000), f("2026-02", 0, 0), f("2026-03", 100, 5000)], "2026-03", 500);
    assert.deepEqual(v.basis, ["2026-01"]);
    assert.equal(v.runwayMonths, 0.5);
  });

  test("spending more than comes in is a negative rate", () => {
    const v = computeVitals([f("2026-01", 1000, 1500)], "2026-02", 0);
    assert.equal(v.savingsRate, -50);
    assert.equal(v.runwayMonths, 0);
  });

  test("no history → nothing to say", () => {
    const v = computeVitals(flows, "2026-01", 5000);
    assert.deepEqual(v.basis, []);
    assert.equal(v.runwayMonths, null);
    assert.equal(v.savingsRate, null);
  });

  test("no recorded cash → no runway, the rate still stands", () => {
    const v = computeVitals(flows, "2026-05", null);
    assert.equal(v.runwayMonths, null);
    assert.equal(v.savingsRate, 25);
  });
});

describe("yearToDate", () => {
  const flows = [f("2025-01", 3000, 2000), f("2025-02", 3000, 2500), f("2025-03", 9999, 9999), f("2026-01", 4000, 2000), f("2026-02", 4000, 3000)];

  test("compares the same months of the year before", () => {
    const y = yearToDate(flows, "2026-02")!;
    assert.equal(y.months, 2);
    assert.deepEqual(y.now, { income: 8000, outgoing: 5000, net: 3000 });
    assert.deepEqual(y.prior, { income: 6000, outgoing: 4500, net: 1500 });
  });

  test("no prior year → prior is null; no data this year → null", () => {
    assert.equal(yearToDate(flows, "2025-02")!.prior, null);
    assert.equal(yearToDate(flows, "2027-03"), null);
  });
});

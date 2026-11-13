import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCoverage, monthRange, type CoverageAccount } from "@/server/lib/coverage";

const acct = (id: number, active = true): CoverageAccount => ({ id, label: `Card ${id}`, institution: null, accountType: "Checking", active });

describe("monthRange", () => {
  test("spans a year boundary inclusively", () => {
    assert.deepEqual(monthRange("2019-11", "2020-02"), ["2019-11", "2019-12", "2020-01", "2020-02"]);
  });
});

describe("buildCoverage", () => {
  test("classifies before / inside / after gaps", () => {
    const c = buildCoverage({
      accounts: [acct(1)],
      txns: [
        { accountId: 1, month: "2020-03", n: 4 },
        { accountId: 1, month: "2020-06", n: 2 },
      ],
      balances: [{ accountId: 1, month: "2020-06", n: 1 }],
      from: "2020-01",
      to: "2020-08",
    });
    const row = c.rows[0];
    assert.deepEqual(
      row.cells.map((x) => x.state),
      ["none", "none", "txns", "none", "none", "both", "none", "none"],
    );
    assert.deepEqual(
      row.gaps.map((g) => [g.kind, g.from, g.to, g.months]),
      [
        ["before", "2020-01", "2020-02", 2],
        ["inside", "2020-04", "2020-05", 2],
        ["after", "2020-07", "2020-08", 2],
      ],
    );
    assert.equal(c.gaps[0].kind, "inside");
    assert.equal(c.totals.missingMonths, 6);
  });

  test("a closed account isn't expected past its last record; balances alone count", () => {
    const c = buildCoverage({
      accounts: [acct(2, false)],
      txns: [],
      balances: [
        { accountId: 2, month: "2021-01", n: 30 },
        { accountId: 2, month: "2021-02", n: 28 },
      ],
      from: "2021-01",
      to: "2021-05",
    });
    const row = c.rows[0];
    assert.equal(row.expected, 2);
    assert.equal(row.covered, 2);
    assert.equal(row.gaps.length, 0);
    assert.equal(row.cells[4].state, "outside");
  });

  test("closed accounts with no data and an unused no-account bucket are left out", () => {
    const c = buildCoverage({
      accounts: [acct(3, false), { id: null, label: "No account", institution: null, accountType: "", active: true }],
      txns: [],
      balances: [],
      from: "2021-01",
      to: "2021-02",
    });
    assert.equal(c.rows.length, 0);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dayBefore, planBalanceWrites, statementPoints } from "@/server/lib/pdf/balances";
import type { StatementBalance } from "@/server/lib/pdf/types";

const bal = (kind: "opening" | "closing", asOf: string, balance: number): StatementBalance => ({
  kind,
  asOf,
  balance,
  creditLimit: null,
  note: `Bank ${kind} balance`,
});

describe("statement balance snapshots", () => {
  test("dayBefore crosses month and year ends", () => {
    assert.equal(dayBefore("2026-10-01"), "2026-09-30");
    assert.equal(dayBefore("2026-03-01"), "2026-02-28");
    assert.equal(dayBefore("2027-01-01"), "2026-12-31");
  });

  test("one point per date; opening/closing win over a daily point on the same date", () => {
    const pts = statementPoints(
      [bal("opening", "2026-09-30", 100), bal("closing", "2026-10-02", 140)],
      [
        { asOf: "2026-10-01", balance: 120 },
        { asOf: "2026-10-02", balance: 140 },
      ],
      "Bank end-of-day balance",
    );
    assert.deepEqual(
      pts.map((p) => [p.asOf, p.balance, p.source]),
      [
        ["2026-09-30", 100, "statement"],
        ["2026-10-01", 120, "statement-daily"],
        ["2026-10-02", 140, "statement"],
      ],
    );
  });

  test("new dates insert, imported rows refresh, hand-entered rows are kept", () => {
    const pts = statementPoints(
      [],
      [
        { asOf: "2026-10-01", balance: 120 },
        { asOf: "2026-10-02", balance: 140 },
        { asOf: "2026-10-03", balance: 150 },
        { asOf: "2026-10-04", balance: 160 },
      ],
      "daily",
    );
    const plan = planBalanceWrites(pts, [
      { id: 1, asOf: "2026-10-02", balance: 999, source: null }, // typed by hand
      { id: 2, asOf: "2026-10-03", balance: 10, source: "statement" }, // older import, stale
      { id: 3, asOf: "2026-10-04", balance: 160, source: "statement-daily" }, // already right
    ]);
    assert.deepEqual(plan.inserts.map((p) => p.asOf), ["2026-10-01"]);
    assert.deepEqual(plan.updates.map((u) => [u.id, u.point.balance]), [[2, 150]]);
  });

  test("a hand-entered row protects its date even beside an imported one", () => {
    const pts = statementPoints([], [{ asOf: "2026-10-02", balance: 140 }], "daily");
    const plan = planBalanceWrites(pts, [
      { id: 5, asOf: "2026-10-02", balance: 1, source: "statement" },
      { id: 6, asOf: "2026-10-02", balance: 2, source: null },
    ]);
    assert.deepEqual(plan, { inserts: [], updates: [] });
  });
});

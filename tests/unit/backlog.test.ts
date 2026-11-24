import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { backlogTimeline, groupBacklog, looksMonthly, placesIn, type BacklogRow } from "@/server/lib/backlog";

let nextId = 1;
const row = (description: string, txnDate: string, amount = 10, direction = "Debit", accountId: number | null = 1): BacklogRow => ({
  id: nextId++,
  description,
  txnDate,
  amount,
  direction,
  accountId,
});

describe("looksMonthly", () => {
  test("about a month apart over 3+ months", () => {
    assert.equal(looksMonthly(["2024-01-15", "2024-02-15", "2024-03-14", "2024-04-15"]), true);
  });
  test("too few months, or weekly", () => {
    assert.equal(looksMonthly(["2024-01-15", "2024-02-15"]), false);
    assert.equal(looksMonthly(["2024-01-01", "2024-01-08", "2024-01-15", "2024-02-01", "2024-03-01", "2024-03-08", "2024-03-15"]), false);
  });
  test("same-day duplicates don't count as gaps", () => {
    assert.equal(looksMonthly(["2024-01-15", "2024-01-15", "2024-02-15", "2024-03-15"]), true);
  });
});

describe("groupBacklog", () => {
  test("one group per merchant, store numbers and places ignored, biggest first", () => {
    const rows = [
      row("SQ *JOES GRILL 8842 ANYTOWN CA", "2024-03-02", 12),
      row("SQ *JOES GRILL 0193 ANYTOWN CA", "2024-03-09", 18),
      row("SQ *JOES GRILL 0193 ANYTOWN CA", "2024-04-01", 20, "Debit", 2),
      row("DEMO STREAMING SVC", "2024-01-05", 9.99),
    ];
    const groups = groupBacklog(rows, []);
    assert.equal(groups.length, 2);
    const [grill, streaming] = groups;
    assert.equal(grill.pattern, "JOES GRILL");
    assert.equal(grill.count, 3);
    assert.equal(grill.net, 50);
    assert.equal(grill.amountMin, 12);
    assert.equal(grill.amountMax, 20);
    assert.equal(grill.firstDate, "2024-03-02");
    assert.equal(grill.lastDate, "2024-04-01");
    assert.equal(grill.months, 2);
    assert.deepEqual(grill.accounts, [
      { accountId: 1, n: 2 },
      { accountId: 2, n: 1 },
    ]);
    assert.equal(grill.samples.length, 2, "distinct descriptions only");
    assert.equal(grill.transactionIds[0], rows[2].id, "newest first");
    assert.equal(streaming.pattern, "DEMO STREAMING SVC");
    // Every row lands in exactly one group.
    assert.equal(groups.reduce((n, g) => n + g.count, 0), rows.length);
  });

  test("credits net against debits and are counted separately", () => {
    const [g] = groupBacklog([row("ACME OUTFITTERS", "2024-05-01", 80), row("ACME OUTFITTERS", "2024-05-09", 30, "Credit")], []);
    assert.equal(g.debitCount, 1);
    assert.equal(g.creditCount, 1);
    assert.equal(g.net, 50);
  });

  test("look-alikes: what already-categorized descriptions of the merchant are filed under", () => {
    const [g] = groupBacklog(
      [row("SQ *JOES GRILL 0001", "2024-06-01")],
      [
        { description: "SQ *JOES GRILL 0777", category: "Dining" },
        { description: "SQ *JOES GRILL 0778", category: "Dining" },
        { description: "SQ *JOES GRILL 0779", category: "Groceries" },
        { description: "OTHER PLACE", category: "Shopping" },
      ],
    );
    assert.deepEqual(g.lookalikes, { category: "Dining", n: 2, of: 3, others: [{ category: "Groceries", n: 1 }] });
  });

  test("no look-alikes → null; ids capped with a flag", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row("ACME PAYROLL", `2024-0${i + 1}-01`, 2000, "Credit"));
    const [g] = groupBacklog(rows, [], { idCap: 3 });
    assert.equal(g.lookalikes, null);
    assert.equal(g.transactionIds.length, 3);
    assert.equal(g.idsTruncated, true);
    assert.equal(g.monthly, true);
  });
});

describe("placesIn / backlogTimeline", () => {
  test("a trailing city and state are a place", () => {
    const places = new Set(["ANYTOWN"]);
    assert.deepEqual(placesIn("JOES GRILL 8842 ANYTOWN CA", { places }), ["ANYTOWN CA"]);
    assert.deepEqual(placesIn("DEMO STREAMING SVC", { places }), []);
  });

  test("per month: totals, uncategorized and the places named", () => {
    const places = new Set(["ANYTOWN", "OTHERVILLE"]);
    const t = backlogTimeline(
      [
        { description: "JOES GRILL ANYTOWN CA", txnDate: "2024-01-03", uncategorized: true },
        { description: "CORNER MART ANYTOWN CA", txnDate: "2024-01-20", uncategorized: false },
        { description: "HARBOR CAFE OTHERVILLE TX", txnDate: "2024-02-11", uncategorized: true },
      ],
      { places },
    );
    assert.deepEqual(t, [
      { month: "2024-01", total: 2, uncategorized: 1, places: [{ place: "ANYTOWN CA", n: 2 }] },
      { month: "2024-02", total: 1, uncategorized: 1, places: [{ place: "OTHERVILLE TX", n: 1 }] },
    ]);
  });
});

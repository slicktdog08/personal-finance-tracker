import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  categorize,
  cleanRuleInput,
  describeRuleMatch,
  matchesRule,
  ruleFromRow,
  ruleSeedPattern,
  type CategoryRule,
  type RuleInput,
} from "@/server/lib/categorize";
import { applyRuleToRows, countLocalMatches } from "@/components/import/rule-helpers";
import type { PreviewRow } from "@/server/lib/import-types";

let nextId = 1;
function rule(p: Partial<CategoryRule>): CategoryRule {
  return {
    id: nextId++,
    matchType: "contains",
    pattern: "X",
    field: "description",
    accountId: null,
    direction: null,
    amountMin: null,
    amountMax: null,
    category: null,
    billId: null,
    priority: 100,
    ...p,
  };
}

const EPAY = "CARD A EPAY 1234";

describe("rule conditions", () => {
  test("account lock only matches that account, and fails when the account is unknown", () => {
    const r = rule({ pattern: "EPAY", accountId: 7, billId: 1 });
    assert.equal(matchesRule(r, { description: EPAY, accountId: 7 }), true);
    assert.equal(matchesRule(r, { description: EPAY, accountId: 8 }), false);
    assert.equal(matchesRule(r, { description: EPAY }), false);
  });

  test("direction and amount range", () => {
    const r = rule({ pattern: "EPAY", direction: "Debit", amountMin: 100, amountMax: 200 });
    assert.equal(matchesRule(r, { description: EPAY, direction: "Debit", amount: 150 }), true);
    assert.equal(matchesRule(r, { description: EPAY, direction: "Credit", amount: 150 }), false);
    assert.equal(matchesRule(r, { description: EPAY, direction: "Debit", amount: 250 }), false);
    // Bounds are inclusive; stored amounts may be negative-signed elsewhere — compare magnitude.
    assert.equal(matchesRule(r, { description: EPAY, direction: "Debit", amount: 200 }), true);
    assert.equal(matchesRule(r, { description: EPAY, direction: "Debit", amount: -100 }), true);
    assert.equal(matchesRule(r, { description: EPAY, direction: "Debit" }), false);
  });

  test("a rule without extra conditions behaves like before", () => {
    const r = rule({ pattern: "uber", category: "Rideshare" });
    assert.equal(matchesRule(r, { description: "UBER TRIP 12" }), true);
    assert.equal(matchesRule(r, { description: "LYFT" }), false);
  });
});

describe("categorize: independent action slots", () => {
  test("a category rule and a bill rule both apply to one row", () => {
    const cat = rule({ pattern: "EPAY", category: "Transfer" });
    const bill = rule({ pattern: "EPAY", amountMin: 1000, amountMax: 1200, billId: 42 });
    const res = categorize({ description: EPAY, amount: 1100, direction: "Debit" }, [cat, bill]);
    assert.deepEqual(res, { category: "Transfer", billId: 42, matchedRuleId: cat.id, billRuleId: bill.id });
  });

  test("two bill rules on one statement line are told apart by amount", () => {
    const a = rule({ pattern: "EPAY", amountMin: 1000, amountMax: 1200, billId: 1 });
    const b = rule({ pattern: "EPAY", amountMin: 50, amountMax: 80, billId: 2 });
    assert.equal(categorize({ description: EPAY, amount: 1100 }, [a, b]).billId, 1);
    assert.equal(categorize({ description: EPAY, amount: 65 }, [a, b]).billId, 2);
    assert.equal(categorize({ description: EPAY, amount: 500 }, [a, b]).billId, null);
  });

  test("a bill-only rule leaves the category to the bank / other rules", () => {
    const bill = rule({ pattern: "NETFLIX", billId: 9 });
    const res = categorize({ description: "NETFLIX.COM", rawCategory: "Entertainment" }, [bill]);
    assert.equal(res.billId, 9);
    assert.equal(res.matchedRuleId, null);
    assert.equal(res.category, "Entertainment");
  });

  test("at equal priority the more specific rule wins", () => {
    const broad = rule({ pattern: "EPAY", billId: 1 });
    const narrow = rule({ pattern: "EPAY", accountId: 3, billId: 2 });
    assert.equal(categorize({ description: EPAY, accountId: 3 }, [broad, narrow]).billId, 2);
    assert.equal(categorize({ description: EPAY, accountId: 4 }, [broad, narrow]).billId, 1);
    // An explicit priority still beats specificity.
    const first = { ...broad, priority: 10 };
    assert.equal(categorize({ description: EPAY, accountId: 3 }, [first, narrow]).billId, 1);
  });
});

describe("rule input + helpers", () => {
  const base: RuleInput = {
    matchType: "contains",
    pattern: "  EPAY ",
    field: "description",
    accountId: null,
    direction: null,
    amountMin: null,
    amountMax: null,
    category: null,
    billId: 5,
  };

  test("cleanRuleInput trims, swaps reversed bounds, and requires an action", () => {
    const c = cleanRuleInput({ ...base, amountMin: 200, amountMax: 100 });
    assert.equal(c.pattern, "EPAY");
    assert.deepEqual([c.amountMin, c.amountMax], [100, 200]);
    assert.throws(() => cleanRuleInput({ ...base, billId: null }), /category, a bill/);
    assert.throws(() => cleanRuleInput({ ...base, pattern: " " }), /pattern/);
    assert.throws(() => cleanRuleInput({ ...base, matchType: "regex", pattern: "(" }), /regex/);
  });

  test("ruleFromRow parses decimal strings", () => {
    const r = ruleFromRow({ id: 1, matchType: "contains", pattern: "A", field: "description", amountMin: "12.50", amountMax: null, category: "", billId: null, priority: 100 });
    assert.equal(r.amountMin, 12.5);
    assert.equal(r.category, null);
  });

  test("describeRuleMatch reads in words", () => {
    const r = rule({ pattern: "EPAY", accountId: 3, direction: "Debit", amountMin: 1000, amountMax: 1000 });
    assert.equal(
      describeRuleMatch(r, { account: () => "Checking" }),
      "description contains “EPAY” · on Checking · money out · exactly $1,000",
    );
  });

  test("ruleSeedPattern stops at the first token with a digit", () => {
    assert.equal(ruleSeedPattern("NETFLIX.COM 8663 CA"), "NETFLIX.COM");
    assert.equal(ruleSeedPattern("CARD A EPAY 1234"), "CARD A EPAY");
    assert.equal(ruleSeedPattern("12345"), "12345");
  });
});

describe("import review helpers", () => {
  const row = (p: Partial<PreviewRow>): PreviewRow =>
    ({ dedupHash: "h", txnDate: "2026-01-01", description: EPAY, accountNumber: "0001", category: null, categoryRuleId: null, amount: 1100, netAmount: -1100, direction: "Debit", status: "new", raw: {}, ...p }) as PreviewRow;

  test("a bill-only rule doesn't touch on-screen categories", () => {
    const r = rule({ pattern: "EPAY", billId: 1 });
    const out = applyRuleToRows([row({})], r);
    assert.equal(out[0].category, null);
    assert.equal(countLocalMatches([row({})], r), 0);
  });

  test("amount conditions apply on screen; account-locked rules wait for analyze/commit", () => {
    const r = rule({ pattern: "EPAY", category: "Transfer", amountMin: 1000, amountMax: 1200 });
    assert.equal(applyRuleToRows([row({})], r)[0].category, "Transfer");
    assert.equal(applyRuleToRows([row({ amount: 50 })], r)[0].category, null);
    const locked = { ...r, accountId: 3 };
    assert.equal(applyRuleToRows([row({})], locked)[0].category, null);
  });
});

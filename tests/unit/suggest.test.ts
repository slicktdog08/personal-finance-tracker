import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeSuggestions,
  describeWords,
  learnPlaces,
  merchantPhrase,
  phraseFromWords,
  suggestRule,
  wordsCovered,
  type CorpusRow,
} from "@/server/lib/suggest";

describe("merchantPhrase", () => {
  const cases: [string, string][] = [
    // processor prefixes
    ["SQ *JOES GRILL 8842", "JOES GRILL"],
    ["TST* DEMO CANTINA ANYTOWN CA", "DEMO CANTINA"],
    ["TST*DEMO CANTINA - NORTH", "DEMO CANTINA"],
    ["CTLP*SAMPLE LAUNDRY", "SAMPLE LAUNDRY"],
    // a brand in front of the star is the name, not a processor
    ["UBER *TRIP HELP.UBER.COM CA", "UBER *TRIP"],
    ["AMAZON MKTPL*AB12C3 Amzn.com/bill WA", "AMAZON MKTPL"],
    // store numbers, phone numbers, reference codes
    ["KROGER #331", "KROGER"],
    ["STARBUCKS 1123", "STARBUCKS"],
    ["NETFLIX.COM 8663 CA", "NETFLIX.COM"],
    ["SAMPLE GROCER 12", "SAMPLE GROCER"],
    ["PARKING METER 0042 ANYTOWN", "PARKING METER"],
    // digits that belong to the name
    ["24 HOUR GYM #55 ANYTOWN CA", "24 HOUR GYM"],
    ["7-ELEVEN 34567 ANYTOWN CA", "7-ELEVEN"],
    // city and state
    ["STARBUCKS ANYTOWN CA", "STARBUCKS"],
    ["STARBUCKS STORE 12345 FORT SAMPLE CA", "STARBUCKS STORE"],
    ["JOES GRILL FORT SAMPLE CA", "JOES GRILL"],
    ["WAL-MART #1234 ANYTOWN CA 90001 US", "WAL-MART"],
    ["Demo Cantina, Anytown, California", "Demo Cantina"],
    ["PURCHASE AUTHORIZED ON 01/02 JOES GRILL ANYTOWN CA S123456789 CARD 1234", "JOES GRILL"],
    // bank boilerplate
    ["Debit Card Purchase - KROGER #331 ANYTOWN CA", "KROGER"],
    ["CHECKCARD 0102 STARBUCKS 1123", "STARBUCKS"],
    ["Withdrawal from CARD A EPAY", "CARD A EPAY"],
    ["Deposit from ACME CORP PAYROLL", "ACME CORP PAYROLL"],
    ["ACME CORP PAYROLL DIR DEP", "ACME CORP PAYROLL"],
    ["ACME GYM DES:MEMBERSHIP ID:123456 INDN:PAT DOE", "ACME GYM"],
    // nothing but boilerplate: the boilerplate is the name
    ["POS DEBIT", "POS DEBIT"],
    ["ATM WITHDRAWAL ANYTOWN CA", "ATM WITHDRAWAL"],
    ["ONLINE TRANSFER TO SAVINGS 2222", "ONLINE TRANSFER TO SAVINGS"],
    // no name at all
    ["12345", "12345"],
  ];
  for (const [description, want] of cases) {
    test(`${description} → ${want}`, () => assert.equal(merchantPhrase(description), want));
  }

  test("is always a verbatim slice, so the saved contains-rule matches its own source", () => {
    for (const [description] of cases) {
      assert.ok(description.includes(merchantPhrase(description)), description);
    }
  });

  test("never eats the first word of the name as a city", () => {
    assert.equal(merchantPhrase("ANYTOWN CA"), "ANYTOWN");
    assert.equal(merchantPhrase("Debit Card Purchase - CAFE CA"), "CAFE");
  });
});

describe("learnPlaces", () => {
  const ledger = ["KROGER #331 ANYTOWN CA", "TST* DEMO CANTINA ANYTOWN CA", "JOES GRILL OTHERVILLE CA"];

  test("a word before the state on two different merchants is a place", () => {
    const places = learnPlaces(ledger);
    assert.ok(places.has("ANYTOWN"));
    assert.ok(!places.has("OTHERVILLE"), "seen with one merchant only");
  });

  test("a learned place is dropped even with no state after it", () => {
    const places = learnPlaces(ledger);
    assert.equal(merchantPhrase("JOES GRILL ANYTOWN"), "JOES GRILL ANYTOWN");
    assert.equal(merchantPhrase("JOES GRILL ANYTOWN", { places }), "JOES GRILL");
    assert.equal(merchantPhrase("ANYTOWN WATER DEPT", { places }), "ANYTOWN WATER DEPT");
  });
});

describe("suggestRule", () => {
  const row = (description: string, category: string | null = null, n = 1): CorpusRow => ({ description, category, n });

  test("keeps the brand name and ignores the city every other row shares", () => {
    // The old engine picked the most common word here — the city.
    const corpus = [
      row("KROGER #331 ANYTOWN CA"),
      row("SQ *JOES GRILL ANYTOWN CA"),
      row("STARBUCKS 1123 ANYTOWN CA"),
      row("SAMPLE LAUNDRY ANYTOWN CA"),
      row("TST* DEMO CANTINA ANYTOWN CA", "Dining"),
    ];
    const s = suggestRule("TST* DEMO CANTINA ANYTOWN CA", corpus, "Dining");
    assert.equal(s.pattern, "DEMO CANTINA");
    assert.equal(s.matchCount, 0);
    assert.equal(s.conflicts, 0);
  });

  test("counts the uncategorized rows the rule would catch, weighted by n", () => {
    const corpus = [row("STARBUCKS 1123", null, 3), row("STARBUCKS 4456 ANYTOWN CA"), row("KROGER #331")];
    assert.equal(suggestRule("STARBUCKS 9999", corpus, "Coffee").matchCount, 4);
  });

  test("stays specific when the shorter phrase is split across categories", () => {
    const corpus = [row("UBER *TRIP 1234", "Rideshare", 5), row("UBER *EATS 5678", "Dining")];
    const s = suggestRule("UBER *EATS 9012", corpus, "Dining");
    assert.equal(s.pattern, "UBER *EATS");
    assert.deepEqual(
      s.alternatives.map((a) => [a.pattern, a.conflicts]),
      [["UBER", 5]],
    );
  });

  test("broadens only when the ledger already files the shorter phrase the same way", () => {
    const corpus = [row("AMAZON RETA* 12AB34", "Shopping", 2), row("AMAZON MKTPL*AB12C3", "Shopping")];
    assert.equal(suggestRule("AMAZON MKTPL*AB12C3", corpus, "Shopping").pattern, "AMAZON");
    // No such evidence: the full phrase.
    assert.equal(suggestRule("AMAZON MKTPL*AB12C3", [row("AMAZON RETA* 12AB34")], "Shopping").pattern, "AMAZON MKTPL");
  });

  test("reports rows filed elsewhere that the pattern would also match", () => {
    const corpus = [row("ACME STORE 1", "Shopping", 4), row("ACME STORE 2", "Groceries", 2)];
    assert.equal(suggestRule("ACME STORE 3", corpus, "Groceries").conflicts, 4);
  });
});

describe("computeSuggestions", () => {
  test("groups by merchant, not by the words most rows share", () => {
    const uncategorized = [
      "STARBUCKS 1123 ANYTOWN CA",
      "STARBUCKS 4456 ANYTOWN CA",
      "STARBUCKS 7789 OTHERVILLE CA",
      "KROGER #331 ANYTOWN CA",
      "KROGER #332 ANYTOWN CA",
      "SQ *JOES GRILL ANYTOWN CA",
    ];
    const categorized = [
      { description: "KROGER #331 ANYTOWN CA", category: "Groceries" },
      { description: "KROGER #400 OTHERVILLE CA", category: "Groceries" },
    ];
    const out = computeSuggestions(uncategorized, categorized);
    assert.deepEqual(
      out.map((s) => [s.pattern, s.matchCount, s.suggestedCategory]),
      [
        ["STARBUCKS", 3, null],
        ["KROGER", 2, "Groceries"],
      ],
    );
    assert.ok(!out.some((s) => /ANYTOWN|\bCA\b/.test(s.pattern)));
  });
});

describe("rule editor word chips", () => {
  const d = "TST* DEMO CANTINA #12 ANYTOWN CA";
  const words = describeWords(d);

  test("classifies each word and marks the merchant ones", () => {
    assert.deepEqual(
      words.map((w) => [w.text, w.kind, w.merchant]),
      [
        ["TST", "filler", false],
        ["DEMO", "name", true],
        ["CANTINA", "name", true],
        ["#12", "code", false],
        ["ANYTOWN", "place", false],
        ["CA", "place", false],
      ],
    );
  });

  test("a pattern maps to the words it covers and back", () => {
    assert.deepEqual(wordsCovered(d, words, "demo cantina"), [1, 2]);
    assert.equal(wordsCovered(d, words, "NOT THERE"), null);
    assert.equal(phraseFromWords(d, words, 1, 2), "DEMO CANTINA");
    assert.equal(phraseFromWords(d, words, 2, 1), "DEMO CANTINA");
    assert.equal(phraseFromWords(d, words, 1, 3), "DEMO CANTINA #12");
  });
});

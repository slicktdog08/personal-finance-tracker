import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chaseCardParser } from "@/server/lib/pdf/parsers/chase-card";
import { detectAndParse } from "@/server/lib/pdf/registry";
import type { ParserResult } from "@/server/lib/pdf/types";

// Lines as lines.ts rebuilds them from a Chase credit card statement (headings come out doubled).
// Illustrative values only: 1,000.00 − 300.00 + 170.00 + 0.54 + 13.50 = 884.04.
const PAGE_TOP = [
  "Manage Manage your your account account online online at at : : Customer Service: Mobile: Mobile: Download Download the the",
  "www.chase.com/cardhelp 1-800-555-0100 Chase Chase Mobile Mobile ® ® app app today today",
];
const footer = (page: number) => [
  `PAT EXAMPLE Page ${page} of 3 Statement Date: 01/27/26`,
  `0000001 ABC12345 C 1 Y 9 27 26/01/27 Page ${page} of 3 00000 MA DA 00000 00000000000000000001`,
];
const COLUMNS = ["Date of", "Transaction Merchant Name or Transaction Description $ Amount"];
const STATEMENT = [
  ...PAGE_TOP,
  "New Balance",
  "$884.04",
  "Minimum Payment Due",
  "$25.00",
  "ACCOUNT ACCOUNT SUMMARY SUMMARY",
  "Account Number: XXXX XXXX XXXX 1234",
  "Previous Balance $1,000.00",
  "Payment, Credits -$300.00",
  "Purchases +$170.00",
  "Cash Advances $0.00",
  "Balance Transfers $0.00",
  "Fees Charged +$0.54",
  "Interest Charged +$13.50",
  "New Balance $884.04",
  "Opening/Closing Date 12/28/25 - 01/27/26",
  "Revolving Credit Amount $2,000",
  "Available Credit $1,115",
  "Cash Access Line $250",
  "Past Due Amount $0.00",
  "Balance over the Credit Access Line $0.00",
  ...footer(1),
  "Payment Due Date: 02/21/26",
  "chase.com/paycard New Balance: $884.04",
  "Account number: XXXX XXXX XXXX 1234",
  "PAT EXAMPLE",
  "EXAMPLE COMPANY LLC",
  "123 EXAMPLE ST",
  "ANYTOWN CA 00000-0000",
  ...PAGE_TOP,
  "ACCOUNT ACCOUNT ACTIVITY ACTIVITY",
  ...COLUMNS,
  "01/18 Payment Thank You - Web -300.00",
  "12/29 COFFEE SHOP ANYTOWN CA 4.50",
  "01/20 FOREIGN MERCHANT SOMECITY 18.00",
  "01/21 EURO",
  "16.20 X 1.111111111 (EXCHG RATE)",
  "01/21 FOREIGN TRANSACTION FEE .54",
  ...footer(2),
  "ACCOUNT ACTIVITY (CONTINUED)",
  ...COLUMNS,
  "01/22 ACME STORE 800-555-0100 CA 147.50",
  "01/27 PURCHASE INTEREST CHARGE 13.50",
  "PAT EXAMPLE",
  "TRANSACTIONS THIS CYCLE (CARD 1234) $115.96-",
  "INCLUDING PAYMENTS RECEIVED",
  "2026 Totals Year-to-Date",
  "Total fees charged in 2026 $0.54",
  "Total interest charged in 2026 $13.50",
  "INTEREST INTEREST CHARGES CHARGES",
  "Purchases 20.00%(v)(d) $800.00 $13.50",
  "01/27 NOT A ROW AFTER THE ACTIVITY 1.00",
  "31 Days in Billing Period",
  ...footer(3),
];
const parse = (lines: string[]) => chaseCardParser.parse(lines, lines.join("\n")) as ParserResult;
const rows = (r: ParserResult) => r.txns.map((t) => [t.dateIso, t.direction, t.amount, t.description]);
const EXPECTED = [
  ["2026-01-18", "Credit", 300, "Payment Thank You - Web"],
  ["2025-12-29", "Debit", 4.5, "COFFEE SHOP ANYTOWN CA"], // December row in a Dec → Jan cycle
  ["2026-01-20", "Debit", 18, "FOREIGN MERCHANT SOMECITY"],
  ["2026-01-21", "Debit", 0.54, "FOREIGN TRANSACTION FEE"], // cents-only amount
  ["2026-01-22", "Debit", 147.5, "ACME STORE 800-555-0100 CA"], // after a page break
  ["2026-01-27", "Debit", 13.5, "PURCHASE INTEREST CHARGE"],
];

describe("Chase credit card statement parser", () => {
  test("detected through the registry as one account", () => {
    const d = detectAndParse(STATEMENT, STATEMENT.join("\n"));
    assert.equal(d.parser?.id, "chase-card");
    assert.equal(d.results.length, 1);
  });

  const r = parse(STATEMENT);

  test("account, period, balances owed and credit limit", () => {
    assert.equal(r.meta.accountNumber, "1234");
    assert.equal(r.meta.institution, "Chase");
    assert.equal(r.meta.accountType, "Credit");
    assert.equal(r.meta.periodStart, "2025-12-28");
    assert.equal(r.meta.periodEnd, "2026-01-27");
    assert.equal(r.meta.openingBalance, 1000);
    assert.equal(r.meta.closingBalance, 884.04);
    assert.equal(r.meta.creditLimit, 2000); // not the "Balance over the Credit Access Line" figure
  });

  test("a minus is a credit, everything else a debit; rows stop at the year-to-date totals", () => {
    assert.deepEqual(rows(r), EXPECTED);
    assert.deepEqual(r.notes, []);
  });

  test("foreign-currency details and the card are kept on the row", () => {
    const foreign = r.txns[2];
    assert.equal(foreign.raw.foreignCurrency, "EURO");
    assert.equal(foreign.raw.foreignAmount, "16.20");
    assert.equal(foreign.raw.exchangeRate, "1.111111111");
    assert.equal(r.txns[1].raw.foreignCurrency, undefined);
    assert.ok(r.txns.every((t) => t.raw.card === "1234" && t.raw.account === "1234"));
    assert.equal(r.txns[5].raw.section, "interest");
  });

  test("reconciles as a balance owed: previous + charges − payments == new", () => {
    assert.equal(r.reconciled, true);
  });

  test("a dropped row fails reconciliation and is reported against the summary and the card total", () => {
    const broken = parse(STATEMENT.filter((l) => !l.startsWith("01/22 ")));
    assert.equal(broken.reconciled, false);
    assert.ok(broken.notes.some((n) => /Purchase and fee rows add up to 23\.04 but the statement shows 170\.54/.test(n)), broken.notes.join("\n"));
    assert.ok(broken.notes.some((n) => /Card 1234 rows add up to -263\.46 but the statement shows -115\.96/.test(n)), broken.notes.join("\n"));
  });

  test("a personal card's section headings and credit line wording parse the same", () => {
    const lines = STATEMENT.flatMap((l) => {
      if (l === "Revolving Credit Amount $2,000") return ["Credit Access Line $2,000"];
      if (l.startsWith("01/18 ")) return ["PAYMENTS AND OTHER CREDITS", l, "PURCHASE"];
      if (l.startsWith("01/21 FOREIGN TRANSACTION FEE")) return ["FEES CHARGED", l, "TOTAL FEES FOR THIS PERIOD $0.54"];
      if (l.startsWith("01/27 PURCHASE INTEREST")) return ["INTEREST CHARGED", l, "TOTAL INTEREST FOR THIS PERIOD $13.50"];
      return [l];
    });
    const p = parse(lines);
    assert.deepEqual(rows(p), EXPECTED);
    assert.equal(p.meta.creditLimit, 2000);
    assert.equal(p.reconciled, true);
    assert.deepEqual(p.notes, []);
  });

  test("a business account with two cards tags each row with its card", () => {
    const lines = STATEMENT.flatMap((l) => {
      if (l.startsWith("01/22 ")) return ["PAT EXAMPLE", "TRANSACTIONS THIS CYCLE (CARD 1234) $276.96-", "INCLUDING PAYMENTS RECEIVED", l];
      if (l.startsWith("TRANSACTIONS THIS CYCLE")) return ["TRANSACTIONS THIS CYCLE (CARD 5678) $161.00"];
      if (l === "PAT EXAMPLE") return ["SAM SAMPLE"];
      return [l];
    });
    const m = parse(lines);
    assert.deepEqual(m.txns.map((t) => t.raw.card), ["1234", "1234", "1234", "1234", "5678", "5678"]);
    assert.equal(m.meta.accountNumber, "1234");
    assert.equal(m.reconciled, true);
    assert.deepEqual(m.notes, []);
  });

  test("a cycle inside one year keeps every row in that year", () => {
    const y = parse(STATEMENT.map((l) => l.replace("12/28/25 - 01/27/26", "01/28/26 - 02/27/26").replace(/^12\/29 /, "01/29 ")));
    assert.equal(y.meta.periodStart, "2026-01-28");
    assert.equal(y.txns[1].dateIso, "2026-01-29");
    assert.equal(y.txns[0].dateIso, "2026-01-18");
  });

  test("an unexpected line inside the activity is surfaced, not dropped silently", () => {
    const i = STATEMENT.indexOf("12/29 COFFEE SHOP ANYTOWN CA 4.50");
    const lines = [...STATEMENT.slice(0, i), "Something new", ...STATEMENT.slice(i)];
    assert.deepEqual(parse(lines).notes, ["Unparsed line: Something new"]);
  });

  // Things seen on personal-card statements.
  test("a stray backtick in the summary does not hide a figure", () => {
    const lines = STATEMENT.flatMap((l) => {
      if (l === "Fees Charged +$0.54") return ["Fees Charged ` +$0.54"];
      if (l === "Revolving Credit Amount $2,000") return ["Credit Access Line ` $2,000", "`"];
      return [l];
    });
    const p = parse(lines);
    assert.equal(p.meta.creditLimit, 2000);
    assert.equal(p.reconciled, true);
    assert.deepEqual(p.notes, []); // a missing fee figure would report the purchase rows as 0.54 over
  });

  test("an airline ticket's legs stay on the row instead of becoming notes", () => {
    const lines = STATEMENT.flatMap((l) => (l.startsWith("12/29 ") ? [l, "031526 1 S AAA BBB", "2 T BBB AAA"] : [l]));
    const p = parse(lines);
    assert.deepEqual(rows(p), EXPECTED);
    assert.equal(p.txns[1].raw.travel, "031526 1 S AAA BBB; 2 T BBB AAA");
    assert.deepEqual(p.notes, []);
  });

  test("a foreign refund whose currency line is a bare date keeps its rate", () => {
    const lines = STATEMENT.flatMap((l) => (l === "01/21 EURO" ? ["01/21"] : [l]));
    const p = parse(lines);
    assert.deepEqual(rows(p), EXPECTED);
    assert.equal(p.txns[2].raw.foreignCurrency, undefined);
    assert.equal(p.txns[2].raw.exchangeRate, "1.111111111");
    assert.deepEqual(p.notes, []);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { capitalOneParser } from "@/server/lib/pdf/parsers/capitalone";
import { detectAndParse } from "@/server/lib/pdf/registry";
import type { ParserResult } from "@/server/lib/pdf/types";

// Lines as lines.ts rebuilds them from a Capital One 360 statement. Illustrative values only.
const FOOTER = ["Page 1 of 4", "capitalone.com 1-800-555-0100 P.O. Box 1, Anytown, CA 00000"];
const PAGE_HEAD = ["Pat Example STATEMENT PERIOD", "Oct 1 - Oct 31, 2026"];
const STATEMENT = [
  "Pat Example",
  "123 Example St",
  "STATEMENT PERIOD",
  "Here's your October 2026 bank statement. Oct 1 - Oct 31, 2026",
  "Account Summary Cashflow Summary",
  "Everyday $500.00 $2,470.50 $0.00 ITEM FEES THIS PERIOD",
  "Rainy Day $100.00 $100.00",
  ...FOOTER,
  ...PAGE_HEAD,
  "Everyday - 11112222333",
  "360 CHECKING",
  "0.10% $1.00 31",
  "ANNUAL PERCENTAGE YIELD YTD INTEREST AND BONUSES DAYS IN STATEMENT",
  "(APY) EARNED CYCLE",
  "DATE DESCRIPTION CATEGORY AMOUNT BALANCE",
  "Oct 1 Opening Balance $500.00",
  "Oct 2 Deposit from ACME CORP PAYROLL Credit + $2,000.00 $2,500.00",
  "Oct 3 Withdrawal from CARD A PAYMENT Debit - $25.00 $2,475.00",
  "Debit Card Purchase - LONG MERCHANT NAME ANYTOWN",
  "Oct 4 Debit - $20.00 $2,455.00",
  "CA",
  "ATM Withdrawal - SOME BANK X123 SPRINGFIELD",
  "Oct 4 Debit - $5.00 $2,450.00",
  "IL",
  ...FOOTER,
  ...PAGE_HEAD,
  "DATE DESCRIPTION CATEGORY AMOUNT BALANCE",
  "Instant transfer received from Brokerage -",
  "Oct 20 Credit + $20.37 $2,470.37",
  "REF123ABC",
  "Oct 31 Monthly Interest Paid Credit + $0.13 $2,470.50",
  "Oct 31 Closing Balance $2,470.50",
  ...FOOTER,
  ...PAGE_HEAD,
  "Fees Summary",
  "Total Overdraft Fees $0.00 $0.00",
  "Rainy Day - 11114444555",
  "360 SAVINGS",
  "1.00% $2.00 31",
  "ANNUAL PERCENTAGE YIELD YTD INTEREST AND BONUSES DAYS IN STATEMENT",
  "(APY) EARNED CYCLE",
  "DATE DESCRIPTION CATEGORY AMOUNT BALANCE",
  "Oct 1 Opening Balance $100.00",
  "Oct 31 Closing Balance $100.00",
  ...FOOTER,
];
const text = STATEMENT.join("\n");
const parse = (lines: string[]) => capitalOneParser.parse(lines, lines.join("\n")) as ParserResult[];

describe("Capital One 360 statement parser", () => {
  test("detected through the registry, one result per account", () => {
    const d = detectAndParse(STATEMENT, text);
    assert.equal(d.parser?.id, "capitalone-360");
    assert.equal(d.results.length, 2);
  });

  const [checking, savings] = parse(STATEMENT);

  test("account headers", () => {
    assert.equal(checking.meta.accountNumber, "2333");
    assert.equal(checking.meta.accountLabel, "Everyday");
    assert.equal(checking.meta.accountType, "Checking");
    assert.equal(checking.meta.institution, "Capital One");
    assert.equal(savings.meta.accountNumber, "4555");
    assert.equal(savings.meta.accountType, "Savings");
  });

  test("period and balances per account", () => {
    assert.equal(checking.meta.periodStart, "2026-10-01");
    assert.equal(checking.meta.periodEnd, "2026-10-31");
    assert.equal(checking.meta.openingBalance, 500);
    assert.equal(checking.meta.closingBalance, 2470.5);
    assert.equal(savings.meta.openingBalance, 100);
    assert.equal(savings.meta.closingBalance, 100);
    assert.equal(savings.txns.length, 0);
  });

  test("transactions, wrapped descriptions rejoined across page breaks", () => {
    assert.deepEqual(
      checking.txns.map((t) => [t.dateIso, t.direction, t.amount, t.description]),
      [
        ["2026-10-02", "Credit", 2000, "Deposit from ACME CORP PAYROLL"],
        ["2026-10-03", "Debit", 25, "Withdrawal from CARD A PAYMENT"],
        ["2026-10-04", "Debit", 20, "Debit Card Purchase - LONG MERCHANT NAME ANYTOWN CA"],
        ["2026-10-04", "Debit", 5, "ATM Withdrawal - SOME BANK X123 SPRINGFIELD IL"],
        ["2026-10-20", "Credit", 20.37, "Instant transfer received from Brokerage - REF123ABC"],
        ["2026-10-31", "Credit", 0.13, "Monthly Interest Paid"],
      ],
    );
    assert.deepEqual(checking.notes, []);
  });

  test("a row that breaks the running balance is reported", () => {
    const broken = STATEMENT.map((l) => (l.startsWith("Oct 3 Withdrawal") ? "Oct 3 Withdrawal from CARD A PAYMENT Debit - $30.00 $2,475.00" : l));
    const [c] = parse(broken);
    assert.ok(c.notes.some((n) => /Running balance off on Oct 3/.test(n)), c.notes.join("\n"));
  });

  test("a statement spanning a year end dates December rows in the prior year", () => {
    const lines = STATEMENT.map((l) =>
      l.replace("Oct 1 - Oct 31, 2026", "Dec 15, 2026 - Jan 14, 2027")
        .replace(/^Oct 2 /, "Dec 20 ")
        .replace(/^Oct 31 Monthly/, "Jan 10 Monthly"),
    );
    const [c] = parse(lines);
    assert.equal(c.meta.periodStart, "2026-12-15");
    assert.equal(c.meta.periodEnd, "2027-01-14");
    assert.equal(c.txns[0].dateIso, "2026-12-20");
    assert.equal(c.txns[c.txns.length - 1].dateIso, "2027-01-10");
  });
});

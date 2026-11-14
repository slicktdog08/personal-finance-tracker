import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { capitalOneCardParser } from "@/server/lib/pdf/parsers/capitalone-card";
import { detectAndParse } from "@/server/lib/pdf/registry";
import type { ParserResult } from "@/server/lib/pdf/types";

// Lines as lines.ts rebuilds them from a Capital One credit card statement. Illustrative
// values only: 1,000.00 − 300.00 − 5.00 + 170.00 + 13.50 = 878.50.
const head = (page: number) => [
  `Page ${page} of 4`,
  "Example Rewards Card | Visa Signature ending in 1234",
  "Dec 25, 2025 - Jan 24, 2026 | 31 days in Billing Cycle",
];
const STATEMENT = [
  ...head(1),
  "Payment Information Account Summary",
  "Payment Due Date For online and phone payments, the Previous Balance $1,000.00",
  "deadline is 8pm ET.",
  "Feb 18, 2026 Payments - $300.00",
  "New Balance Minimum Payment Due Other Credits - $5.00",
  "$878.50 $25.00 Transactions + $170.00",
  "LATE PAYMENT WARNING: If we do not receive your minimum payment Cash Advances + $0.00",
  "by your due date, you may have to pay a late fee of up to $40.00.",
  "Fees Charged + $0.00",
  "payment each period, you will pay more in interest and it will take you Interest Charged + $13.50",
  "New Balance = $878.50",
  "Credit Limit $2,000.00",
  "Available Credit (as of Jan 24, 2026) $1,121.50",
  "Cash Advance Credit Limit $500.00",
  "Rewards Balance Track and redeem your rewards with our",
  "Previous Balance Earned This Period Redeemed this period",
  "$1.00 $2.00 $0.00",
  "Pay or manage your account at capitalone.com Customer Service: 800-555-0100",
  "PAT EXAMPLE",
  "123 Example St",
  "ANYTOWN, CA 00000",
  "How is the Interest Charge Determined? Interest Charges accrue from the date of the",
  ...head(2),
  "Transactions",
  "Visit capitalone.com to see detailed transactions.",
  "PAT EXAMPLE #1234: Payments, Credits and Adjustments",
  "Trans Date Post Date Description Amount",
  "Jan 18 Jan 18 CAPITAL ONE MOBILE PYMTAuthDate 17-Jan - $300.00",
  "Jan 19 Jan 21 FOREIGN MERCHANTSOMECITY - $5.00",
  "$4.50",
  "EUR",
  "0.900000000 Exchange Rate",
  "PAT EXAMPLE #1234: Transactions",
  "Trans Date Post Date Description Amount",
  "Dec 23 Dec 26 COFFEE SHOPANYTOWNCA $4.50",
  "Jan 18 Jan 20 FOREIGN MERCHANTSOMECITY $20.00",
  "$18.00",
  "EUR",
  "0.900000000 Exchange Rate",
  "Additional Information on the next page",
  ...head(3),
  "Transactions (Continued)",
  "Trans Date Post Date Description Amount",
  "Jan 22 Jan 24 ACME STORE 100800-555-0100CA $145.50",
  "PAT EXAMPLE #1234: Total Transactions $170.00",
  "Total Transactions for This Period $170.00",
  "Fees",
  "Trans Date Post Date Description Amount",
  "Total Fees for This Period $0.00",
  "Interest Charged",
  "Interest Charge on Purchases $13.50",
  "Interest Charge on Cash Advances $0.00",
  "Interest Charge on Other Balances $0.00",
  "Total Interest for This Period $13.50",
  "Totals Year-to-Date",
  "Total Fees charged $0.00",
  "Total Interest charged $13.50",
  "Additional Information on the next page",
  ...head(4),
  "Interest Charge Calculation",
  "Type of Balance Annual Percentage Rate (APR) Balance Subject to Interest Rate Interest Charged",
  "Purchases 20.00% P $800.00 $13.50",
];
const parse = (lines: string[]) => capitalOneCardParser.parse(lines, lines.join("\n")) as ParserResult;
const swap = (from: string, to: string) => STATEMENT.map((l) => (l === from ? to : l));

describe("Capital One credit card statement parser", () => {
  test("detected through the registry as one account", () => {
    const d = detectAndParse(STATEMENT, STATEMENT.join("\n"));
    assert.equal(d.parser?.id, "capitalone-card");
    assert.equal(d.results.length, 1);
  });

  const r = parse(STATEMENT);

  test("header, period, balances owed and credit limit", () => {
    assert.equal(r.meta.accountNumber, "1234");
    assert.equal(r.meta.accountLabel, "Example Rewards Card");
    assert.equal(r.meta.institution, "Capital One");
    assert.equal(r.meta.accountType, "Credit");
    assert.equal(r.meta.periodStart, "2025-12-25");
    assert.equal(r.meta.periodEnd, "2026-01-24");
    assert.equal(r.meta.openingBalance, 1000);
    assert.equal(r.meta.closingBalance, 878.5);
    assert.equal(r.meta.creditLimit, 2000); // not the cash-advance limit
  });

  test("payments are credits, purchases debits, interest posts at the cycle's end", () => {
    assert.deepEqual(
      r.txns.map((t) => [t.dateIso, t.direction, t.amount, t.description]),
      [
        ["2026-01-18", "Credit", 300, "CAPITAL ONE MOBILE PYMT"],
        ["2026-01-19", "Credit", 5, "FOREIGN MERCHANTSOMECITY"],
        ["2025-12-23", "Debit", 4.5, "COFFEE SHOPANYTOWNCA"], // before the period, prior year
        ["2026-01-18", "Debit", 20, "FOREIGN MERCHANTSOMECITY"],
        ["2026-01-22", "Debit", 145.5, "ACME STORE 100800-555-0100CA"], // after a page break
        ["2026-01-24", "Debit", 13.5, "Interest Charge on Purchases"],
      ],
    );
    assert.deepEqual(r.notes, []);
  });

  test("post date, auth date, card and foreign-currency details are kept on the row", () => {
    const [payment, refund, , foreign] = r.txns;
    assert.equal(payment.raw.authDate, "17-Jan");
    assert.equal(payment.raw.postDate, "2026-01-18");
    assert.equal(payment.raw.card, "1234");
    assert.equal(refund.raw.foreignAmount, "$4.50");
    assert.equal(foreign.raw.postDate, "2026-01-20");
    assert.equal(foreign.raw.foreignAmount, "$18.00");
    assert.equal(foreign.raw.foreignCurrency, "EUR");
    assert.equal(foreign.raw.exchangeRate, "0.900000000");
    assert.equal(r.txns[2].raw.foreignAmount, undefined);
  });

  test("reconciles as a balance owed: previous + charges − payments == new", () => {
    assert.equal(r.reconciled, true);
  });

  test("a dropped row fails reconciliation and is reported against the summary", () => {
    const broken = parse(STATEMENT.filter((l) => !l.startsWith("Jan 22 ")));
    assert.equal(broken.reconciled, false);
    assert.ok(broken.notes.some((n) => /Transaction rows add up to 24\.50 but the statement shows 170\.00/.test(n)), broken.notes.join("\n"));
  });

  test("fees are imported as debits", () => {
    const lines = swap("Total Fees for This Period $0.00", "Jan 20 Jan 20 PAST DUE FEE $25.00")
      .map((l) => l.replace("Fees Charged + $0.00", "Fees Charged + $25.00").replace("New Balance = $878.50", "New Balance = $903.50"));
    const f = parse(lines);
    const fee = f.txns.find((t) => t.description === "PAST DUE FEE");
    assert.deepEqual([fee?.dateIso, fee?.direction, fee?.amount, fee?.raw.section], ["2026-01-20", "Debit", 25, "fees"]);
    assert.equal(f.reconciled, true);
    assert.deepEqual(f.notes, []);
  });

  test("a cycle inside one year keeps every row in that year", () => {
    const lines = STATEMENT.map((l) =>
      l.replace("Dec 25, 2025 - Jan 24, 2026", "Jan 25, 2026 - Feb 24, 2026").replace(/^Dec 23 Dec 26 /, "Jan 24 Jan 27 "),
    );
    const y = parse(lines);
    assert.equal(y.meta.periodEnd, "2026-02-24");
    assert.equal(y.txns[2].dateIso, "2026-01-24");
    assert.equal(y.txns[y.txns.length - 1].dateIso, "2026-02-24");
  });

  test("an unexpected line inside a table is surfaced, not dropped silently", () => {
    const i = STATEMENT.indexOf("Dec 23 Dec 26 COFFEE SHOPANYTOWNCA $4.50");
    const lines = [...STATEMENT.slice(0, i), "Something new", ...STATEMENT.slice(i)];
    assert.deepEqual(parse(lines).notes, ["Unparsed line: Something new"]);
  });
});

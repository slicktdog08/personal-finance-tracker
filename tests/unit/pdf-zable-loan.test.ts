import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { zableLoanParser } from "@/server/lib/pdf/parsers/zable-loan";
import { detectAndParse } from "@/server/lib/pdf/registry";
import { statementPoints } from "@/server/lib/pdf/balances";
import type { ParserResult } from "@/server/lib/pdf/types";

// Lines as lines.ts rebuilds them from a Zable loan statement. Illustrative values only.
const footer = (page: number) => `Zable, 123 Example St Suite 100, Anytown, CA 00000 ${page} of 2`;
const STATEMENT = [
  "Dec 7, 2025",
  "Pat Example",
  "123 Example St",
  "Anytown, CA, 00000",
  "Loan Periodic Statement",
  "Loan ID: LN-AB12-CD34",
  "Period: Nov 8, 2025 to Dec 7, 2025",
  "Statement date: Dec 7, 2025",
  "Account Information Amount Due Details",
  "Outstanding balance $4,050.00 Due date Dec 8, 2025",
  "(as of Dec 7, 2025)",
  "Recurring amount $250.00",
  "Outstanding principal balance $4,000.00",
  "Fees amount $0.00",
  "(as of Dec 7, 2025)",
  "Prepaid amount $0.00",
  "APR 20.00%",
  "Total amount due $250.00",
  "Past Payments Breakdown 2025 Totals Year to Date",
  "Description Paid Last Period Paid Year to Date Total fees charged in 2025 $0.00",
  "Principal $170.00 $1,900.00 Total interest charged in 2025 $900.00",
  "Interest $80.00 $850.00",
  "Fees $0.00 $0.00",
  "Unassigned $0.00 $0.00",
  "Total $250.00 $2,750.00",
  "Late Payment Warning: If we do not receive your payment by the due date listed above, a late fee may be charged.",
  footer(1),
  "Account Activities",
  "Activity Date Description Amount",
  "Nov 8, 2025 Payment - Bank Account *1234 -$250.00",
  "Fees",
  "Description Amount",
  "TOTAL FEES FOR THIS PERIOD $0.00",
  "Interest Charged",
  "Description Amount",
  "TOTAL INTEREST FOR THIS PERIOD $65.00",
  "Questions?",
  "Email Customer Care",
  "customer@support.zable.com",
  "Call Customer Care +1(800)555-0100",
  "loan-account.zable.com",
  footer(2),
];
const parse = (lines: string[]) => zableLoanParser.parse(lines, lines.join("\n")) as ParserResult;
const rows = (r: ParserResult) => r.txns.map((t) => [t.dateIso, t.direction, t.amount, t.description]);
const swap = (from: string, to: string[]) => STATEMENT.flatMap((l) => (l === from ? to : [l]));
const PAYMENT = "Nov 8, 2025 Payment - Bank Account *1234 -$250.00";

describe("Zable loan statement parser", () => {
  test("detected through the registry as one account", () => {
    const d = detectAndParse(STATEMENT, STATEMENT.join("\n"));
    assert.equal(d.parser?.id, "zable-loan");
    assert.equal(d.results.length, 1);
  });

  const r = parse(STATEMENT);

  test("account, period and the balance owed", () => {
    assert.equal(r.meta.accountNumber, "CD34");
    assert.equal(r.meta.institution, "Zable");
    assert.equal(r.meta.accountType, "Loan");
    assert.equal(r.meta.periodStart, "2025-11-08");
    assert.equal(r.meta.periodEnd, "2025-12-07");
    assert.equal(r.meta.closingBalance, 4050); // the outstanding balance, not the principal
    assert.equal(r.meta.openingBalance, null); // the statement prints none
    assert.equal(r.reconciled, null);
  });

  test("principal, APR and the monthly payment ride along with the balance", () => {
    assert.equal(r.meta.balanceDetail, "principal $4,000.00");
    assert.equal(r.meta.apr, 20);
    assert.equal(r.meta.minPayment, 250); // "Recurring amount", not "Total amount due"
  });

  test("the payment is a credit; the period's interest is one debit at the period end", () => {
    assert.deepEqual(rows(r), [
      ["2025-11-08", "Credit", 250, "Payment - Bank Account *1234"],
      ["2025-12-07", "Debit", 65, "Interest charged"],
    ]);
    assert.equal(r.txns[1].raw.section, "interest");
    assert.deepEqual(r.notes, []);
  });

  test("a statement with no activity still yields its balance and interest", () => {
    const p = parse(STATEMENT.filter((l) => l !== PAYMENT));
    assert.deepEqual(rows(p), [["2025-12-07", "Debit", 65, "Interest charged"]]);
    assert.equal(p.meta.closingBalance, 4050);
    assert.deepEqual(p.notes, []);
  });

  test("a payment still processing imports under the settled wording", () => {
    const p = parse(swap(PAYMENT, ["Dec 5, 2025 Payment processing - Bank Account *1234 -$250.00"]));
    assert.deepEqual(rows(p)[0], ["2025-12-05", "Credit", 250, "Payment - Bank Account *1234"]);
    assert.equal(p.txns[0].raw.status, "processing");
    assert.equal(r.txns[0].raw.status, undefined);
  });

  test("several payments in one period, across a year end", () => {
    const lines = swap(PAYMENT, ["Dec 20, 2025 Payment - Bank Account *1234 -$250.00", "Jan 2, 2026 Payment - Bank Account *1234 -$1,250.00"]).map((l) =>
      l.replace("Period: Nov 8, 2025 to Dec 7, 2025", "Period: Dec 8, 2025 to Jan 7, 2026"),
    );
    const p = parse(lines);
    assert.deepEqual(rows(p).slice(0, 2), [
      ["2025-12-20", "Credit", 250, "Payment - Bank Account *1234"],
      ["2026-01-02", "Credit", 1250, "Payment - Bank Account *1234"],
    ]);
    assert.equal(p.txns[2].dateIso, "2026-01-07");
  });

  test("a fee total with no rows becomes one debit; a dated fee row is not counted twice", () => {
    const lump = parse(swap("TOTAL FEES FOR THIS PERIOD $0.00", ["TOTAL FEES FOR THIS PERIOD $15.00"]));
    assert.deepEqual(rows(lump)[1], ["2025-12-07", "Debit", 15, "Fees charged"]);

    const dated = parse(swap("TOTAL FEES FOR THIS PERIOD $0.00", ["Nov 20, 2025 Late fee $15.00", "TOTAL FEES FOR THIS PERIOD $15.00"]));
    assert.deepEqual(rows(dated), [
      ["2025-11-08", "Credit", 250, "Payment - Bank Account *1234"],
      ["2025-11-20", "Debit", 15, "Late fee"],
      ["2025-12-07", "Debit", 65, "Interest charged"],
    ]);
    assert.deepEqual(dated.notes, []);
  });

  test("zero interest adds no row", () => {
    const p = parse(swap("TOTAL INTEREST FOR THIS PERIOD $65.00", ["TOTAL INTEREST FOR THIS PERIOD $0.00"]));
    assert.deepEqual(rows(p), [["2025-11-08", "Credit", 250, "Payment - Bank Account *1234"]]);
  });

  test("an unexpected line inside the activity is surfaced, not dropped silently", () => {
    assert.deepEqual(parse(swap(PAYMENT, [PAYMENT, "Something new"])).notes, ["Unparsed line: Something new"]);
  });

  test("a missing balance is reported rather than guessed from the principal", () => {
    const p = parse(STATEMENT.filter((l) => !l.startsWith("Outstanding balance ")));
    assert.equal(p.meta.closingBalance, null);
    assert.ok(p.notes.includes("Could not find the outstanding balance."));
  });

  test("APR and payment carry onto the balance point that gets written", () => {
    const [pt] = statementPoints(
      [{ kind: "closing", balance: 4050, asOf: "2025-12-07", creditLimit: null, apr: 20, minPayment: 250, note: "n" }],
      [],
      "daily",
    );
    assert.equal(pt.apr, 20);
    assert.equal(pt.minPayment, 250);
  });
});

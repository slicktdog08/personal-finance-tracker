import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { edfinancialLoanParser } from "@/server/lib/pdf/parsers/edfinancial-loan";
import { detectAndParse } from "@/server/lib/pdf/registry";
import type { ParserResult } from "@/server/lib/pdf/types";

// Lines as lines.ts rebuilds them from an Edfinancial student-loan statement: one servicer
// account holding two loans. Illustrative values only.
const STATEMENT = [
  "Edfinancial Services | P.O. Box 00000 Anytown , CA 00000-0000",
  "November 8, 2026",
  "PAT EXAMPLE",
  "123 EXAMPLE ST",
  "ACCOUNT: 0000012345 - 1",
  "Your Student Loan Account Details for Questions About Your Statement?",
  "This Month’s Billing Cycle: 10/08/26 to 11/08/26 Phone: 1-800-555-0100",
  "Account 0000012345-1",
  "Statement Date 11/08/26 With your online account you have 24/7 access to:",
  "Unpaid Principal $5,000.00",
  "Last Payment Received $60.00",
  "Regular Monthly Payment Amount $60.00 · Make a payment",
  "Current Amount Due $0.00",
  "Next Amount Due $60.00",
  "Loan ID 1-01 1-02 Total",
  "Current Balance $ 2,001.00 $ 3,002.00 $5,003.00",
  "Unpaid Interest * $ 1.00 $ 2.00 $3.00",
  "Unpaid Principal $ 2,000.00 $ 3,000.00 $5,000.00",
  "Original Principal $ 2,500.00 $ 3,500.00 $6,000.00",
  "Capitalized",
  "$ 50.00 $ 70.00 120.00",
  "Interest",
  "Principal",
  "-550.00 -570.00 -1,120.00",
  "Reduction",
  "Total Interest Paid $ 100.00 $ 150.00 $250.00",
  "Payments",
  "$ 25.00 $ 35.00 $60.00",
  "Received",
  "Last Payment Date 11/05/26 11/05/26",
  "Applied to Interest $ 6.00 $ 9.00 $15.00",
  "Applied to",
  "$ 19.00 $ 26.00 $45.00",
  "Principal",
  "Loan Date 01/15/18 01/15/18",
  "Loan Program DLSUB DLUNSUB",
  "Interest Rate 3.500 4.500",
  "Interest Type1 F F",
  "Monthly Payment",
  "$ 25.00 $ 35.00 $60.00",
  "Amount",
  "1 F = Fixed, V = Variable",
  "PAYMENT ALLOCATION. Unless you direct payments to an individual",
];
const parse = (lines: string[]) => edfinancialLoanParser.parse(lines, lines.join("\n")) as ParserResult;
const rows = (r: ParserResult) => r.txns.map((t) => [t.dateIso, t.direction, t.amount, t.description]);
const swap = (from: string, to: string[]) => STATEMENT.flatMap((l) => (l === from ? to : [l]));

describe("Edfinancial student loan statement parser", () => {
  test("detected through the registry as one account", () => {
    const d = detectAndParse(STATEMENT, STATEMENT.join("\n"));
    assert.equal(d.parser?.id, "edfinancial-loan");
    assert.equal(d.results.length, 1);
  });

  const r = parse(STATEMENT);

  test("the loans roll up into one balance owed: the Total current balance", () => {
    assert.equal(r.meta.accountNumber, "2345");
    assert.equal(r.meta.institution, "Edfinancial");
    assert.equal(r.meta.accountType, "Loan");
    assert.equal(r.meta.periodStart, "2026-10-08");
    assert.equal(r.meta.periodEnd, "2026-11-08");
    assert.equal(r.meta.closingBalance, 5003); // principal + unpaid interest, not the principal alone
    assert.equal(r.meta.openingBalance, null);
    assert.equal(r.reconciled, true);
    assert.equal(r.meta.balanceDetail, "principal $5,000.00, unpaid interest $3.00, 2 loans");
  });

  test("APR is the principal-weighted rate; payment is the regular monthly amount", () => {
    // (2,000 × 3.5 + 3,000 × 4.5) / 5,000
    assert.equal(r.meta.apr, 4.1);
    assert.equal(r.meta.minPayment, 60);
  });

  test("the cycle's payment is a credit and the interest it covered a debit, same day", () => {
    assert.deepEqual(rows(r), [
      ["2026-11-05", "Credit", 60, "Payment"],
      ["2026-11-05", "Debit", 15, "Interest charged"],
    ]);
    assert.equal(r.txns[0].raw.principal, "45.00");
    assert.deepEqual(r.notes, []);
  });

  test("a cycle with no payment yields the balance and no rows", () => {
    const p = parse(
      STATEMENT.map((l) =>
        l
          .replace("$ 25.00 $ 35.00 $60.00", "$ 0.00 $ 0.00 $0.00")
          .replace("Last Payment Date 11/05/26 11/05/26", "Last Payment Date 00/00/00 00/00/00")
          .replace("Applied to Interest $ 6.00 $ 9.00 $15.00", "Applied to Interest $ 0.00 $ 0.00 $0.00")
          .replace("$ 19.00 $ 26.00 $45.00", "$ 0.00 $ 0.00 $0.00"),
      ),
    );
    assert.deepEqual(rows(p), []);
    assert.equal(p.meta.closingBalance, 5003);
    assert.equal(p.meta.minPayment, 60); // from the page-1 summary, not the zeroed table row
    assert.deepEqual(p.notes, []);
  });

  test("two payments in one cycle arrive as one row, with a note", () => {
    const p = parse(
      STATEMENT.map((l) =>
        l
          .replace("$ 25.00 $ 35.00 $60.00", "$ 50.00 $ 70.00 $120.00")
          .replace("Applied to Interest $ 6.00 $ 9.00 $15.00", "Applied to Interest $ 12.00 $ 18.00 $30.00")
          .replace("$ 19.00 $ 26.00 $45.00", "$ 38.00 $ 52.00 $90.00"),
      ).flatMap((l, i, all) => (l === "Monthly Payment" ? [l, "$ 25.00 $ 35.00 $60.00"] : all[i - 1] === "Monthly Payment" ? [] : [l])),
    );
    assert.deepEqual(rows(p), [
      ["2026-11-05", "Credit", 120, "Payment"],
      ["2026-11-05", "Debit", 30, "Interest charged"],
    ]);
    assert.match(p.notes.join("\n"), /exceed the regular payment/);
  });

  test("a loan column that does not add up to the total is reported", () => {
    const p = parse(swap("Current Balance $ 2,001.00 $ 3,002.00 $5,003.00", ["Current Balance $ 2,001.00 $ 3,002.00 $5,004.00"]));
    assert.ok(p.notes.some((n) => n.startsWith("Current Balance: the loans add up to $5,003.00")));
    assert.equal(p.reconciled, false); // principal + interest no longer equals the balance either
  });

  test("a missing loan table is reported rather than guessed from the summary", () => {
    const p = parse(STATEMENT.slice(0, STATEMENT.indexOf("Loan ID 1-01 1-02 Total")));
    assert.equal(p.meta.closingBalance, null);
    assert.equal(p.meta.apr, null);
    assert.ok(p.notes.some((n) => n.includes("loan table")));
  });

  test("not mistaken for another servicer's statement", () => {
    assert.equal(edfinancialLoanParser.detect("Loan Periodic Statement\nLoan ID: LN-1\nOutstanding balance $1.00"), false);
  });
});

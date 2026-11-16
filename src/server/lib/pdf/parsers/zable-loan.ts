// Parser for the Zable personal loan "Loan Periodic Statement" PDF. One statement = one loan.
// The layout has held steady since 2024; only the footer address, the phone number's
// punctuation and the wording of a not-yet-settled payment have changed.
//
// Layout, after lines.ts has rebuilt the visual lines (page 1 is two boxes side by side, so a
// left-hand figure can share its line with a right-hand one):
//
//   Loan Periodic Statement
//   Loan ID: LN-AB12-CD34
//   Period: Nov 8, 2025 to Dec 7, 2025
//   Statement date: Dec 7, 2025
//   Account Information Amount Due Details
//   Outstanding balance $4,050.00 Due date Dec 8, 2025     <- principal + interest accrued so far
//   (as of Dec 7, 2025)
//   Recurring amount $250.00                               <- the monthly payment
//   Outstanding principal balance $4,000.00
//   Fees amount $0.00
//   Prepaid amount $0.00
//   APR 20.00%
//   Total amount due $250.00
//   Past Payments Breakdown 2025 Totals Year to Date
//   Description Paid Last Period Paid Year to Date Total fees charged in 2025 $0.00
//   Principal $170.00 $1,900.00 Total interest charged in 2025 $900.00
//   ...
//   Account Activities
//   Activity Date Description Amount
//   Nov 8, 2025 Payment - Bank Account *1234 -$250.00      <- a minus lowers what is owed
//   Fees
//   Description Amount
//   TOTAL FEES FOR THIS PERIOD $0.00
//   Interest Charged
//   Description Amount
//   TOTAL INTEREST FOR THIS PERIOD $65.00
//   Questions?
//
// A payment still clearing when the statement is cut prints as "Payment processing - Bank
// Account *1234". It is imported under the settled wording ("Payment - …", with
// raw.status = "processing") so the same payment listed again on the next statement is
// recognised as a duplicate rather than imported twice.
//
// What is stored:
//   - the balance owed at the period's end ("Outstanding balance" — what it would take to pay
//     the loan off), with the principal in the snapshot's note and the APR and monthly payment
//     on the snapshot itself;
//   - each payment as a Credit;
//   - the period's interest as one Debit dated the period end (the statement gives only the
//     total), and likewise any fees that are not listed as dated rows of their own.
//
// The statement prints no opening balance, so there is nothing to reconcile against
// (`reconciled: null`); the previous statement's closing balance is the opening one.
import { parseMoney } from "@/server/lib/money";
import type { ParserResult, ParsedTxn, StatementParser } from "@/server/lib/pdf/types";

const SOURCE = "zable-loan";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = String.raw`[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}`;
const MONEY = String.raw`-?\$[\d,]*\.\d{2}`;

const LOAN_ID_RE = /^Loan ID: ?(\S+)$/m;
const PERIOD_RE = new RegExp(`^Period: (${DATE}) to (${DATE})$`, "m");
const STATEMENT_DATE_RE = new RegExp(`^Statement date: (${DATE})$`, "m");
const APR_RE = /^APR (\d+(?:\.\d+)?)%/m;
// "<date> <description> <amount>" — an activity row (or a dated fee).
const ROW_RE = new RegExp(`^(${DATE}) (.+?) (${MONEY})$`);
const TOTAL_RE = new RegExp(`^TOTAL (FEES|INTEREST) FOR THIS PERIOD (${MONEY})$`);
const SKIP_RE = /^(?:Activity Date Description Amount|Description Amount)$/;
const FOOTER_RE = /\b\d+ of \d+$/;
const END_RE = /^Questions\?$/;

// "Dec 7, 2025" → "2025-12-07"; null for anything that isn't a real calendar date.
function toIso(s: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const day = Number(m[2]);
  if (month < 1 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The figure printed right after a label that starts a line (the other box's text may follow).
function figure(text: string, label: string): number | null {
  const m = new RegExp(`^${label} (${MONEY})`, "m").exec(text);
  return m ? parseMoney(m[1]) : null;
}

const cents = (n: number) => Math.round(n * 100);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Section = "activity" | "fees" | "interest";

export const zableLoanParser: StatementParser = {
  id: SOURCE,
  label: "Zable — loan statement",

  detect(text) {
    return /zable/i.test(text) && /Loan Periodic Statement/.test(text) && /Outstanding balance/.test(text);
  },

  parse(lines, text): ParserResult {
    const notes: string[] = [];

    // Accounts are known by their last four characters; the loan ID is letters and digits.
    const loanId = LOAN_ID_RE.exec(text)?.[1] ?? "";
    const accountNumber = loanId.replace(/[^A-Za-z0-9]/g, "").slice(-4);

    const pm = PERIOD_RE.exec(text);
    const sd = STATEMENT_DATE_RE.exec(text);
    const periodStart = pm ? toIso(pm[1]) : null;
    const periodEnd = (pm ? toIso(pm[2]) : null) ?? (sd ? toIso(sd[1]) : null);
    if (!periodEnd) notes.push("Could not find the statement period; the balance has no date.");

    const outstanding = figure(text, "Outstanding balance");
    const principal = figure(text, "Outstanding principal balance");
    const payment = figure(text, "Recurring amount");
    const aprRaw = APR_RE.exec(text)?.[1];
    if (outstanding == null) notes.push("Could not find the outstanding balance.");

    const txns: ParsedTxn[] = [];
    const listed: Record<"fees" | "interest", number> = { fees: 0, interest: 0 };
    let section: Section | null = null;

    const add = (dateIso: string | null, description: string, amount: number, direction: "Debit" | "Credit", raw: Record<string, string>) => {
      txns.push({ dateIso, description, amount, direction, raw: { ...raw, source: SOURCE, account: accountNumber } });
    };

    for (const line of lines) {
      if (/^Account Activities$/.test(line)) {
        section = "activity";
        continue;
      }
      if (section == null) continue;
      if (END_RE.test(line)) break;
      if (FOOTER_RE.test(line) || SKIP_RE.test(line)) continue;
      if (line === "Fees") {
        section = "fees";
        continue;
      }
      if (line === "Interest Charged") {
        section = "interest";
        continue;
      }

      const total = TOTAL_RE.exec(line);
      if (total) {
        const kind = total[1] === "FEES" ? "fees" : "interest";
        // Whatever the total holds beyond the dated rows above it becomes one row at the period end.
        const rest = (parseMoney(total[2]) ?? 0) - listed[kind];
        if (cents(rest) > 0) {
          add(periodEnd, kind === "fees" ? "Fees charged" : "Interest charged", cents(rest) / 100, "Debit", { line, section: kind });
        } else if (cents(rest) < 0) {
          notes.push(`${kind === "fees" ? "Fee" : "Interest"} rows add up to more than the period's total (${line}).`);
        }
        continue;
      }

      const row = ROW_RE.exec(line);
      if (row) {
        const signed = parseMoney(row[3]);
        const dateIso = toIso(row[1]);
        if (signed == null || !dateIso) {
          notes.push(`Unparsed line: ${line}`);
          continue;
        }
        const raw: Record<string, string> = { line, section };
        let description = row[2].trim();
        if (/^Payment processing\b/i.test(description)) {
          description = description.replace(/^Payment processing\b/i, "Payment");
          raw.status = "processing";
        }
        // A minus lowers what is owed (a payment); anything else raises it.
        const direction = signed < 0 ? "Credit" : "Debit";
        if (section !== "activity" && direction === "Debit") listed[section] += signed;
        add(dateIso, description, Math.abs(signed), direction, raw);
        continue;
      }

      notes.push(`Unparsed line: ${line}`);
    }

    if (section == null) notes.push("Could not find the Account Activities table; no transactions were read.");

    return {
      meta: {
        accountNumber,
        institution: "Zable",
        accountType: "Loan",
        openingBalance: null,
        closingBalance: outstanding,
        balanceDetail: principal == null ? null : `principal ${usd(principal)}`,
        apr: aprRaw == null ? null : Number(aprRaw),
        minPayment: payment,
        periodStart,
        periodEnd,
      },
      txns,
      reconciled: null,
      notes,
    };
  },
};

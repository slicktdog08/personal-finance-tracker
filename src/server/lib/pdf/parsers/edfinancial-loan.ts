// Parser for the Edfinancial (federal Direct Loan servicer) monthly student-loan statement.
// One statement covers one servicer account that holds several loans (subsidized and
// unsubsidized, each with its own rate); the tracker keeps them as ONE loan account, so every
// figure is the statement's Total column and the per-loan columns only feed the APR and the
// cross-checks.
//
// Layout, after lines.ts has rebuilt the visual lines (illustrative values):
//
//   Account 0000012345-1
//   This Month’s Billing Cycle: 10/08/26 to 11/08/26 Phone: …
//   Statement Date 11/08/26 With your online account …
//   Unpaid Principal $5,000.00                               <- page-1 summary
//   Regular Monthly Payment Amount $60.00 · Make a payment
//   …
//   Loan ID 1-01 1-02 Total                                  <- the loan table
//   Current Balance $ 2,001.00 $ 3,002.00 $5,003.00          <- principal + unpaid interest
//   Unpaid Interest * $ 1.00 $ 2.00 $3.00
//   Unpaid Principal $ 2,000.00 $ 3,000.00 $5,000.00
//   Capitalized                                              <- a two-line label wraps around
//   $ 50.00 $ 70.00 120.00                                      its figures (the total may
//   Interest                                                    print with no $)
//   …
//   Payments
//   $ 25.00 $ 35.00 $60.00                                   <- received this billing cycle
//   Received
//   Last Payment Date 11/05/26 11/05/26                      <- 00/00/00 when none
//   Applied to Interest $ 6.00 $ 9.00 $15.00
//   Applied to
//   $ 19.00 $ 26.00 $45.00
//   Principal
//   Interest Rate 3.500 4.500
//   Monthly Payment
//   $ 25.00 $ 35.00 $60.00
//   Amount
//   1 F = Fixed, V = Variable                                <- end of the table
//
// What is stored:
//   - the Total "Current Balance" (what it would take to pay the account off) as the balance
//     at the statement date, with principal and unpaid interest in the snapshot's note;
//   - the APR as the principal-weighted average of the loans' rates (interest accrues on
//     principal, so this is the rate the whole account costs), and the regular monthly payment;
//   - the cycle's "Payments Received" as one Credit dated the last payment date, and the part
//     of it "Applied to Interest" as one Debit on the same day ("Interest charged"). The table
//     prints only totals, so two payments in one cycle arrive as one row — noted when the
//     amount is more than the regular payment.
//
// Interest that accrued but is still unpaid at the statement date is in the balance, not in a
// transaction; it becomes a Debit on the statement where a payment covers it.
import { parseMoney } from "@/server/lib/money";
import type { ParserResult, ParsedTxn, StatementParser } from "@/server/lib/pdf/types";

const SOURCE = "edfinancial-loan";

// "$ 2,001.00", "$5,003.00", "120.00", "-1,120.00". A rate ("3.500") has three decimals and
// does not match; neither does a date.
const MONEY_RE = /-?\$? ?\d[\d,]*\.\d{2}(?![\d/])/g;
const MDY = String.raw`\d{2}/\d{2}/\d{2}`;
const CYCLE_RE = new RegExp(`Billing Cycle: (${MDY}) to (${MDY})`);
const STATEMENT_DATE_RE = new RegExp(`^Statement Date (${MDY})\\b`, "m");
const ACCOUNT_RE = /^Account (\d[\d-]*\d)\b/m;
const TABLE_START_RE = /^Loan ID (.+) Total$/;
const TABLE_END_RE = /F = Fixed/;

// "11/08/26" → "2026-11-08"; null for 00/00/00 or anything that isn't a calendar date.
function mdyToIso(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `20${m[3]}-${m[1]}-${m[2]}`;
}

const cents = (n: number) => Math.round(n * 100);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function amounts(s: string): number[] {
  return (s.match(MONEY_RE) ?? []).map((t) => parseMoney(t.replace(/\s/g, "")) ?? NaN);
}

/** The loan table's rows by label → the figures on that row (per loan, then the total). */
interface LoanTable {
  loanIds: string[];
  rows: Map<string, number[]>;
  rates: number[];
  paymentDates: string[];
}

function readTable(lines: string[]): LoanTable | null {
  const start = lines.findIndex((l) => TABLE_START_RE.test(l));
  if (start < 0) return null;
  const loanIds = TABLE_START_RE.exec(lines[start])![1].split(/\s+/);
  const rows = new Map<string, number[]>();
  let rates: number[] = [];
  let paymentDates: string[] = [];

  for (let i = start + 1; i < lines.length && !TABLE_END_RE.test(lines[i]); i++) {
    const line = lines[i];
    if (/^Interest Rate\b/.test(line)) {
      rates = (line.match(/\d+\.\d+/g) ?? []).map(Number);
      continue;
    }
    if (/^Last Payment Date\b/.test(line)) {
      paymentDates = (line.match(new RegExp(MDY, "g")) ?? []).map(mdyToIso).filter((d): d is string => d != null);
      continue;
    }
    const first = line.search(MONEY_RE);
    if (first < 0) continue; // a text-only row (Loan Program, Interest Type) or half a label
    const label = line.slice(0, first).replace(/\s*\*\s*$/, "").trim();
    // A row whose label wraps prints its figures on a line of their own, between the label's
    // two halves; the first half names it ("Capitalized", "Payments", "Applied to", …).
    const key = label || lines[i - 1].trim();
    if (!rows.has(key)) rows.set(key, amounts(line.slice(first)));
  }
  return { loanIds, rows, rates, paymentDates };
}

export const edfinancialLoanParser: StatementParser = {
  id: SOURCE,
  label: "Edfinancial — student loan statement",

  detect(text) {
    return /Edfinancial/i.test(text) && /Student Loan Account Details/.test(text) && /^Loan ID /m.test(text);
  },

  parse(lines, text): ParserResult {
    const notes: string[] = [];

    // Accounts are known by their last four digits; "0000012345-1" → "2345" (the -1 suffix is
    // the same on every statement, so the digits before it are what tell accounts apart).
    const printed = ACCOUNT_RE.exec(text)?.[1] ?? "";
    const accountNumber = printed.split("-")[0].replace(/\D/g, "").slice(-4);

    const cycle = CYCLE_RE.exec(text);
    const statementDate = STATEMENT_DATE_RE.exec(text)?.[1];
    const periodStart = cycle ? mdyToIso(cycle[1]) : null;
    const periodEnd = (cycle ? mdyToIso(cycle[2]) : null) ?? (statementDate ? mdyToIso(statementDate) : null);
    if (!periodEnd) notes.push("Could not find the billing cycle; the balance has no date.");

    const headerPayment = /^Regular Monthly Payment Amount (\$[\d,]*\.\d{2})/m.exec(text)?.[1];

    const table = readTable(lines);
    if (!table) notes.push("Could not find the loan table (\"Loan ID … Total\").");
    const n = table?.loanIds.length ?? 0;

    // The Total of a row, after checking the loans add up to it. Missing → null.
    const total = (key: string): number | null => {
      const v = table?.rows.get(key);
      if (!v || v.length === 0) return null;
      if (v.length !== n + 1 || v.some(Number.isNaN)) {
        notes.push(`${key}: expected ${n} loans and a total, read ${v.length} figures.`);
        return Number.isNaN(v[v.length - 1]) ? null : v[v.length - 1];
      }
      const sum = v.slice(0, n).reduce((a, b) => a + cents(b), 0);
      if (sum !== cents(v[n])) notes.push(`${key}: the loans add up to ${usd(sum / 100)}, the total says ${usd(v[n])}.`);
      return v[n];
    };

    const balance = total("Current Balance");
    const principal = total("Unpaid Principal");
    const unpaidInterest = total("Unpaid Interest");
    const received = total("Payments") ?? 0;
    const toInterest = total("Applied to Interest") ?? 0;
    const toPrincipal = total("Applied to") ?? 0;
    const monthly = (headerPayment ? parseMoney(headerPayment) : null) ?? total("Monthly Payment");
    if (balance == null) notes.push("Could not find the Current Balance total.");

    let reconciled: boolean | null = null;
    if (balance != null && principal != null && unpaidInterest != null) {
      reconciled = cents(principal) + cents(unpaidInterest) === cents(balance);
      if (!reconciled) notes.push(`Principal ${usd(principal)} + unpaid interest ${usd(unpaidInterest)} ≠ current balance ${usd(balance)}.`);
    }
    if (cents(received) !== cents(toInterest) + cents(toPrincipal)) {
      notes.push(`Payments received ${usd(received)} ≠ applied to interest ${usd(toInterest)} + principal ${usd(toPrincipal)}.`);
    }

    // Interest accrues on principal, so the account's rate is the principal-weighted average.
    let apr: number | null = null;
    const perLoanPrincipal = table?.rows.get("Unpaid Principal")?.slice(0, n) ?? [];
    if (table && table.rates.length === n && perLoanPrincipal.length === n) {
      const weight = perLoanPrincipal.reduce((a, b) => a + b, 0);
      apr = weight > 0
        ? Math.round((perLoanPrincipal.reduce((a, p, i) => a + p * table.rates[i], 0) / weight) * 1000) / 1000
        : Math.max(...table.rates);
    } else if (table) {
      notes.push(`Read ${table.rates.length} interest rates for ${n} loans; no APR recorded.`);
    }

    const txns: ParsedTxn[] = [];
    if (cents(received) > 0) {
      const paidOn = table?.paymentDates.length ? [...table.paymentDates].sort().at(-1)! : periodEnd;
      const raw = { source: SOURCE, account: accountNumber, interest: toInterest.toFixed(2), principal: toPrincipal.toFixed(2) };
      txns.push({ dateIso: paidOn, description: "Payment", amount: cents(received) / 100, direction: "Credit", raw });
      if (cents(toInterest) > 0) {
        txns.push({ dateIso: paidOn, description: "Interest charged", amount: cents(toInterest) / 100, direction: "Debit", raw: { ...raw, section: "interest" } });
      }
      if (monthly != null && cents(received) > cents(monthly)) {
        notes.push(`Payments received (${usd(received)}) exceed the regular payment (${usd(monthly)}); the statement prints only the cycle's total, so it is one row dated ${paidOn}.`);
      }
    }

    const detail: string[] = [];
    if (principal != null) detail.push(`principal ${usd(principal)}`);
    if (unpaidInterest != null && cents(unpaidInterest) > 0) detail.push(`unpaid interest ${usd(unpaidInterest)}`);
    if (n > 1) detail.push(`${n} loans`);

    return {
      meta: {
        accountNumber,
        institution: "Edfinancial",
        accountType: "Loan",
        openingBalance: null,
        closingBalance: balance,
        balanceDetail: detail.length ? detail.join(", ") : null,
        apr,
        minPayment: monthly,
        periodStart,
        periodEnd,
      },
      txns,
      reconciled,
      notes,
    };
  },
};

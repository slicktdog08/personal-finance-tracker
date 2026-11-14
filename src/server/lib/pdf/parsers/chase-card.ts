// Parser for the Chase credit card statement PDF — personal cards and business (Ink) cards
// share one layout. One statement = one card account; a business account may list several
// employee cards, each closing its rows with its own "TRANSACTIONS THIS CYCLE" total.
//
// Layout, after lines.ts has rebuilt the visual lines (Chase prints its headings twice, once
// for screen readers, so they come out doubled):
//
//   ACCOUNT ACCOUNT SUMMARY SUMMARY
//   Account Number: XXXX XXXX XXXX 1234
//   Previous Balance $1,000.00
//   Payment, Credits -$300.00
//   Purchases +$170.00
//   Cash Advances $0.00
//   Balance Transfers $0.00
//   Fees Charged +$0.54
//   Interest Charged +$13.50
//   New Balance $884.04
//   Opening/Closing Date 12/28/25 - 01/27/26
//   Revolving Credit Amount $2,000            <- "Credit Access Line" on personal cards
//   ...
//   ACCOUNT ACCOUNT ACTIVITY ACTIVITY         <- "ACCOUNT ACTIVITY (CONTINUED)" on later pages
//   Date of
//   Transaction Merchant Name or Transaction Description $ Amount
//   01/18 Payment Thank You - Web -300.00     <- a minus marks a payment or credit
//   12/29 COFFEE SHOP ANYTOWN CA 4.50         <- no year; no "$"; cents-only prints as ".54"
//   01/20 FOREIGN MERCHANT SOMECITY 18.00
//   01/21 EURO                                <- a foreign purchase adds two lines: the
//   16.20 X 1.111111111 (EXCHG RATE)             currency, then original amount and rate
//   01/21 FOREIGN TRANSACTION FEE .54
//   01/27 PURCHASE INTEREST CHARGE 13.50
//   PAT EXAMPLE
//   TRANSACTIONS THIS CYCLE (CARD 1234) $170.00   <- signed sum of that card's rows; a net
//   INCLUDING PAYMENTS RECEIVED                      credit prints as "$12.00-"
//   2026 Totals Year-to-Date
//
// Personal statements also break the rows up under headings (PAYMENTS AND OTHER CREDITS,
// PURCHASE, FEES CHARGED, INTEREST CHARGED); those are skipped and the row's sign decides.
//
// Balances are amounts OWED (previous → new), so the generic check (opening + credits −
// debits == closing) has the wrong sign for a card. The parser reports its own verdict:
// previous + charges − payments/credits == new balance. Rows are also checked against the
// Account Summary (payments and credits; interest; everything else) and against each card's
// printed cycle total.
import { parseMoney } from "@/server/lib/money";
import type { ParserResult, ParsedTxn, StatementParser } from "@/server/lib/pdf/types";

const SOURCE = "chase-card";

const ACCOUNT_RE = /^Account Number:.*?(\d{4})$/m;
// "Opening/Closing Date 12/28/25 - 01/27/26"
const PERIOD_RE = /Opening\/Closing Date (\d{2})\/(\d{2})\/(\d{2}) - (\d{2})\/(\d{2})\/(\d{2})/;
const ACTIVITY_RE = /^ACCOUNT (?:ACCOUNT )?ACTIVITY\b/;
const PAGE_FOOTER_RE = /\bPage \d+ of \d+\b/;
// "<mm/dd> <description> <amount>" — the amount has no "$" and may lack a leading digit.
const TXN_RE = /^(\d{2})\/(\d{2}) (.+?) (-?[\d,]*\.\d{2})$/;
// "01/21 EURO" then "16.20 X 1.111111111 (EXCHG RATE)"
const FX_CURRENCY_RE = /^\d{2}\/\d{2} ([A-Z][A-Z .'-]*)$/;
const FX_RATE_RE = /^([\d,]*\.\d+) X ([\d.]+) \(EXCHG RATE\)$/;
// "TRANSACTIONS THIS CYCLE (CARD 1234) $170.00" — a trailing minus marks a net credit.
const CARD_TOTAL_RE = /^TRANSACTIONS THIS CYCLE \(CARD (\d{4})\) (-?)\$([\d,]*\.\d{2})(-?)$/;
// Lines that sit between rows without being one: column heads and section headings.
const SKIP_RE =
  /^(?:Table Summary|Date of|Transaction Merchant Name or Transaction Description \$ Amount|INCLUDING PAYMENTS RECEIVED|PAYMENTS? AND OTHER CREDITS|RETURNS AND OTHER CREDITS|PURCHASES?|CASH ADVANCES?|BALANCE TRANSFERS?|FEES CHARGED|INTEREST CHARGED|TOTAL (?:FEES|INTEREST) FOR THIS PERIOD .*)$/;
// Everything after the activity is totals and disclosures.
const END_RE = /Totals Year-to-Date/;

type Kind = "credits" | "charges" | "interest";

// A figure from the Account Summary, signed as printed ("-$300.00" → −300).
function summary(text: string, label: string): number | null {
  const m = new RegExp(String.raw`^${label} ([-+]?)(\$[\d,]*\.?\d*)$`, "m").exec(text);
  if (!m) return null;
  const n = parseMoney(m[2]);
  return n == null ? null : m[1] === "-" ? -n : n;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const cents = (n: number) => Math.round(n * 100);

export const chaseCardParser: StatementParser = {
  id: SOURCE,
  label: "Chase — credit card statement (personal and business)",

  detect(text) {
    return /chase\.com/i.test(text) && /Opening\/Closing Date/.test(text) && /ACCOUNT ACTIVITY/.test(text);
  },

  parse(lines, text): ParserResult {
    const notes: string[] = [];
    const accountNumber = ACCOUNT_RE.exec(text)?.[1] ?? "";

    const pm = PERIOD_RE.exec(text);
    const endMonth = pm ? Number(pm[4]) : NaN;
    const endYear = pm ? 2000 + Number(pm[6]) : NaN;
    const periodStart = pm ? toIso(2000 + Number(pm[3]), Number(pm[1]), Number(pm[2])) : null;
    const periodEnd = pm ? toIso(endYear, endMonth, Number(pm[5])) : null;
    if (!pm) notes.push("Could not find the opening/closing dates; dates may be missing.");
    // Rows only show "01/18". A month later in the year than the period's end belongs to the
    // year before (a Dec → Jan cycle).
    const dateOf = (mm: string, dd: string) => {
      const month = Number(mm);
      return pm ? toIso(month > endMonth ? endYear - 1 : endYear, month, Number(dd)) : null;
    };

    const previous = summary(text, "Previous Balance");
    const closing = summary(text, "New Balance");
    const creditLimit = summary(text, "(?:Revolving Credit Amount|Credit Access Line|Credit Limit)");
    const printed = {
      credits: summary(text, "Payments?, Credits"),
      purchases: summary(text, "Purchases"),
      cashAdvances: summary(text, "Cash Advances"),
      balanceTransfers: summary(text, "Balance Transfers"),
      fees: summary(text, "Fees Charged"),
      interest: summary(text, "Interest Charged"),
    };

    const txns: ParsedTxn[] = [];
    const sums: Record<Kind, number> = { credits: 0, charges: 0, interest: 0 };
    let inTable = false;
    let last: ParsedTxn | null = null; // the row a foreign-currency block would belong to
    let block: ParsedTxn[] = []; // rows since the last card total

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (END_RE.test(line)) break;
      if (ACTIVITY_RE.test(line)) {
        inTable = true;
        continue;
      }
      if (PAGE_FOOTER_RE.test(line)) {
        inTable = false;
        continue;
      }
      if (!inTable || SKIP_RE.test(line)) continue;

      const ct = CARD_TOTAL_RE.exec(line);
      if (ct) {
        const total = (parseMoney(ct[3]) ?? 0) * (ct[2] || ct[4] ? -1 : 1);
        const got = block.reduce((n, t) => n + (t.direction === "Credit" ? -1 : 1) * (t.amount ?? 0), 0);
        for (const t of block) t.raw.card = ct[1];
        if (cents(got) !== cents(total)) {
          notes.push(
            `Card ${ct[1]} rows add up to ${got.toFixed(2)} but the statement shows ${total.toFixed(2)} — a row may be missing.`,
          );
        }
        block = [];
        last = null;
        continue;
      }
      // The cardholder's name sits on its own line just above their total.
      if (CARD_TOTAL_RE.test(lines[i + 1] ?? "")) continue;

      const tm = TXN_RE.exec(line);
      if (tm) {
        const [, mm, dd, description, amountRaw] = tm;
        const signed = parseMoney(amountRaw);
        const direction: "Credit" | "Debit" = amountRaw.startsWith("-") ? "Credit" : "Debit";
        const amount = signed == null ? null : Math.abs(signed);
        const kind: Kind = direction === "Credit" ? "credits" : /\bINTEREST CHARGE\b/i.test(description) ? "interest" : "charges";
        if (amount != null) sums[kind] += direction === "Credit" ? -amount : amount;
        last = {
          dateIso: dateOf(mm, dd),
          description: description.trim(),
          amount,
          direction,
          raw: { line, section: kind, source: SOURCE, account: accountNumber },
        };
        txns.push(last);
        block.push(last);
        continue;
      }

      // The two lines under a purchase made in another currency.
      const fr = FX_RATE_RE.exec(line);
      if (last && fr && !last.raw.exchangeRate) {
        last.raw.foreignAmount = fr[1];
        last.raw.exchangeRate = fr[2];
        continue;
      }
      const fc = FX_CURRENCY_RE.exec(line);
      if (last && fc && !last.raw.foreignCurrency) {
        last.raw.foreignCurrency = fc[1].trim();
        continue;
      }

      notes.push(`Unparsed line: ${line}`);
    }

    // Each kind of row against the figure the summary prints for it. Credits were summed as
    // negatives, so flip them; fees, cash advances and balance transfers are listed among the
    // purchases with nothing but their wording to tell them apart, so they are checked as one.
    const compare = (what: string, got: number, want: number | null) => {
      if (want != null && cents(got) !== cents(want)) {
        notes.push(`${what} rows add up to ${got.toFixed(2)} but the statement shows ${want.toFixed(2)} — a row may be missing.`);
      }
    };
    compare("Payment and credit", -sums.credits, printed.credits == null ? null : Math.abs(printed.credits));
    if (printed.purchases != null) {
      compare(
        "Purchase and fee",
        sums.charges,
        printed.purchases + (printed.cashAdvances ?? 0) + (printed.balanceTransfers ?? 0) + (printed.fees ?? 0),
      );
    }
    compare("Interest", sums.interest, printed.interest);

    const net = sums.credits + sums.charges + sums.interest;
    const reconciled = previous != null && closing != null ? cents(previous + net) === cents(closing) : null;

    return {
      meta: {
        accountNumber,
        institution: "Chase",
        accountType: "Credit",
        openingBalance: previous,
        closingBalance: closing,
        creditLimit,
        periodStart,
        periodEnd,
      },
      txns,
      reconciled,
      notes,
    };
  },
};

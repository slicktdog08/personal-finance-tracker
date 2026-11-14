// Parser for the Capital One credit card statement PDF. One statement = one card account.
//
// Layout, after lines.ts has rebuilt the visual lines:
//
//   Page 1 of 4
//   Example Rewards Card | Visa Signature ending in 1234     <- product | network + last-4
//   Dec 25, 2025 - Jan 24, 2026 | 31 days in Billing Cycle   <- billing period (every page)
//   ...the Account Summary shares its rows with the payment box beside it, so each figure
//      is the tail of a longer line:
//   Payment Due Date For online and phone payments, the Previous Balance $1,000.00
//   Feb 18, 2026 Payments - $300.00
//   New Balance Minimum Payment Due Other Credits - $5.00
//   $878.50 $25.00 Transactions + $170.00
//   ... Cash Advances + $0.00 / Fees Charged + $0.00 / Interest Charged + $13.50
//   New Balance = $878.50
//   Credit Limit $2,000.00
//   ...
//   Transactions
//   PAT EXAMPLE #1234: Payments, Credits and Adjustments     <- one block per cardholder
//   Trans Date Post Date Description Amount
//   Jan 18 Jan 18 CAPITAL ONE MOBILE PYMTAuthDate 17-Jan - $300.00
//   PAT EXAMPLE #1234: Transactions
//   Trans Date Post Date Description Amount
//   Dec 23 Dec 26 COFFEE SHOPANYTOWNCA $4.50                 <- trans date may precede the period
//   Jan 18 Jan 20 FOREIGN MERCHANTSOMECITY $20.00
//   $18.00                                                   <- a foreign purchase adds three
//   EUR                                                         lines: original amount, currency
//   0.900000000 Exchange Rate                                   and rate
//   PAT EXAMPLE #1234: Total Transactions $170.00
//   Total Transactions for This Period $170.00
//   Fees
//   Trans Date Post Date Description Amount
//   Total Fees for This Period $0.00
//   Interest Charged
//   Interest Charge on Purchases $13.50                      <- undated; posts at cycle end
//   Total Interest for This Period $13.50
//
// Statements from before mid-2021 use an older, two-column layout: the header reads
// "Example Card Account Ending in 1234", months carry a dot ("Dec. 25, 2025"), rows have one
// date ("Date Description Amount") and a long description wraps onto the line below its row:
//
//   Jan 16 RIDE SHARE COMPANY $9.50
//   INC800-555-0100CA
//
// The activity runs down the left half of the page and carries on in the right half, beside
// the interest tables, so whole-page lines would splice unrelated text onto the rows. For that
// layout the lines are rebuilt from the positioned text, one column at a time.
//
// Balances are amounts OWED (previous → new), so the generic check (opening + credits −
// debits == closing) has the wrong sign for a card. The parser reports its own verdict:
// previous + charges − payments/credits == new balance, and each kind of row is also checked
// against the figure the Account Summary prints for it.
import { parseMoney } from "@/server/lib/money";
import { groupItemsToLines } from "@/server/lib/pdf/lines";
import type { ParserResult, ParsedTxn, StatementParser } from "@/server/lib/pdf/types";

const SOURCE = "capitalone-card";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON = `(${MONTHS.join("|")})`;
const AMT = String.raw`\$[\d,]+\.\d{2}`;

// "Example Rewards Card | Visa Signature ending in 1234"; older: "Example Card Account Ending in 1234"
const HEADER_RE = /^(.+?) (?:\| .*\bending in|Account Ending in) (\d{4})$/m;
// "Dec 25, 2025 - Jan 24, 2026 | 31 days in Billing Cycle"; older: "Dec. 25, 2025 - Jan. 24, 2026 | ..."
const PERIOD_RE = new RegExp(
  String.raw`\b${MON}[a-z]*\.? (\d{1,2}), (\d{4}) - ${MON}[a-z]*\.? (\d{1,2}), (\d{4}) \| \d+ days in Billing Cycle`,
);
const CURRENT_LAYOUT_RE = /Trans Date Post Date Description Amount/;
const TABLE_HEADER_RE = /^(?:Trans Date Post Date|Date) Description Amount$/;
// The older layout's rows: one date.
const LEGACY_TXN_RE = new RegExp(String.raw`^${MON} (\d{1,2}) (.+?) (- )?(${AMT})$`);
// Where the older layout's left column ends, in PDF points on a letter page: amounts in the
// left table end near x=310 and the right column starts near x=328.
const LEGACY_GUTTER_X = 320;
// "<Mon d> <Mon d> <description> [- ]$amount" — a leading "- " marks a payment or credit.
const TXN_RE = new RegExp(String.raw`^${MON} (\d{1,2}) ${MON} (\d{1,2}) (.+?) (- )?(${AMT})$`);
// "PAT EXAMPLE #1234: Payments, Credits and Adjustments" / "...: Transactions"
const HOLDER_RE = /^(.+) #(\d{4}): (Payments, Credits and Adjustments|Transactions)$/;
const INTEREST_RE = new RegExp(String.raw`^(Interest Charge on .+?) (${AMT})$`);
const FX_AMOUNT_RE = /^\$[\d,]+\.\d{2}$/;
const FX_CURRENCY_RE = /^[A-Z]{3}$/;
const FX_RATE_RE = /^([\d.]+) Exchange Rate$/;
// "TK#: 0001234567890 PSGR: EXAMPLE/PAT" then one "ORIG: AAA, DEST: BBB, S/O: X, CARRIER: XX, SVC: Y" per leg
const TRAVEL_RE = /^(?:(?:TK#: \S+ )?PSGR: .*|ORIG: .*\bDEST: .*)$/;
// Lines that sit between rows without being one: page furniture and section totals.
const SKIP_RE =
  /^(?:Page \d+ of \d+|Transactions(?: \(Continued\)| Continued)?|Transactions continue on .*|Fees|Interest Charged|Visit (?:www\.)?capitalone\.com .*|Additional Information on the next page|.* #\d{4}: Total .*|Total .* for This Period .*)$/;
// Everything after the interest block is disclosures, not activity.
const END_RE = /^(?:Totals Year-to-Date|Interest Charge Calculation)$/;

type Kind = "credits" | "charges" | "fees";

// A figure from the Account Summary. Each label is unique there, but the summary shares its
// lines with the payment box, so the label is matched anywhere in the text.
function summary(text: string, label: string): number | null {
  const m = new RegExp(String.raw`${label} (?:[-+=] )?(-? ?\$[\d,]+\.\d{2})`).exec(text);
  return m ? parseMoney(m[1].replace(/\s/g, "")) : null;
}

function toIso(year: number, monthIdx: number, day: number): string | null {
  if (monthIdx < 0 || day < 1 || day > 31) return null;
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const cents = (n: number) => Math.round(n * 100);

// Payments carry the authorization date glued onto the description ("...PYMTAuthDate 17-Jan").
function splitAuthDate(desc: string): { description: string; authDate: string | null } {
  const auth = /\s*AuthDate (\d{2}-[A-Za-z]{3})$/.exec(desc);
  return auth ? { description: desc.slice(0, auth.index), authDate: auth[1] } : { description: desc, authDate: null };
}

export const capitalOneCardParser: StatementParser = {
  id: SOURCE,
  label: "Capital One — credit card statement",

  detect(text) {
    return /capitalone\.com/i.test(text) && /days in Billing Cycle/.test(text) && /\bDate Description Amount/.test(text);
  },

  parse(pageLines, text, pages): ParserResult {
    const notes: string[] = [];
    const legacy = !CURRENT_LAYOUT_RE.test(text);
    // Older layout: read each page's left column, then its right one.
    const lines =
      legacy && pages
        ? pages.flatMap((items) => [
            ...groupItemsToLines(items.filter((it) => it.x < LEGACY_GUTTER_X)),
            ...groupItemsToLines(items.filter((it) => it.x >= LEGACY_GUTTER_X)),
          ])
        : pageLines;

    const hm = HEADER_RE.exec(text);
    const accountNumber = hm?.[2] ?? "";
    const product = hm?.[1].trim() ?? null;

    const pm = PERIOD_RE.exec(text);
    const startMonth = pm ? MONTHS.indexOf(pm[1]) : -1;
    const endMonth = pm ? MONTHS.indexOf(pm[4]) : -1;
    const endYear = pm ? Number(pm[6]) : NaN;
    const periodStart = pm ? toIso(Number(pm[3]), startMonth, Number(pm[2])) : null;
    const periodEnd = pm ? toIso(endYear, endMonth, Number(pm[5])) : null;
    if (!pm) notes.push("Could not find the billing period; dates may be missing.");
    // Rows only show "Jan 18". A month later in the year than the period's end belongs to the
    // year before (a Dec → Jan cycle, or a December purchase posting in a Jan → Feb one).
    const dateOf = (mon: string, day: string) => {
      const mi = MONTHS.indexOf(mon);
      return pm ? toIso(mi > endMonth ? endYear - 1 : endYear, mi, Number(day)) : null;
    };

    const previous = summary(text, "Previous Balance");
    const closing = summary(text, "New Balance =");
    const creditLimit = summary(text, "(?<!Advance )Credit Limit");
    const printed = {
      payments: summary(text, "Payments"),
      otherCredits: summary(text, "Other Credits"),
      transactions: summary(text, "Transactions \\+"),
      cashAdvances: summary(text, "Cash Advances \\+"),
      fees: summary(text, "Fees Charged"),
      interest: summary(text, "Interest Charged \\+"),
    };

    const txns: ParsedTxn[] = [];
    const sums: Record<Kind | "interest", number> = { credits: 0, charges: 0, fees: 0, interest: 0 };
    let kind: Kind | null = null;
    let inTable = false;
    let holder: { name: string; card: string } | null = null;
    let last: ParsedTxn | null = null; // the row a foreign-currency block would belong to
    let lastDesc = ""; // its description as printed, before any wrapped lines are added
    let wrapAt = -1; // index of the line that would continue it (older layout)
    let inInterest = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (END_RE.test(line)) break;

      const hd = HOLDER_RE.exec(line);
      if (hd) {
        holder = { name: hd[1].trim(), card: hd[2] };
        kind = hd[3] === "Transactions" ? "charges" : "credits";
        inTable = false;
        last = null;
        continue;
      }
      if (line === "Fees") {
        kind = "fees";
        holder = null;
        inTable = false;
        last = null;
        continue;
      }
      if (TABLE_HEADER_RE.test(line)) {
        inTable = kind != null;
        continue;
      }

      if (line === "Interest Charged") {
        inInterest = true;
        inTable = false;
        kind = null;
        continue;
      }
      const im = inInterest ? INTEREST_RE.exec(line) : null;
      if (im) {
        const amount = parseMoney(im[2]);
        if (amount) {
          sums.interest += amount;
          // Interest has no date of its own: it posts when the cycle closes.
          txns.push({
            dateIso: periodEnd,
            description: im[1],
            amount,
            direction: "Debit",
            raw: { line, section: "interest", source: SOURCE, account: accountNumber },
          });
        }
        last = null;
        continue;
      }

      if (!inTable || !kind) continue;
      if (SKIP_RE.test(line) || HEADER_RE.test(line) || PERIOD_RE.test(line)) continue;

      const lm = legacy ? LEGACY_TXN_RE.exec(line) : null;
      // The older layout lists every credit in its own block, so a "-" before the amount of a
      // purchase is the end of a merchant name that wrapped ("TACO PLACE - 12 -").
      if (lm?.[4] && kind === "charges") {
        lm[3] += " -";
        lm[4] = "";
      }
      const tm = lm ? [lm[0], lm[1], lm[2], "", "", lm[3], lm[4], lm[5]] : legacy ? null : TXN_RE.exec(line);
      if (tm) {
        const [, tMon, tDay, pMon, pDay, descRaw, minus, amountRaw] = tm;
        const amount = parseMoney(amountRaw);
        const direction: "Credit" | "Debit" = minus ? "Credit" : "Debit";
        const raw: Record<string, string> = { line, section: kind, source: SOURCE, account: accountNumber };
        const postDate = pMon ? dateOf(pMon, pDay) : null;
        if (postDate) raw.postDate = postDate;
        if (holder) raw.card = holder.card;
        const { description, authDate } = splitAuthDate(descRaw);
        if (authDate) raw.authDate = authDate;
        if ((kind === "credits") !== (direction === "Credit")) {
          notes.push(
            `${tMon} ${tDay} ${descRaw} ${minus ?? ""}${amountRaw}: ${direction === "Credit" ? "a credit among the charges" : "a charge among the payments and credits"} — imported as printed.`,
          );
        }
        if (amount != null) sums[kind] += direction === "Credit" ? -amount : amount;
        last = { dateIso: dateOf(tMon, tDay), description: description.trim(), amount, direction, raw };
        lastDesc = descRaw;
        wrapAt = i + 1;
        txns.push(last);
        continue;
      }

      // The three lines under a purchase made in another currency.
      if (last && FX_AMOUNT_RE.test(line) && !last.raw.foreignAmount) {
        last.raw.foreignAmount = line;
        continue;
      }
      if (last && FX_CURRENCY_RE.test(line) && last.raw.foreignAmount && !last.raw.foreignCurrency) {
        last.raw.foreignCurrency = line;
        continue;
      }
      const fx = FX_RATE_RE.exec(line);
      if (last && fx && last.raw.foreignAmount) {
        last.raw.exchangeRate = fx[1];
        continue;
      }
      // Airline tickets list the passenger and each leg under the row.
      if (last && TRAVEL_RE.test(line)) {
        last.raw.travel = last.raw.travel ? `${last.raw.travel}; ${line}` : line;
        continue;
      }
      // Older layout: the rest of a description too long for its row.
      if (legacy && last && i === wrapAt) {
        lastDesc += ` ${line}`;
        last.raw.line += ` ${line}`;
        const { description, authDate } = splitAuthDate(lastDesc);
        last.description = description.trim();
        if (authDate) last.raw.authDate = authDate;
        wrapAt = i + 1;
        continue;
      }

      notes.push(`Unparsed line: ${line}`);
    }

    // Each kind of row against the figure the summary prints for it. Credits were summed as
    // negatives, so flip them; cash advances are listed among the transactions.
    const compare = (what: string, got: number, want: number | null) => {
      if (want != null && cents(got) !== cents(want)) {
        notes.push(`${what} rows add up to ${got.toFixed(2)} but the statement shows ${want.toFixed(2)} — a row may be missing.`);
      }
    };
    if (printed.payments != null || printed.otherCredits != null) {
      compare("Payment and credit", -sums.credits, Math.abs(printed.payments ?? 0) + Math.abs(printed.otherCredits ?? 0));
    }
    if (printed.transactions != null) compare("Transaction", sums.charges, printed.transactions + (printed.cashAdvances ?? 0));
    compare("Fee", sums.fees, printed.fees);
    compare("Interest", sums.interest, printed.interest);

    const net = sums.credits + sums.charges + sums.fees + sums.interest;
    const reconciled = previous != null && closing != null ? cents(previous + net) === cents(closing) : null;

    return {
      meta: {
        accountNumber,
        accountLabel: product,
        institution: "Capital One",
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

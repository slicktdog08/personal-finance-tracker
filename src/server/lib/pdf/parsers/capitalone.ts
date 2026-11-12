// Parser for the Capital One 360 bank statement PDF (checking + savings). One statement
// covers EVERY deposit account the customer holds, so this parser returns one result per
// account section rather than one per file.
//
// Layout, after lines.ts has rebuilt the visual lines:
//
//   STATEMENT PERIOD
//   Oct 1 - Oct 31, 2026
//   ...account summary page...
//   Everyday - 12345678901            <- section header: "<nickname> - <full account number>"
//   360 CHECKING                      <- product line (absent when the nickname already is one)
//   0.10% $1.26 31                    <- APY / YTD interest / days in cycle
//   ANNUAL PERCENTAGE YIELD ...
//   DATE DESCRIPTION CATEGORY AMOUNT BALANCE
//   Oct 1 Opening Balance $500.00
//   Oct 2 Deposit from ACME CORP PAYROLL Credit + $2,000.00 $2,500.00
//   Oct 3 Debit Card Purchase - COFFEE SHOP ANYTOWN CA Debit - $4.50 $2,495.50
//   Debit Card Purchase - LONG MERCHANT NAME ANYTOWN      <- a wrapped description: its first
//   Oct 4 Debit - $20.00 $2,475.50                           line sits above the amount row and
//   CA                                                       the rest below it
//   Oct 31 Closing Balance $2,475.50
//
// Every row carries the running balance, so each transaction is checked against it — a
// mis-signed or dropped row shows up as a parser note instead of a silent drift.
import { parseMoney } from "@/server/lib/money";
import { last4 } from "@/server/lib/import-map";
import type { ParserResult, ParsedTxn, StatementParser } from "@/server/lib/pdf/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON = `(${MONTHS.join("|")})`;
const MONEY = String.raw`-?\$-?[\d,]+\.\d{2}`;

// "Oct 1 - Oct 31, 2026" or, across a year end, "Dec 15, 2025 - Jan 14, 2026".
const PERIOD_RE = new RegExp(String.raw`\b${MON} (\d{1,2})(?:, (\d{4}))? - ${MON} (\d{1,2}), (\d{4})\b`);
// "<nickname> - <8+ digit account number>" — confirmed as a section by the APY block below it.
const SECTION_RE = /^(.+?) - (\d{8,17})$/;
const PRODUCT_RE = /^(?:360 )?(?:PERFORMANCE )?(CHECKING|SAVINGS|MONEY MARKET|KIDS SAVINGS|CD)\b/i;
const TABLE_HEADER_RE = /^DATE DESCRIPTION CATEGORY AMOUNT BALANCE$/;
const PAGE_FOOTER_RE = /^Page \d+ of \d+$/;
const OPEN_RE = new RegExp(String.raw`^${MON} (\d{1,2}) Opening Balance (${MONEY})$`);
const CLOSE_RE = new RegExp(String.raw`^${MON} (\d{1,2}) Closing Balance (${MONEY})$`);
// "<Mon> <d> [description] Credit|Debit +|- $amount $balance". The description is empty
// when it wrapped onto the lines around the row.
const TXN_RE = new RegExp(
  String.raw`^${MON} (\d{1,2})(?: (.*?))? (Credit|Debit) ([+-]) \$([\d,]+\.\d{2}) (${MONEY})$`,
);

function toIso(year: number, monthIdx: number, day: number): string | null {
  if (day < 1 || day > 31) return null;
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function accountTypeOf(product: string | null, name: string): string {
  const s = `${product ?? ""} ${name}`;
  if (/checking/i.test(s)) return "Checking";
  if (/savings|money market|\bCD\b/i.test(s)) return "Savings";
  return "Checking";
}

interface Section {
  name: string;
  accountNumber: string;
  product: string | null;
  opening: number | null;
  closing: number | null;
  txns: ParsedTxn[];
  notes: string[];
}

interface OpenTxn {
  txn: ParsedTxn;
  prefix: string[];
  inline: string;
  suffix: string[];
  owed: number; // wrapped-description lines still expected below the amount row
}

export const capitalOneParser: StatementParser = {
  id: "capitalone-360",
  label: "Capital One — 360 bank statement",

  detect(text) {
    return /capitalone\.com/i.test(text) && /STATEMENT PERIOD/.test(text) && /Opening Balance/.test(text);
  },

  parse(lines, text): ParserResult[] {
    const pm = PERIOD_RE.exec(text);
    const endMonth = pm ? MONTHS.indexOf(pm[4]) : -1;
    const endYear = pm ? Number(pm[6]) : NaN;
    const startMonth = pm ? MONTHS.indexOf(pm[1]) : -1;
    const startYear = pm ? (pm[3] ? Number(pm[3]) : startMonth > endMonth ? endYear - 1 : endYear) : NaN;
    const periodStart = pm ? toIso(startYear, startMonth, Number(pm[2])) : null;
    const periodEnd = pm ? toIso(endYear, endMonth, Number(pm[5])) : null;
    // Rows only show "Oct 2": a month later in the year than the period's end belongs to
    // the year before (a statement running Dec → Jan).
    const dateOf = (mon: string, day: string) => {
      const mi = MONTHS.indexOf(mon);
      if (!pm) return null;
      return toIso(mi > endMonth ? endYear - 1 : endYear, mi, Number(day));
    };

    const sections: Section[] = [];
    let cur: Section | null = null;
    let inTable = false;
    let pending: string[] = []; // unmatched lines inside the table since the last row
    let open: OpenTxn | null = null;
    let running: number | null = null;

    const finish = (t: OpenTxn) => {
      t.txn.description = [...t.prefix, t.inline, ...t.suffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      t.txn.raw.line = t.txn.description;
    };
    // Close out the table area (page footer or closing balance): leftover lines are the tail
    // of the last wrapped description; anything beyond what it is owed gets reported.
    const flush = () => {
      if (open) {
        const take = pending.splice(0, open.owed);
        open.suffix.push(...take);
        open.owed = Math.max(0, open.owed - take.length);
        finish(open);
        if (open.owed === 0) open = null;
      }
      for (const l of pending) cur?.notes.push(`Unparsed line: ${l}`);
      pending = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const sm = SECTION_RE.exec(line);
      if (sm && lines.slice(i + 1, i + 5).some((l) => /ANNUAL PERCENTAGE YIELD/.test(l))) {
        flush();
        if (open) finish(open);
        open = null;
        inTable = false;
        const next = lines[i + 1] ?? "";
        cur = {
          name: sm[1].trim(),
          accountNumber: sm[2],
          product: PRODUCT_RE.test(next) && !/%/.test(next) ? next : null,
          opening: null,
          closing: null,
          txns: [],
          notes: [],
        };
        sections.push(cur);
        running = null;
        continue;
      }
      if (!cur) continue;

      if (TABLE_HEADER_RE.test(line)) {
        inTable = true;
        continue;
      }
      if (PAGE_FOOTER_RE.test(line)) {
        if (inTable) flush();
        inTable = false;
        continue;
      }
      if (!inTable) continue;

      const om = OPEN_RE.exec(line);
      if (om) {
        cur.opening = parseMoney(om[3]);
        running = cur.opening;
        continue;
      }
      const cm = CLOSE_RE.exec(line);
      if (cm) {
        flush();
        if (open) finish(open);
        open = null;
        cur.closing = parseMoney(cm[3]);
        if (running != null && cur.closing != null && Math.abs(running - cur.closing) > 0.005) {
          cur.notes.push(
            `Rows add up to ${running.toFixed(2)} but the statement closes at ${cur.closing.toFixed(2)} — a row may be missing.`,
          );
        }
        inTable = false;
        continue;
      }

      const tm = TXN_RE.exec(line);
      if (!tm) {
        pending.push(line);
        continue;
      }

      // Lines between two rows: the previous wrapped row's tail first, then this row's head.
      if (open) {
        const tail = pending.splice(0, open.owed);
        open.suffix.push(...tail);
        finish(open);
      }
      const [, mon, day, inlineRaw, kind, sign, amountRaw, balanceRaw] = tm;
      const inline = (inlineRaw ?? "").trim();
      const prefix = pending;
      pending = [];

      const dateIso = dateOf(mon, day);
      const amount = parseMoney(amountRaw);
      const balance = parseMoney(balanceRaw);
      const direction: "Credit" | "Debit" = kind === "Credit" ? "Credit" : "Debit";
      if ((direction === "Credit") !== (sign === "+")) {
        cur.notes.push(`Sign disagrees with ${kind} on ${mon} ${day} ${amountRaw}; used ${kind}.`);
      }
      if (running != null && amount != null && balance != null) {
        const expected = running + (direction === "Credit" ? amount : -amount);
        if (Math.abs(expected - balance) > 0.005) {
          cur.notes.push(
            `Running balance off on ${mon} ${day} ($${amountRaw}): expected ${expected.toFixed(2)}, statement shows ${balance.toFixed(2)}.`,
          );
        }
      }
      if (balance != null) running = balance;

      const txn: ParsedTxn = {
        dateIso,
        description: inline,
        amount: amount == null ? null : Math.abs(amount),
        direction,
        raw: { line, balance: balanceRaw, source: "capitalone-360", account: last4(cur.accountNumber) },
      };
      cur.txns.push(txn);
      // A wrapped description is split around the amount row; expect as many lines below
      // as there were above (or one, when the row itself carries no description at all).
      open = { txn, prefix, inline, suffix: [], owed: prefix.length || (inline ? 0 : 1) };
      finish(open);
      if (open.owed === 0) open = null;
    }
    flush();
    if (open) finish(open);

    return sections.map((s) => ({
      meta: {
        accountNumber: last4(s.accountNumber),
        accountLabel: s.name,
        institution: "Capital One",
        accountType: accountTypeOf(s.product, s.name),
        openingBalance: s.opening,
        closingBalance: s.closing,
        periodStart,
        periodEnd,
      },
      txns: s.txns,
      notes: [...(pm ? [] : ["Could not find the statement period; dates may be wrong."]), ...s.notes],
    }));
  },
};

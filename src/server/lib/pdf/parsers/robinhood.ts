// Parser for the Robinhood "Spending Statement" PDF. This is the template to copy for
// every new statement format: a `detect` sniff + a `parse` that scrapes the header for
// metadata and walks the reconstructed lines for transactions.
import { parseMoney } from "@/server/lib/money";
import { last4 } from "@/server/lib/import-map";
import type { ParserResult, ParsedTxn, StatementParser } from "@/server/lib/pdf/types";

// MM-DD-YYYY -> ISO YYYY-MM-DD (Robinhood's date format). Range-validated so a stray
// regex match (e.g. "13-45-2026") can't slip an impossible date into the DB.
function mdyToIso(mm: string, dd: string, yyyy: string): string | null {
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// A transaction row looks like:
//   <description> <TYPE> <MM-DD-YYYY> <credit-or--> <debit-or-->
// e.g. "COFFEE SHOP ANYTOWN, CA CARD 05-01-2026 -- $17.31"
//      "ACME CORP PAYROLL NOA 05-06-2026 $612.40 --"
// The lazy description + end anchor make the trailing structure (type, date, two money
// columns) unambiguous even though descriptions contain capitalized words and commas.
const TXN_RE =
  /^(.+?)\s+([A-Z]{2,6})\s+(\d{2})-(\d{2})-(\d{4})\s+(--|\$[\d,]+\.\d{2})\s+(--|\$[\d,]+\.\d{2})\s*$/;

// A line that clearly carries a transaction (a date + a dollar amount) but didn't match
// TXN_RE — surfaced as a note so unhandled variants are visible, not silently dropped.
const LOOKS_TXN_RE = /\d{2}-\d{2}-\d{4}.*\$[\d,]+\.\d{2}/;

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[1] : null;
}

export const robinhoodParser: StatementParser = {
  id: "robinhood-spending",
  label: "Robinhood — Spending Statement",

  detect(text) {
    return /robinhood/i.test(text) && /spending\s+(statement|account)/i.test(text);
  },

  parse(lines, text): ParserResult {
    const notes: string[] = [];

    // ---- header metadata ----
    const acctRaw = firstMatch(text, /ACCOUNT NUMBER\s+(\d{4,})/);
    const opening = parseMoney(firstMatch(text, /OPENING BALANCE\s+\$?([\d,]+\.\d{2})/) ?? "");
    const closing = parseMoney(firstMatch(text, /CLOSING BALANCE\s+\$?([\d,]+\.\d{2})/) ?? "");

    const psMatch = /PERIOD START\s+(\d{2})-(\d{2})-(\d{4})/.exec(text);
    const peMatch = /PERIOD END\s+(\d{2})-(\d{2})-(\d{4})/.exec(text);
    const periodStart = psMatch ? mdyToIso(psMatch[1], psMatch[2], psMatch[3]) : null;
    const periodEnd = peMatch ? mdyToIso(peMatch[1], peMatch[2], peMatch[3]) : null;

    // ---- transactions ----
    const txns: ParsedTxn[] = [];
    for (const line of lines) {
      const m = TXN_RE.exec(line);
      if (!m) {
        if (LOOKS_TXN_RE.test(line) && !/CREDIT\s+DEBIT/i.test(line)) {
          notes.push(`Unparsed line: ${line}`);
        }
        continue;
      }
      const [, descRaw, type, mm, dd, yyyy, credit, debit] = m;
      const dateIso = mdyToIso(mm, dd, yyyy);
      if (!dateIso) {
        notes.push(`Skipped (invalid date): ${line}`);
        continue;
      }
      const isCredit = credit !== "--";
      const moneyStr = isCredit ? credit : debit;
      const amount = parseMoney(moneyStr);
      if (amount == null || moneyStr === "--") {
        notes.push(`Skipped (no amount): ${line}`);
        continue;
      }
      txns.push({
        dateIso,
        description: descRaw.replace(/\s+/g, " ").trim(),
        amount: Math.abs(amount),
        direction: isCredit ? "Credit" : "Debit",
        raw: { line, type, credit, debit, source: "robinhood-spending" },
      });
    }

    if (txns.length === 0) notes.push("No transactions matched the Robinhood row pattern.");

    return {
      meta: {
        accountNumber: acctRaw ? last4(acctRaw) : "",
        institution: "Robinhood",
        accountType: "Checking", // Spending = a cash account; tracked as cash-on-hand
        openingBalance: opening,
        closingBalance: closing,
        periodStart,
        periodEnd,
      },
      txns,
      notes,
    };
  },
};

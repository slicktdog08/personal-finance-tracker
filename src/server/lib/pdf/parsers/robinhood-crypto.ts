// Parser for the Robinhood "Crypto Statement" PDF.
//
// A crypto account holds coins, not dollars: its opening/closing "balance" is the market value
// of the coins, and every row of its activity table is a trade (coins in, coins out) whose cash
// side lives on the brokerage statement. So this parser records the account's VALUE over time,
// returns the activity as `trades` (→ investment_trades) and the coins held at the close as
// `positions`, and imports no transactions — a coin purchase is not spending, a sale not income.
// See planning/features/pdf-import.md ("Investment statements").
import { parseMoney } from "@/server/lib/money";
import { last4 } from "@/server/lib/import-map";
import type { ParserResult, ParsedPosition, ParsedTrade, StatementParser } from "@/server/lib/pdf/types";

const NUM = String.raw`[\d,]*\.?\d+`;
// "$0", "$1,234.56" — whole-dollar amounts are printed without cents.
const MONEY = String.raw`\$(${NUM})`;
// DATE | TRANSACTION TYPE | DEBIT | CREDIT | PRICE | VALUE [| FEE], "--" in an empty column.
// Coins under CREDIT arrived; coins under DEBIT left:
//   2026-05-03 Crypto Purchase -- 0.5 ABC $2,000.00 $1,000.00 --
//   2026-05-09 Crypto Sale 0.1 ABC -- $2,100.00 $210.00 --
const TRADE_RE = new RegExp(
  String.raw`^(\d{4}-\d{2}-\d{2})\s+Crypto\s+(\w+)\s+(--\s+)?(${NUM})\s+([A-Z0-9]+)(?:\s+--)?((?:\s+\$${NUM})*)(?:\s+--)?\s*$`,
  "i",
);
const LOOKS_TRADE_RE = /^\d{4}-\d{2}-\d{2}\s+Crypto\b/i;
// Bitcoin 0.5 BTC $1,000.00 100%   ·   a value under a cent prints as "$<0.01*"
const HOLDING_RE = new RegExp(String.raw`^(.+?)\s+(${NUM})\s+([A-Z0-9]+)\s+\$(<?)(${NUM})\*?\s+<?[\d.]+\*?%$`);
const num = (s: string) => Number(s.replace(/,/g, ""));

function isoDate(text: string, label: string): string | null {
  const m = new RegExp(`${label}\\s+(\\d{4})-(\\d{2})-(\\d{2})`).exec(text);
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export const robinhoodCryptoParser: StatementParser = {
  id: "robinhood-crypto",
  label: "Robinhood — Crypto Statement",

  detect(text) {
    return /^Crypto Statement$/m.test(text) && /robinhood crypto/i.test(text);
  },

  parse(lines, text): ParserResult {
    const notes: string[] = [];
    // "RHS ACCOUNT NUMBER" is the linked brokerage account — anchor to the line start to skip it.
    // Older statements print ONLY the brokerage number, under the plain "ACCOUNT NUMBER" label.
    // Using it would file the coins' value onto the brokerage account, so leave the account
    // blank and let the reviewer pick the crypto account.
    const hasOwnNumber = /^RHS ACCOUNT NUMBER\s+\d/m.test(text);
    const acct = hasOwnNumber ? /^ACCOUNT NUMBER\s+(\d{4,})/m.exec(text) : null;
    if (!hasOwnNumber) {
      notes.push(
        "This older statement doesn't print the crypto account's own number — choose the crypto account before importing.",
      );
    }
    const money = (label: string) => parseMoney(new RegExp(`${label}\\s+${MONEY}`).exec(text)?.[1] ?? "");

    const trades: ParsedTrade[] = [];
    const positions: ParsedPosition[] = [];
    let inHoldings = false;
    for (const line of lines) {
      if (/^CRYPTOCURRENCY HELD IN ACCOUNT/i.test(line)) {
        inHoldings = true;
        continue;
      }
      const t = TRADE_RE.exec(line);
      if (t) {
        const [, dateIso, action, arrived, qty, symbol, moneyList] = t;
        const figures = [...moneyList.matchAll(new RegExp(MONEY, "g"))].map((m) => num(m[1]));
        // PRICE then VALUE; a row with a single figure carries only its value.
        const price = figures.length >= 2 ? figures[0] : null;
        const value = figures.length >= 2 ? figures[1] : (figures[0] ?? null);
        const kind = /^purchase$/i.test(action) ? "buy" : /^sale$/i.test(action) ? "sell" : "other";
        trades.push({
          dateIso,
          kind,
          action,
          assetClass: "crypto",
          symbol,
          name: symbol,
          quantity: arrived ? num(qty) : -num(qty),
          price,
          // A transfer of coins moves no cash; only a purchase or sale has a cash side.
          amount: kind === "other" ? null : value,
          direction: kind === "buy" ? "Debit" : kind === "sell" ? "Credit" : null,
        });
        continue;
      }
      if (LOOKS_TRADE_RE.test(line)) {
        notes.push(`Unparsed line: ${line}`);
        continue;
      }
      const h = inHoldings ? HOLDING_RE.exec(line) : null;
      if (h) {
        positions.push({
          assetClass: "crypto",
          symbol: h[3],
          name: h[1],
          quantity: num(h[2]),
          price: null,
          marketValue: h[4] ? 0 : num(h[5]),
        });
      }
    }

    return {
      meta: {
        accountNumber: acct ? last4(acct[1]) : "",
        accountLabel: "Crypto",
        institution: "Robinhood",
        accountType: "Investment",
        openingBalance: money("OPENING BALANCE"),
        closingBalance: money("CLOSING BALANCE"),
        periodStart: isoDate(text, "PERIOD START"),
        periodEnd: isoDate(text, "PERIOD END"),
      },
      txns: [],
      trades,
      positions,
      // A market value moves with prices, so there is nothing for the activity to add up to.
      reconciled: null,
      notes,
    };
  },
};

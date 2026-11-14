// Parser for the Robinhood brokerage ("Individual" / investing) monthly statement.
//
// Two things make this unlike a bank statement:
//
// 1. Its tables print ONE amount per row, under either the Debit or the Credit heading, with
//    no placeholder in the empty column. Once the text is flattened to lines the two are
//    indistinguishable, so this parser reads the raw positioned text and assigns every cell
//    to the column heading it sits under.
//
// 2. The "Account Activity" table mixes two kinds of row. Cash events — card purchases,
//    transfers, fees, dividends, interest — are ordinary transactions. Trades (a quantity of
//    a security bought or sold) and moves to the crypto account swap cash for holdings INSIDE
//    the investment account: they change neither net worth nor spending, so they are returned
//    as `trades` (→ investment_trades), never as transactions. The account's balance is its
//    Portfolio Value (cash + securities); what it held at the close comes back as `positions`.
//
// See planning/features/pdf-import.md ("Investment statements").
import { parseMoney } from "@/server/lib/money";
import { last4 } from "@/server/lib/import-map";
import type { TradeKind } from "@/constants/enums";
import type { PositionedItem } from "@/server/lib/pdf/lines";
import type {
  ParserResult,
  ParsedPosition,
  ParsedTrade,
  ParsedTxn,
  StatementParser,
} from "@/server/lib/pdf/types";

const SOURCE = "robinhood-brokerage";
const MONEY = String.raw`\(?\$[\d,]+\.\d{2}\)?`;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const PERIOD_RE = /(\d{2})\/(\d{2})\/(\d{4}) to (\d{2})\/(\d{2})\/(\d{4})/;
// "10", "0.752788", "1,200", and "5S" — the S marks a quantity leaving the account.
const QTY_RE = /^([\d,]*\.?\d+)(S?)$/;
// An option contract is named by its underlying, expiry, side and strike.
const OPTION_RE = /\b\d{2}\/\d{2}\/\d{4}\s+(Call|Put)\b/i;
// Cash sent to / returned from the crypto account. No quantity, but still a move between two
// pockets of the same investments rather than money in or out.
const INTERNAL_CODES = new Set(["COIN"]);
const BUY_CODES = new Set(["BUY", "BTO", "BTOX", "BTC", "BTCX"]);
const SELL_CODES = new Set(["SELL", "STC", "STCX", "STO", "STOX"]);

const SAME_ROW = 2; // baseline jitter between cells of one row
// A multi-line description is centred on its row, so its lines sit a few points above and
// below the row's baseline. Rows are ~25pt apart; half of that keeps neighbours separate.
const DESC_REACH = 12;
const COL_SLACK = 4; // a cell may start a hair left of its heading

function mdyToIso(mm: string, dd: string, yyyy: string): string | null {
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function parseQty(raw: string): number | null {
  const m = QTY_RE.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[2] ? -n : n;
}

// ---- positioned tables -------------------------------------------------------------------

interface Column {
  name: string;
  x: number;
}

interface TableSpec {
  /** A heading cell that identifies the table's heading row. */
  key: string;
  /** Headings that must all be present on that row. */
  required: string[];
  /** Headings that mark a look-alike table to leave alone. */
  reject?: RegExp;
  /** The column whose cell marks a data row, and what that cell looks like. */
  anchor: string;
  anchorRe: RegExp;
  /** First cell of the totals row that closes the table. */
  end: RegExp;
  /** Description lines that are not part of the name. */
  dropDescription: RegExp;
}

interface TableRow {
  description: string;
  cell: (name: string) => string;
}

interface Table {
  found: boolean;
  rows: TableRow[];
  /** Amount on the totals row under a given heading; null when the table had no totals row. */
  total: ((name: string) => number | null) | null;
}

function findHeader(items: PositionedItem[], spec: TableSpec): { y: number; cols: Column[] } | null {
  for (const k of items) {
    if (k.str.trim().toLowerCase() !== spec.key) continue;
    const row = items.filter((i) => Math.abs(i.y - k.y) <= SAME_ROW);
    const names = row.map((i) => i.str.trim().toLowerCase());
    if (spec.reject && names.some((n) => spec.reject!.test(n))) continue;
    if (!spec.required.every((n) => names.includes(n))) continue;
    const cols = row.map((i) => ({ name: i.str.trim().toLowerCase(), x: i.x })).sort((a, b) => a.x - b.x);
    return { y: k.y, cols };
  }
  return null;
}

function columnOf(cols: Column[], x: number): string {
  let name = cols[0].name;
  for (const c of cols) {
    if (c.x <= x + COL_SLACK) name = c.name;
    else break;
  }
  return name;
}

// Read one table: find its heading row, take each heading's x as the start of its column, and
// build a row around every cell that matches the anchor. The leftmost column is the
// description; its lines are attached to the nearest row.
function readTable(pages: PositionedItem[][], spec: TableSpec): Table {
  const out: Table = { found: false, rows: [], total: null };
  let cols: Column[] | null = null;

  for (const items of pages) {
    // The heading repeats when the table runs onto another page; without one, a continuation
    // page keeps the columns of the page before.
    const header = findHeader(items, spec);
    if (header) cols = header.cols;
    if (!cols) continue;
    out.found = true;
    const columns = cols;
    const top = header ? header.y - SAME_ROW : Infinity;
    const total = items.find((i) => spec.end.test(i.str.trim()) && i.y < top);
    const bottom = total ? total.y + SAME_ROW : -Infinity;
    const region = items.filter((i) => i.y < top && i.y > bottom);

    const anchors = region
      .filter((i) => columnOf(columns, i.x) === spec.anchor && spec.anchorRe.test(i.str.trim()))
      .sort((a, b) => b.y - a.y);
    const descName = columns[0].name;
    const descParts = new Map<PositionedItem, PositionedItem[]>(anchors.map((a) => [a, []]));
    for (const i of region) {
      if (columnOf(columns, i.x) !== descName) continue;
      let best: PositionedItem | null = null;
      for (const a of anchors) {
        if (!best || Math.abs(a.y - i.y) < Math.abs(best.y - i.y)) best = a;
      }
      if (best && Math.abs(best.y - i.y) <= DESC_REACH) descParts.get(best)!.push(i);
    }

    for (const a of anchors) {
      const cells = region.filter((i) => Math.abs(i.y - a.y) <= SAME_ROW);
      out.rows.push({
        description: descParts
          .get(a)!
          .sort((p, q) => q.y - p.y || p.x - q.x)
          .map((i) => i.str.trim())
          .filter((s) => !spec.dropDescription.test(s))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        cell: (name) =>
          cells
            .filter((i) => columnOf(columns, i.x) === name)
            .sort((p, q) => p.x - q.x)
            .map((i) => i.str.trim())
            .join(" "),
      });
    }

    if (total) {
      const onTotal = items.filter((i) => Math.abs(i.y - total.y) <= SAME_ROW);
      out.total = (name) =>
        parseMoney(onTotal.find((i) => columnOf(columns, i.x) === name && /\$/.test(i.str))?.str ?? "");
      break; // the table is complete; later pages hold other tables
    }
  }
  return out;
}

// "Description [Symbol] Acct Type Transaction Date Qty Price Debit Credit". The statement has
// two look-alike tables that must not match — trades pending settlement (Trade Date / Settle
// Date) and deposit-sweep activity (a Balance column).
const ACTIVITY: TableSpec = {
  key: "description",
  required: ["transaction", "date", "debit", "credit"],
  reject: /settle|trade date|balance/,
  anchor: "date",
  anchorRe: DATE_RE,
  end: /^Total Funds Paid and Received/i,
  // The security's identifier line ("CUSIP: …", "Unsolicited, CUSIP: …") is not a name.
  dropDescription: /CUSIP:/i,
};

// "Securities Held in Account | Sym/Cusip | Acct Type | Qty | Price | Mkt Value | …"
const HOLDINGS: TableSpec = {
  key: "sym/cusip",
  required: ["qty", "price", "mkt value"],
  anchor: "qty",
  anchorRe: QTY_RE,
  end: /^Total Securities/i,
  dropDescription: /^Estimated Yield/i,
};

const EMPTY: Table = { found: false, rows: [], total: null };
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const cents = (n: number) => Math.round(n * 100);
const assetClassOf = (name: string) => (OPTION_RE.test(name) ? ("option" as const) : ("equity" as const));

export const robinhoodBrokerageParser: StatementParser = {
  id: SOURCE,
  label: "Robinhood — Brokerage Statement",

  detect(text) {
    return (
      /robinhood/i.test(text) &&
      /Portfolio Value/.test(text) &&
      /Account Summary/i.test(text) &&
      PERIOD_RE.test(text)
    );
  },

  parse(_lines, text, pages): ParserResult {
    const notes: string[] = [];

    // ---- header ----
    // The cash-management routing number ("… ACH Account #:") is a different number for the
    // same account; the brokerage number is the one that identifies it on every statement.
    const acct = /(?<!ACH )Account #:\s*\**(\d{4,})/.exec(text);
    const p = PERIOD_RE.exec(text);
    const value = new RegExp(`Portfolio Value\\s+(N/A|${MONEY})\\s+(${MONEY})`).exec(text);

    if (!pages) notes.push("This statement needs positioned text to read its tables; none was supplied.");
    const activity = pages ? readTable(pages, ACTIVITY) : EMPTY;
    const holdings = pages ? readTable(pages, HOLDINGS) : EMPTY;

    // ---- activity: cash events → transactions, holdings movements → trades ----
    const txns: ParsedTxn[] = [];
    const trades: ParsedTrade[] = [];
    let sumDebit = 0;
    let sumCredit = 0;
    for (const r of activity.rows) {
      const d = DATE_RE.exec(r.cell("date"))!;
      const dateIso = mdyToIso(d[1], d[2], d[3]);
      const code = r.cell("transaction");
      const symbol = r.cell("symbol");
      const debit = parseMoney(r.cell("debit"));
      const credit = parseMoney(r.cell("credit"));
      sumDebit += debit ?? 0;
      sumCredit += credit ?? 0;
      const amount = debit ?? credit;
      const direction = debit != null ? ("Debit" as const) : credit != null ? ("Credit" as const) : null;
      const twoSided = debit != null && credit != null;

      const qtyRaw = r.cell("qty");
      const internal = INTERNAL_CODES.has(code.toUpperCase());
      if (qtyRaw !== "" || internal) {
        const upper = code.toUpperCase();
        const kind: TradeKind = BUY_CODES.has(upper) ? "buy" : SELL_CODES.has(upper) ? "sell" : "other";
        const qty = parseQty(qtyRaw);
        if (twoSided) notes.push(`Trade with both a debit and a credit, cash side dropped: ${dateIso ?? "?"} ${r.description}`);
        trades.push({
          dateIso,
          kind,
          action: code,
          assetClass: internal ? "cash" : assetClassOf(r.description),
          symbol: symbol || null,
          name: r.description || symbol || code,
          // A sale's quantity leaves the account whether or not the statement marks it.
          quantity: qty == null ? null : kind === "sell" ? -Math.abs(qty) : qty,
          price: parseMoney(r.cell("price")),
          amount: twoSided || amount == null ? null : Math.abs(amount),
          direction: twoSided ? null : direction,
        });
        continue;
      }
      if (amount == null || twoSided) {
        notes.push(`Skipped (no single amount): ${dateIso ?? "?"} ${r.description} ${code}`.trim());
        continue;
      }
      const raw: Record<string, string> = { source: SOURCE, type: code };
      if (symbol) raw.symbol = symbol;
      txns.push({
        dateIso,
        description: r.description || code,
        amount: Math.abs(amount),
        direction: direction!,
        raw,
      });
    }

    // The printed totals cover every activity row, trade or not, so they verify the read.
    let reconciled: boolean | null = null;
    if (activity.total) {
      const totalDebit = activity.total("debit");
      const totalCredit = activity.total("credit");
      if (totalDebit != null && totalCredit != null) {
        reconciled = cents(sumDebit) === cents(totalDebit) && cents(sumCredit) === cents(totalCredit);
        if (!reconciled) {
          notes.push(
            `Activity read as ${usd(sumDebit)} debits / ${usd(sumCredit)} credits, but the statement totals ` +
              `${usd(totalDebit)} / ${usd(totalCredit)} — some rows may have been misread.`,
          );
        }
      }
    }

    // ---- holdings at the close ----
    const positions: ParsedPosition[] = [];
    for (const r of holdings.rows) {
      const quantity = parseQty(r.cell("qty"));
      if (quantity == null) continue;
      const symbol = r.cell("sym/cusip");
      positions.push({
        assetClass: assetClassOf(r.description),
        symbol: symbol || null,
        name: r.description || symbol,
        quantity,
        price: parseMoney(r.cell("price")),
        marketValue: parseMoney(r.cell("mkt value")),
      });
    }
    const totalHeld = holdings.total ? holdings.total("mkt value") : null;
    const sumHeld = positions.reduce((n, x) => n + (x.marketValue ?? 0), 0);
    if (totalHeld != null && cents(sumHeld) !== cents(totalHeld)) {
      notes.push(
        `Holdings read as ${usd(sumHeld)}, but the statement totals ${usd(totalHeld)} — some may have been misread.`,
      );
      if (reconciled !== null) reconciled = false;
    }

    return {
      meta: {
        accountNumber: acct ? last4(acct[1]) : "",
        accountLabel: "Brokerage",
        institution: "Robinhood",
        accountType: "Investment",
        openingBalance: value && value[1] !== "N/A" ? parseMoney(value[1]) : null,
        closingBalance: value ? parseMoney(value[2]) : null,
        periodStart: p ? mdyToIso(p[1], p[2], p[3]) : null,
        periodEnd: p ? mdyToIso(p[4], p[5], p[6]) : null,
      },
      txns,
      trades,
      positions,
      reconciled,
      notes,
    };
  },
};

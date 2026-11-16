// Shared types for the PDF-statement import flow. Split into client-safe data types
// (serializable; importable from client components via `import type`) and the
// server-only parser interface (carries functions). Types are erased at compile time,
// so importing this from a client component pulls in no runtime code.

import type { PreviewRow } from "@/server/lib/import-types";
import type { PositionedItem } from "@/server/lib/pdf/lines";
import type { AssetClass, TradeKind } from "@/constants/enums";

// One transaction as pulled straight out of a statement, before dedup/DB work.
export interface ParsedTxn {
  dateIso: string | null;
  description: string;
  amount: number | null; // absolute value
  direction: "Debit" | "Credit";
  raw: Record<string, string>;
}

// A holdings movement on an investment statement — a buy, a sale, an option expiring, coins
// withdrawn. Stored in investment_trades, never in transactions: it is not spending or income.
export interface ParsedTrade {
  dateIso: string | null;
  kind: TradeKind;
  /** The statement's own word for it ("Buy", "STC", "OEXP", "Purchase"). */
  action: string;
  assetClass: AssetClass;
  symbol: string | null;
  name: string;
  /** Signed: negative when the holding left the account. Null for a cash-only move. */
  quantity: number | null;
  price: number | null;
  /** The cash side, absolute; null when no cash moved (an expiry, a reward share). */
  amount: number | null;
  direction: "Debit" | "Credit" | null;
}

// One holding at the statement's close.
export interface ParsedPosition {
  assetClass: AssetClass;
  symbol: string | null;
  name: string;
  quantity: number;
  price: number | null;
  marketValue: number | null;
}

// Header/summary facts a statement exposes.
export interface StatementMeta {
  accountNumber: string; // last-4 (may be "")
  /** The account's name on the statement, when one PDF covers several accounts. */
  accountLabel?: string | null;
  institution: string | null;
  accountType: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** A credit card's limit as of the statement's close, when the statement prints one. */
  creditLimit?: number | null;
  /** A loan's or card's APR in percent (20.5), when the statement prints one. */
  apr?: number | null;
  /** The minimum / scheduled payment as of the statement's close. */
  minPayment?: number | null;
  /** Extra wording for the closing snapshot's note, e.g. a loan's "principal $4,000.00". */
  balanceDetail?: string | null;
  periodStart: string | null; // ISO
  periodEnd: string | null; // ISO
}

// A balance as of the end of one day.
export interface DailyBalance {
  asOf: string; // ISO
  balance: number;
}

// What a single issuer parser returns.
export interface ParserResult {
  meta: StatementMeta;
  txns: ParsedTxn[];
  /** End-of-day balances, for statements that print a running balance on every row. */
  dailyBalances?: DailyBalance[];
  /** Holdings movements (investment statements only). */
  trades?: ParsedTrade[];
  /** Holdings at the period's end (investment statements only). */
  positions?: ParsedPosition[];
  /**
   * The parser's own verdict on whether the statement adds up, for formats where the generic
   * check (opening + credits − debits == closing) can't apply — a credit card's balances are
   * amounts owed, so charges raise them and payments lower them; a brokerage statement's
   * balance is a market value, checked against its printed totals instead. Omit to get the
   * generic check; null = nothing to check against.
   */
  reconciled?: boolean | null;
  notes: string[]; // warnings, e.g. lines that looked transaction-like but didn't parse
}

// A registered parser for one statement format. Adding support for a new bank = one
// of these. `detect` is a cheap text sniff; `parse` does the real work over the
// reconstructed lines (full text also provided for header scraping). A statement that
// covers several accounts (e.g. a bank's combined checking + savings statement) returns
// one result per account. `pages` is the raw positioned text of each page, for tables whose
// columns only x can tell apart (one amount per row, sitting under "Debit" or "Credit").
export interface StatementParser {
  id: string;
  label: string;
  detect: (text: string) => boolean;
  parse: (lines: string[], text: string, pages?: PositionedItem[][]) => ParserResult | ParserResult[];
}

// A suggested balance snapshot to (optionally) record into account_balances. A statement
// can yield two: the opening balance (as of the day before the period starts — it is the
// balance at the end of that day) and the closing balance (period end).
export interface StatementBalance {
  kind: "opening" | "closing";
  balance: number;
  asOf: string; // ISO
  creditLimit: number | null;
  /** APR (percent) and minimum payment in force at this snapshot, when the statement prints them. */
  apr?: number | null;
  minPayment?: number | null;
  note: string;
}

// Fully analyzed statement handed to the client for review.
export interface ParsedStatement {
  filename: string;
  parserId: string | null; // null = unrecognized
  parserLabel: string;
  detected: boolean;
  pageCount: number;
  lineCount: number;

  // editable in the UI
  accountNumber: string; // last-4 (detected, user can override)
  /** Account name from the statement — set when one PDF holds several accounts. */
  accountLabel: string | null;
  institution: string | null;
  accountType: string | null;

  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string | null;
  periodEnd: string | null;

  txns: ParsedTxn[]; // raw, kept so the client can re-analyze on account change
  rows: PreviewRow[]; // analyzed (dedup + category) for the current account
  total: number;
  newCount: number;
  duplicateCount: number;
  finalizeCount?: number;
  errorCount: number;

  /** Holdings movements to record in investment_trades (deduplicated on commit). */
  trades: ParsedTrade[];
  /** Holdings at `periodEnd`, to record in investment_positions; null = not an investment statement. */
  positions: ParsedPosition[] | null;
  balanceSuggestions: StatementBalance[];
  /** End-of-day balances from the running-balance column; empty when the format has none. */
  dailyBalances: DailyBalance[];
  /** opening + credits − debits == closing (or the parser's own check); null when unknown. */
  reconciled: boolean | null;
  notes: string[];
  sampleLines: string[]; // first lines, shown when unrecognized to aid writing a parser
}

// Per-file payload sent from the browser (base64 so it serializes cleanly across the
// server-action boundary).
export interface PdfFileInput {
  name: string;
  dataB64: string;
}

// One statement the user chose to commit.
export interface CommitStatementInput {
  filename: string;
  accountNumber: string;
  accountLabel?: string | null;
  institution: string | null;
  accountType: string | null;
  rows: PreviewRow[];
  balances: StatementBalance[]; // the snapshots the user chose to record
  /** End-of-day balances to record (empty when the user turned them off). */
  dailyBalances?: DailyBalance[];
  trades?: ParsedTrade[];
  positions?: ParsedPosition[];
  /** The date the positions are as of (the statement's period end). */
  positionsAsOf?: string | null;
}

export interface PdfCommitResult {
  statements: number;
  inserted: number;
  duplicates: number;
  /** Pending rows entered by hand that these statements settled in place. */
  finalized: number;
  errors: number;
  balancesRecorded: number;
  /** Imported rows that replaced a hand-entered (pending) transaction. */
  merged: number;
  /** Imported rows a saved rule linked to a recurring bill. */
  billsLinked: number;
  /** Trades newly written to investment_trades (re-imported ones are skipped). */
  tradesRecorded: number;
  /** Holdings written to investment_positions. */
  positionsRecorded: number;
}

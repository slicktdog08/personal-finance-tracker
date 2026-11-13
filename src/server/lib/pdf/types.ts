// Shared types for the PDF-statement import flow. Split into client-safe data types
// (serializable; importable from client components via `import type`) and the
// server-only parser interface (carries functions). Types are erased at compile time,
// so importing this from a client component pulls in no runtime code.

import type { PreviewRow } from "@/server/lib/import-types";

// One transaction as pulled straight out of a statement, before dedup/DB work.
export interface ParsedTxn {
  dateIso: string | null;
  description: string;
  amount: number | null; // absolute value
  direction: "Debit" | "Credit";
  raw: Record<string, string>;
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
  notes: string[]; // warnings, e.g. lines that looked transaction-like but didn't parse
}

// A registered parser for one statement format. Adding support for a new bank = one
// of these. `detect` is a cheap text sniff; `parse` does the real work over the
// reconstructed lines (full text also provided for header scraping). A statement that
// covers several accounts (e.g. a bank's combined checking + savings statement) returns
// one result per account.
export interface StatementParser {
  id: string;
  label: string;
  detect: (text: string) => boolean;
  parse: (lines: string[], text: string) => ParserResult | ParserResult[];
}

// A suggested balance snapshot to (optionally) record into account_balances. A statement
// can yield two: the opening balance (as of the day before the period starts — it is the
// balance at the end of that day) and the closing balance (period end).
export interface StatementBalance {
  kind: "opening" | "closing";
  balance: number;
  asOf: string; // ISO
  creditLimit: number | null;
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

  balanceSuggestions: StatementBalance[];
  /** End-of-day balances from the running-balance column; empty when the format has none. */
  dailyBalances: DailyBalance[];
  /** opening + credits − debits == closing; null when either balance is missing. */
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
}

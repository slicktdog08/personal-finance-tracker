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
  institution: string | null;
  accountType: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string | null; // ISO
  periodEnd: string | null; // ISO
}

// What a single issuer parser returns.
export interface ParserResult {
  meta: StatementMeta;
  txns: ParsedTxn[];
  notes: string[]; // warnings, e.g. lines that looked transaction-like but didn't parse
}

// A registered parser for one statement format. Adding support for a new bank = one
// of these. `detect` is a cheap text sniff; `parse` does the real work over the
// reconstructed lines (full text also provided for header scraping).
export interface StatementParser {
  id: string;
  label: string;
  detect: (text: string) => boolean;
  parse: (lines: string[], text: string) => ParserResult;
}

// A suggested balance snapshot to (optionally) record into account_balances. A statement
// can yield two: the opening balance (as of period start) and the closing balance (period end).
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
  institution: string | null;
  accountType: string | null;
  rows: PreviewRow[];
  balances: StatementBalance[]; // the snapshots the user chose to record
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
}

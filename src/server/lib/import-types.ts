// Shared (serializable) types for the CSV import flow. Kept out of "use server"
// files so they can be imported by both client and server.

// "finalizes": the row is the posted version of a PENDING transaction entered by hand; on
// commit it updates that row in place instead of inserting a twin (see
// planning/features/pending-transactions.md).
export type PreviewStatus = "new" | "duplicate" | "finalizes" | "error";

export interface PreviewRow {
  dedupHash: string;
  txnDate: string; // ISO or "" on error
  description: string;
  accountNumber: string;
  category: string | null;
  /** The saved rule that picked `category` (null when none matched or the user chose it). */
  categoryRuleId?: number | null;
  amount: number | null;
  netAmount: number | null;
  direction: string;
  /**
   * The user's own commentary, typed while reviewing the import. Saved onto the
   * transaction's `notes` on commit so a charge can be explained at the moment
   * you recognize it, rather than hunted down again afterwards.
   */
  notes?: string | null;
  status: PreviewStatus;
  /** When status = "finalizes": the pending transaction this row settles. */
  pendingMatchId?: number | null;
  pendingMatchDescription?: string | null;
  /** When status = "finalizes": the pending transaction's category, which the settled row keeps. */
  pendingMatchCategory?: string | null;
  /**
   * The user picked `category` in the preview by hand. Only then does it replace the category
   * of a pending transaction this row settles or merges into; otherwise the pending one's stays.
   */
  categoryPicked?: boolean;
  error?: string;
  raw: Record<string, string>;
  /**
   * A transaction entered by hand (usually marked pending) that looks like this row before it
   * posted — same account and direction, nearby date, amount within a tip's reach. Only set
   * on "new" rows. See planning/features/pending-transactions.md.
   */
  pendingMatch?: PendingMatchInfo | null;
  /**
   * The hand-entered transaction to fold into this row on commit (its id), or null to import
   * the row alongside it. Starts as the match's id when the match is confident.
   */
  mergeWith?: number | null;
}

export interface PendingMatchInfo {
  id: number;
  txnDate: string;
  description: string;
  amount: number;
  /** The hand-entered transaction's category — kept on merge unless the user picks another. */
  category: string | null;
  /** Marked pending by the user (vs. a plain hand-entered row). */
  pending: boolean;
  score: number;
}

// A dated balance snapshot derived from a CSV's running-balance column. One per
// (account, date) — the end-of-day balance — destined for the account_balances ledger.
/**
 * The hand-entered transaction this row will settle or merge into on commit, if any: an
 * auto-matched "finalizes" row, or a "new" row with its merge box ticked.
 */
export function settlesPending(row: PreviewRow): boolean {
  if (row.status === "finalizes") return row.pendingMatchId != null;
  return row.status === "new" && row.pendingMatch != null && row.mergeWith === row.pendingMatch.id;
}

/**
 * The category a row will be saved with once it settles a pending transaction: the user's
 * pick in the preview, else the pending transaction's own category, else what the import found.
 */
export function settledCategory(row: PreviewRow): { category: string | null; categoryRuleId: number | null } {
  const own = { category: row.category, categoryRuleId: row.category ? (row.categoryRuleId ?? null) : null };
  if (!settlesPending(row) || row.categoryPicked) return own;
  const kept = row.status === "finalizes" ? row.pendingMatchCategory : row.pendingMatch?.category;
  return kept ? { category: kept, categoryRuleId: null } : own;
}

export interface BalanceSnapshot {
  accountNumber: string;
  asOf: string; // ISO date
  balance: number;
  note?: string;
}

export interface PreviewResult {
  filename: string;
  rows: PreviewRow[];
  total: number;
  newCount: number;
  duplicateCount: number;
  finalizeCount?: number;
  errorCount: number;
  balances: BalanceSnapshot[];
}

export interface CommitResult {
  inserted: number;
  duplicates: number;
  /** Pending rows entered by hand that this import settled in place. */
  finalized: number;
  errors: number;
  batchId: number | null;
  balancesRecorded: number;
  /** Imported rows that replaced a hand-entered (pending) transaction instead of duplicating it. */
  merged: number;
}

// How to map an arbitrary bank CSV's columns onto our fields.
export interface ColumnMapping {
  date: string; // header name
  description: string; // header name
  amount: string; // header name (signed ok) — used when amountMode = "single"
  netAmount?: string; // optional header name
  category?: string; // optional header name
  balanceColumn?: string; // optional: an available/running-balance column → account_balances ledger
  accountMode: "fixed" | "column";
  accountColumn?: string; // when accountMode = "column"
  fixedAccountNumber?: string; // when accountMode = "fixed" (last-4 / label number)
  // How amount + direction are laid out:
  //  - "single": one amount column; direction from its sign or a label column (directionMode).
  //  - "split":  two columns (debit / credit); whichever a row fills sets both amount & direction.
  amountMode?: "single" | "split"; // undefined ≡ "single" (back-compat)
  debitColumn?: string; // when amountMode = "split" — money out
  creditColumn?: string; // when amountMode = "split" — money in
  directionMode: "sign" | "column"; // when amountMode = "single"
  directionColumn?: string; // when directionMode = "column"
  negativeIs: "Debit" | "Credit"; // when directionMode = "sign"
}

export interface InspectResult {
  headers: string[];
  sample: Record<string, string>[];
  rowCount: number;
  suggestion: ColumnMapping;
}

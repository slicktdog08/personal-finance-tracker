import { createHash } from "crypto";

// Collapse whitespace + uppercase so trivial formatting differences don't defeat dedup.
export function normalizeDescription(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

export interface DedupParts {
  accountNumber?: string | null;
  date: string; // ISO YYYY-MM-DD
  amount: number; // absolute value
  description: string;
  direction: string; // Debit | Credit
  /**
   * 1-based occurrence index for genuinely identical rows within the same source.
   * Preserves true same-day duplicates (e.g. three identical $150 repayments) while
   * still making a re-import of the same file a no-op. See planning/features/csv-import.md.
   */
  occurrence?: number;
}

export function dedupHash(parts: DedupParts): string {
  const occ = parts.occurrence && parts.occurrence > 1 ? `#${parts.occurrence}` : "";
  const key = [
    (parts.accountNumber ?? "").trim(),
    parts.date,
    parts.amount.toFixed(2),
    normalizeDescription(parts.description),
    parts.direction.trim().toUpperCase(),
    occ,
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

// Assign occurrence indexes to a list of rows so identical rows get #1, #2, ...
// Returns dedup hashes in the same order as the input rows.
export function hashRows(rows: Omit<DedupParts, "occurrence">[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [
      (r.accountNumber ?? "").trim(),
      r.date,
      r.amount.toFixed(2),
      normalizeDescription(r.description),
      r.direction.trim().toUpperCase(),
    ].join("|");
    const next = (seen.get(base) ?? 0) + 1;
    seen.set(base, next);
    return dedupHash({ ...r, occurrence: next });
  });
}

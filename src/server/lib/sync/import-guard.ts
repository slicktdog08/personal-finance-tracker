import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, transactions } from "@/server/db/schema";
import { addDaysIso, pendingDateFits } from "./reconcile";
import { LOCAL_SOURCES } from "@/constants/sync";

// The CSV/PDF → bank-sync direction of D4. Synced rows carry a provider-id dedup hash, so a
// statement re-imported for an account that is already synced would look entirely "new" to
// the content-hash check. Before an import is previewed, rows are compared against synced
// rows on the same account by money + date (±softMatchDays), the same rule the sync writer
// uses in the other direction, and matches are flagged as duplicates.

export interface ImportCandidate {
  accountNumber?: string | null;
  date: string;
  amount: number;
  direction: string;
}

const SOFT_MATCH_DAYS = 2;

function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

// Returns, for each candidate index, the id of the synced row it duplicates (or undefined).
// `skip` = indexes already known to be duplicates (content hash): they must not consume a
// match that a later, genuinely new row needs.
export async function findSyncedDuplicates(rows: ImportCandidate[], skip: ReadonlySet<number> = new Set()): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const numbers = [...new Set(rows.map((r) => (r.accountNumber ?? "").trim()).filter(Boolean))];
  if (!numbers.length || !rows.length) return out;
  const acctRows = await db
    .select({ id: accounts.id, n: accounts.accountNumber })
    .from(accounts)
    .where(inArray(accounts.accountNumber, numbers));
  if (!acctRows.length) return out;
  const idByNumber = new Map(acctRows.map((a) => [a.n, a.id]));
  const dates = rows.map((r) => r.date).sort();
  const synced = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      direction: transactions.direction,
    })
    .from(transactions)
    .where(
      and(
        inArray(
          transactions.accountId,
          acctRows.map((a) => a.id),
        ),
        // Only bank-synced rows: everything else already collides on the content hash.
        ne(transactions.source, "import"),
        ne(transactions.source, "pdf"),
        ne(transactions.source, "manual"),
        gte(transactions.txnDate, addDaysIso(dates[0], -SOFT_MATCH_DAYS)),
        lte(transactions.txnDate, addDaysIso(dates[dates.length - 1], SOFT_MATCH_DAYS)),
      ),
    );
  if (!synced.length) return out;
  const consumed = new Set<number>();
  rows.forEach((r, i) => {
    if (skip.has(i)) return;
    const accountId = idByNumber.get((r.accountNumber ?? "").trim());
    if (accountId == null) return;
    const hit = synced.find(
      (s) =>
        !consumed.has(s.id) &&
        s.accountId === accountId &&
        s.direction === r.direction &&
        Math.abs(Number(s.amount) - r.amount) < 0.005 &&
        daysBetween(s.txnDate, r.date) <= SOFT_MATCH_DAYS,
    );
    if (hit) {
      consumed.add(hit.id);
      out.set(i, hit.id);
    }
  });
  return out;
}

// A PENDING transaction entered by hand is settled by the first import row on the same
// account with the same money whose date fits `pendingDateFits` (reconcile.ts). Each pending
// row settles at most one import row. Bank-synced pending rows are the sync writer's business.
export interface PendingMatch {
  id: number;
  description: string;
  txnDate: string;
  /** The placeholder's category, so the preview can show what the settled row keeps. */
  category: string | null;
}

export async function findPendingMatches(rows: ImportCandidate[], skip: ReadonlySet<number> = new Set()): Promise<Map<number, PendingMatch>> {
  const out = new Map<number, PendingMatch>();
  const numbers = [...new Set(rows.map((r) => (r.accountNumber ?? "").trim()).filter(Boolean))];
  if (!numbers.length || !rows.length) return out;
  const acctRows = await db
    .select({ id: accounts.id, n: accounts.accountNumber })
    .from(accounts)
    .where(inArray(accounts.accountNumber, numbers));
  if (!acctRows.length) return out;
  const idByNumber = new Map(acctRows.map((a) => [a.n, a.id]));
  const pending = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      direction: transactions.direction,
      description: transactions.description,
      category: transactions.category,
    })
    .from(transactions)
    .where(
      and(
        inArray(
          transactions.accountId,
          acctRows.map((a) => a.id),
        ),
        eq(transactions.pending, true),
        inArray(transactions.source, [...LOCAL_SOURCES]),
      ),
    );
  if (!pending.length) return out;
  const consumed = new Set<number>();
  rows.forEach((r, i) => {
    if (skip.has(i)) return; // an already-duplicate row must not eat a placeholder
    const accountId = idByNumber.get((r.accountNumber ?? "").trim());
    if (accountId == null) return;
    const hit = pending.find(
      (p) =>
        !consumed.has(p.id) &&
        p.accountId === accountId &&
        p.direction === r.direction &&
        Math.abs(Number(p.amount) - r.amount) < 0.005 &&
        pendingDateFits(p.txnDate, r.date),
    );
    if (hit) {
      consumed.add(hit.id);
      out.set(i, { id: hit.id, description: hit.description, txnDate: hit.txnDate, category: hit.category });
    }
  });
  return out;
}

// Internal-transfer detection (pure, no DB). A transfer is money moved between two of
// your own accounts: a Debit on one account and a matching Credit on another, same
// amount, close in date.

export interface TxnLite {
  id: number;
  accountId: number | null;
  account: string; // label / last-4 / "—"
  date: string; // ISO YYYY-MM-DD
  description: string;
  amount: number; // absolute
  direction: string; // Debit | Credit
  category: string | null;
  partnerId: number | null;
}

export interface SuggestionPair {
  debit: TxnLite;
  credit: TxnLite;
  daysApart: number;
}
export interface UnmatchedTransfer {
  txn: TxnLite;
  candidates: TxnLite[];
}
export interface LinkedPair {
  a: TxnLite;
  b: TxnLite;
}
export interface TransfersData {
  suggestions: SuggestionPair[];
  unmatched: UnmatchedTransfer[];
  linked: LinkedPair[];
}

function daysBetween(a: string, b: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b);
  if (!pa || !pb) return Infinity;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.abs(Math.round((ta - tb) / 86400000));
}

const isTransfer = (t: TxnLite) => t.category === "Transfer";

// Normalized key for a transaction pair (order-independent).
export function transferKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function detectTransfers(
  txns: TxnLite[],
  opts: { windowDays?: number; dismissed?: Set<string> } = {},
): TransfersData {
  const windowDays = opts.windowDays ?? 4;
  const dismissed = opts.dismissed ?? new Set<string>();
  const byId = new Map(txns.map((t) => [t.id, t]));

  // Confirmed links (both sides point at each other).
  const linked: LinkedPair[] = [];
  const seenLinked = new Set<number>();
  for (const t of txns) {
    if (t.partnerId == null || seenLinked.has(t.id)) continue;
    const p = byId.get(t.partnerId);
    if (p && p.partnerId === t.id) {
      linked.push({ a: t, b: p });
      seenLinked.add(t.id);
      seenLinked.add(p.id);
    }
  }

  const unlinked = txns.filter((t) => t.partnerId == null);

  // Unmatched: explicitly marked as Transfer but not linked yet → offer candidates.
  const unmatched: UnmatchedTransfer[] = [];
  for (const t of unlinked) {
    if (!isTransfer(t)) continue;
    const candidates = unlinked
      .filter(
        (c) =>
          c.id !== t.id &&
          c.direction !== t.direction &&
          c.amount === t.amount &&
          c.amount > 0 &&
          (c.accountId == null || t.accountId == null || c.accountId !== t.accountId),
      )
      .sort((x, y) => daysBetween(t.date, x.date) - daysBetween(t.date, y.date))
      .slice(0, 6);
    unmatched.push({ txn: t, candidates });
  }

  // Auto-suggested pairs among NOT-yet-flagged transactions (avoid duplicating unmatched).
  const used = new Set<number>();
  const byAmount = new Map<number, TxnLite[]>();
  for (const t of unlinked) {
    if (t.accountId == null || t.amount <= 0 || isTransfer(t)) continue;
    const arr = byAmount.get(t.amount) ?? [];
    arr.push(t);
    byAmount.set(t.amount, arr);
  }
  const suggestions: SuggestionPair[] = [];
  for (const group of byAmount.values()) {
    const debits = group.filter((t) => t.direction === "Debit");
    const credits = group.filter((t) => t.direction === "Credit");
    for (const d of debits) {
      if (used.has(d.id)) continue;
      let best: TxnLite | null = null;
      let bestDays = Infinity;
      for (const c of credits) {
        if (used.has(c.id) || c.accountId === d.accountId) continue;
        if (dismissed.has(transferKey(d.id, c.id))) continue;
        const days = daysBetween(d.date, c.date);
        if (days <= windowDays && days < bestDays) {
          best = c;
          bestDays = days;
        }
      }
      if (best) {
        used.add(d.id);
        used.add(best.id);
        suggestions.push({ debit: d, credit: best, daysApart: bestDays });
      }
    }
  }
  suggestions.sort((a, b) => a.daysApart - b.daysApart || b.debit.amount - a.debit.amount);

  return { suggestions: suggestions.slice(0, 50), unmatched, linked };
}

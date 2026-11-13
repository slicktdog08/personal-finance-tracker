// Pure planning for the balance snapshots a statement import writes (no DB here, so the
// rules are unit-testable). One snapshot per account per date:
//   - a date nobody has recorded yet gets a new row;
//   - a date already holding an imported row (source set) is refreshed with the new value, so
//     re-importing a statement corrects it rather than being ignored;
//   - a date holding a hand-entered or synced row (source null) is left alone.
import { BALANCE_SOURCES, type BalanceSource } from "@/constants/enums";
import type { DailyBalance, StatementBalance } from "@/server/lib/pdf/types";

export interface BalancePoint {
  asOf: string;
  balance: number;
  creditLimit: number | null;
  note: string | null;
  source: BalanceSource;
}

export interface ExistingBalance {
  id: number;
  asOf: string;
  balance: number;
  source: string | null;
}

/** The day before an ISO date ("2026-10-01" → "2026-09-30"). */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * One point per date from a statement's chosen snapshots. Opening/closing come first so they win
 * a date they share with a daily point (the values agree; the opening/closing note is clearer).
 */
export function statementPoints(
  balances: StatementBalance[],
  daily: DailyBalance[],
  dailyNote: string,
): BalancePoint[] {
  const byDate = new Map<string, BalancePoint>();
  for (const b of balances) {
    if (!byDate.has(b.asOf)) {
      byDate.set(b.asOf, {
        asOf: b.asOf,
        balance: b.balance,
        creditLimit: b.creditLimit,
        note: b.note || null,
        source: BALANCE_SOURCES.statement,
      });
    }
  }
  for (const d of daily) {
    if (!byDate.has(d.asOf)) {
      byDate.set(d.asOf, {
        asOf: d.asOf,
        balance: d.balance,
        creditLimit: null,
        note: dailyNote,
        source: BALANCE_SOURCES.statementDaily,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.asOf.localeCompare(b.asOf));
}

export function planBalanceWrites(
  points: BalancePoint[],
  existing: ExistingBalance[],
): { inserts: BalancePoint[]; updates: { id: number; point: BalancePoint }[] } {
  const byDate = new Map<string, ExistingBalance>();
  for (const e of existing) {
    // Several rows on one date can exist (hand-entered twice); any hand-entered row protects it.
    const cur = byDate.get(e.asOf);
    if (!cur || (cur.source != null && e.source == null)) byDate.set(e.asOf, e);
  }
  const inserts: BalancePoint[] = [];
  const updates: { id: number; point: BalancePoint }[] = [];
  for (const p of points) {
    const e = byDate.get(p.asOf);
    if (!e) {
      inserts.push(p);
      byDate.set(p.asOf, { id: -1, asOf: p.asOf, balance: p.balance, source: p.source });
    } else if (e.source != null && e.id > 0 && Math.abs(e.balance - p.balance) > 0.005) {
      updates.push({ id: e.id, point: p });
    }
  }
  return { inserts, updates };
}

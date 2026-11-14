// Data coverage: for every account, which months the app holds transactions and/or balance
// snapshots for — and the runs of months it holds nothing. Built for back-filling history: it
// answers "which statements am I still missing?". Pure (no DB) so it's unit-testable; the query
// side is getDataCoverage in queries.ts.

export type CoverageState = "both" | "txns" | "balances" | "none" | "outside";

export interface CoverageAccount {
  id: number | null; // null = transactions with no account
  label: string;
  institution: string | null;
  accountType: string;
  active: boolean;
}

export interface MonthCount {
  accountId: number | null;
  month: string; // "2024-03"
  n: number;
}

export interface CoverageCell {
  month: string;
  txns: number;
  balances: number;
  state: CoverageState;
}

export type GapKind = "inside" | "before" | "after";

export interface CoverageGap {
  accountId: number | null;
  account: string;
  kind: GapKind;
  from: string;
  to: string;
  months: number;
}

export interface CoverageRow {
  account: CoverageAccount;
  cells: CoverageCell[];
  firstMonth: string | null;
  lastMonth: string | null;
  /** Months in the window with any data. */
  covered: number;
  /** Months in the window this account is expected to have data for. */
  expected: number;
  gaps: CoverageGap[];
}

export interface Coverage {
  months: string[];
  rows: CoverageRow[];
  /** Every gap, the ones inside an account's record first, then longest first. */
  gaps: CoverageGap[];
  totals: { accounts: number; expected: number; covered: number; insideGaps: number; missingMonths: number };
}

const idx = (label: string) => {
  const [y, m] = label.split("-").map(Number);
  return y * 12 + (m - 1);
};
const lab = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/** Every month label from `from` to `to`, inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = idx(from); i <= idx(to); i++) out.push(lab(i));
  return out;
}

/**
 * Lay out coverage over [from, to]. An account is expected to have data from `from` (or its first
 * record, if that's later — reported as a "before" gap so a newer account can be told apart from a
 * missing statement) through `to` while active, or through its last record once closed.
 * A month with balances but no transactions counts as covered: a quiet savings account is fine.
 */
export function buildCoverage(input: {
  accounts: CoverageAccount[];
  txns: MonthCount[];
  balances: MonthCount[];
  from: string;
  to: string;
}): Coverage {
  const months = monthRange(input.from, input.to);
  const key = (id: number | null, m: string) => `${id ?? "none"}|${m}`;
  const tx = new Map<string, number>();
  const bal = new Map<string, number>();
  const firstAll = new Map<number | null, string>();
  const lastAll = new Map<number | null, string>();
  const note = (r: MonthCount) => {
    const f = firstAll.get(r.accountId);
    if (!f || r.month < f) firstAll.set(r.accountId, r.month);
    const l = lastAll.get(r.accountId);
    if (!l || r.month > l) lastAll.set(r.accountId, r.month);
  };
  for (const r of input.txns) {
    tx.set(key(r.accountId, r.month), (tx.get(key(r.accountId, r.month)) ?? 0) + r.n);
    note(r);
  }
  for (const r of input.balances) {
    bal.set(key(r.accountId, r.month), (bal.get(key(r.accountId, r.month)) ?? 0) + r.n);
    note(r);
  }

  const rows: CoverageRow[] = [];
  for (const a of input.accounts) {
    const first = firstAll.get(a.id) ?? null;
    const last = lastAll.get(a.id) ?? null;
    // Closed with nothing on record: nothing to expect. The no-account bucket only shows if used.
    if (!first && (!a.active || a.id == null)) continue;
    const expectTo = a.active && a.id != null ? input.to : (last ?? input.to);
    const cells: CoverageCell[] = months.map((m) => {
      const t = tx.get(key(a.id, m)) ?? 0;
      const b = bal.get(key(a.id, m)) ?? 0;
      const state: CoverageState = t && b ? "both" : t ? "txns" : b ? "balances" : m > expectTo ? "outside" : "none";
      return { month: m, txns: t, balances: b, state };
    });
    const gaps: CoverageGap[] = [];
    let run: { from: number; to: number } | null = null;
    const close = () => {
      if (!run) return;
      const from = months[run.from];
      const kind: GapKind = !first || from < first ? "before" : last && from > last ? "after" : "inside";
      gaps.push({ accountId: a.id, account: a.label, kind, from, to: months[run.to], months: run.to - run.from + 1 });
      run = null;
    };
    cells.forEach((c, i) => {
      if (c.state === "none") {
        if (run) run.to = i;
        else run = { from: i, to: i };
      } else close();
    });
    close();
    const expected = cells.filter((c) => c.state !== "outside").length;
    const covered = cells.filter((c) => c.state !== "outside" && c.state !== "none").length;
    rows.push({ account: a, cells, firstMonth: first, lastMonth: last, covered, expected, gaps });
  }

  const kindRank: Record<GapKind, number> = { inside: 0, after: 1, before: 2 };
  const gaps = rows.flatMap((r) => r.gaps).sort((x, y) => kindRank[x.kind] - kindRank[y.kind] || y.months - x.months || x.from.localeCompare(y.from));
  const expected = rows.reduce((s, r) => s + r.expected, 0);
  const covered = rows.reduce((s, r) => s + r.covered, 0);
  return {
    months,
    rows,
    gaps,
    totals: {
      accounts: rows.length,
      expected,
      covered,
      insideGaps: gaps.filter((g) => g.kind === "inside").length,
      missingMonths: expected - covered,
    },
  };
}

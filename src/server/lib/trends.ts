// Pure helpers for the Trends page: the range window, per-series statistics, and the
// month-by-month ledger that joins balance snapshots to the transaction cash flow.
// No DB access here, so the arithmetic is unit-testable.

/** One month of balances as of its end (the shape getBalanceTrends returns). */
export interface TrendMonth {
  label: string; // "2026-03"
  cash: number | null;
  credit: number | null;
  loans: number | null;
  retirement: number;
  assets: number;
}

/** Money in / out through the accounts in one month, from the ledger (transfers excluded). */
export interface FlowMonth {
  label: string;
  in: number;
  out: number;
}

/** "2026-11" with n = 3 → "2026-09": the first month of an n-month window ending at `current`. */
export function windowStartLabel(current: string, months: number): string {
  const [y, m] = current.split("-").map(Number);
  const idx = y * 12 + (m - 1) - (months - 1);
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export interface SeriesPoint {
  label: string;
  value: number | null;
}

export interface SeriesStats {
  first: { label: string; value: number };
  last: { label: string; value: number };
  change: number;
  /** Percent change against the first value; null when it starts at (or near) zero. */
  changePct: number | null;
  high: { label: string; value: number };
  low: { label: string; value: number };
  /** Mean value over the recorded months. */
  avg: number;
  /** Mean change per month across the span (months between first and last, not points). */
  perMonth: number;
  /** Months between the first and last recorded value. */
  span: number;
  /** Biggest single-month rise and fall between consecutive recorded months. */
  bestMove: { label: string; value: number } | null;
  worstMove: { label: string; value: number } | null;
}

/** Statistics for one monthly series; null when it has fewer than two recorded months. */
export function seriesStats(points: SeriesPoint[]): SeriesStats | null {
  const defined = points.flatMap((p, i) => (p.value == null ? [] : [{ label: p.label, value: p.value, i }]));
  if (defined.length < 2) return null;
  const first = defined[0];
  const last = defined[defined.length - 1];
  let high = first;
  let low = first;
  let sum = 0;
  for (const d of defined) {
    if (d.value > high.value) high = d;
    if (d.value < low.value) low = d;
    sum += d.value;
  }
  let bestMove: SeriesStats["bestMove"] = null;
  let worstMove: SeriesStats["worstMove"] = null;
  for (let k = 1; k < defined.length; k++) {
    // Only consecutive months count as a "move" — a gap would lump several months together.
    if (defined[k].i !== defined[k - 1].i + 1) continue;
    const mv = { label: defined[k].label, value: round2(defined[k].value - defined[k - 1].value) };
    if (!bestMove || mv.value > bestMove.value) bestMove = mv;
    if (!worstMove || mv.value < worstMove.value) worstMove = mv;
  }
  const change = round2(last.value - first.value);
  const span = Math.max(1, last.i - first.i);
  return {
    first: { label: first.label, value: first.value },
    last: { label: last.label, value: last.value },
    change,
    changePct: Math.abs(first.value) >= 1 ? (change / Math.abs(first.value)) * 100 : null,
    high: { label: high.label, value: high.value },
    low: { label: low.label, value: low.value },
    avg: round2(sum / defined.length),
    perMonth: round2(change / span),
    span,
    bestMove,
    worstMove,
  };
}

export interface FlowTotals {
  months: number;
  income: number;
  spending: number;
  net: number;
  /** Share of income kept: net ÷ income × 100; null with no income. */
  savingsRate: number | null;
  avgIncome: number;
  avgSpending: number;
  avgNet: number;
  /** Finished months that took in more than went out. */
  positiveMonths: number;
}

/** Totals and per-month averages over a run of months (pass finished months for fair averages). */
export function flowTotals(flows: FlowMonth[]): FlowTotals {
  const income = round2(flows.reduce((s, f) => s + f.in, 0));
  const spending = round2(flows.reduce((s, f) => s + f.out, 0));
  const net = round2(income - spending);
  const n = flows.length;
  return {
    months: n,
    income,
    spending,
    net,
    savingsRate: income > 0 ? (net / income) * 100 : null,
    avgIncome: n ? round2(income / n) : 0,
    avgSpending: n ? round2(spending / n) : 0,
    avgNet: n ? round2(net / n) : 0,
    positiveMonths: flows.filter((f) => f.in > f.out).length,
  };
}

/** Running total of (in − out), month by month — "how much has stayed with me since the start". */
export function cumulativeNet(flows: FlowMonth[]): { label: string; value: number }[] {
  let run = 0;
  return flows.map((f) => {
    run = round2(run + f.in - f.out);
    return { label: f.label, value: run };
  });
}

export interface LedgerRow {
  label: string;
  income: number | null;
  spending: number | null;
  net: number | null;
  savingsRate: number | null;
  cash: number | null;
  debt: number | null;
  netWorth: number | null;
  netWorthChange: number | null;
}

/**
 * One row per month: what moved through the accounts (from the ledger) beside where the balances
 * stood at the month's end. `netWorthOf` decides which months have a comparable net worth (the
 * page holds it back until every kind of balance it's made of has been recorded).
 */
export function monthlyLedger(
  months: TrendMonth[],
  flows: FlowMonth[],
  netWorthOf: (m: TrendMonth) => number | null,
): LedgerRow[] {
  const flowBy = new Map(flows.map((f) => [f.label, f]));
  const labels = [...new Set([...months.map((m) => m.label), ...flows.map((f) => f.label)])].sort();
  const monthBy = new Map(months.map((m) => [m.label, m]));
  let prevNet: number | null = null;
  return labels.map((label) => {
    const m = monthBy.get(label);
    const f = flowBy.get(label);
    const nw = m ? netWorthOf(m) : null;
    const debt = m && (m.credit != null || m.loans != null) ? round2((m.credit ?? 0) + (m.loans ?? 0)) : null;
    const row: LedgerRow = {
      label,
      income: f ? round2(f.in) : null,
      spending: f ? round2(f.out) : null,
      net: f ? round2(f.in - f.out) : null,
      savingsRate: f && f.in > 0 ? ((f.in - f.out) / f.in) * 100 : null,
      cash: m?.cash ?? null,
      debt,
      netWorth: nw,
      netWorthChange: nw != null && prevNet != null ? round2(nw - prevNet) : null,
    };
    prevNet = nw;
    return row;
  });
}

// ---- Buckets: months grouped into quarters or years for long windows ----
// Years of history as one bar per month is a sideways scroll of a hundred bars, and a table a
// hundred rows long. Bar charts and the ledger roll up into buckets; the lines stay monthly.

export type Bucket = "month" | "quarter" | "year";
export const BUCKETS: Bucket[] = ["month", "quarter", "year"];

/** Months for ≤ 3 years, quarters up to 8 years (≤ 32 bars), years past that. */
export function autoBucket(monthCount: number): Bucket {
  return monthCount <= 36 ? "month" : monthCount <= 96 ? "quarter" : "year";
}

/** "2026-05" → "2026-05" | "2026-Q2" | "2026". Sorts in time order within one bucket kind. */
export function bucketKey(label: string, by: Bucket): string {
  if (by === "month") return label;
  const [y, m] = label.split("-");
  return by === "year" ? y : `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
}

/** Display name for a bucket key: "May '26" | "Q2 '26" | "2026". */
export function bucketName(key: string, by: Bucket, monthName: (label: string) => string): string {
  if (by === "month") return monthName(key);
  if (by === "year") return key;
  const [y, q] = key.split("-");
  return `${q} '${y.slice(2)}`;
}

/** Consecutive runs of `labels` (time-ordered) that share a bucket, with their index range. */
export function bucketRuns(labels: string[], by: Bucket): { key: string; first: number; last: number }[] {
  const out: { key: string; first: number; last: number }[] = [];
  labels.forEach((l, i) => {
    const key = bucketKey(l, by);
    const cur = out[out.length - 1];
    if (cur && cur.key === key) cur.last = i;
    else out.push({ key, first: i, last: i });
  });
  return out;
}

/** Money in / out summed per bucket; the label becomes the bucket key. */
export function bucketFlows(flows: FlowMonth[], by: Bucket): FlowMonth[] {
  if (by === "month") return flows;
  return bucketRuns(
    flows.map((f) => f.label),
    by,
  ).map((r) => {
    const part = flows.slice(r.first, r.last + 1);
    return { label: r.key, in: round2(part.reduce((s, f) => s + f.in, 0)), out: round2(part.reduce((s, f) => s + f.out, 0)) };
  });
}

/** A balance series at each bucket's end: the last recorded value inside the bucket. */
export function bucketEnds(labels: string[], values: (number | null)[], by: Bucket): { key: string; value: number | null }[] {
  return bucketRuns(labels, by).map((r) => {
    let v: number | null = null;
    for (let i = r.last; i >= r.first; i--) {
      if (values[i] != null) {
        v = values[i];
        break;
      }
    }
    return { key: r.key, value: v };
  });
}

/**
 * Ledger rows rolled up per bucket: flows summed, balances as of the bucket's last recorded
 * month, and the net-worth change measured against the previous bucket's end.
 */
export function bucketLedger(rows: LedgerRow[], by: Bucket): (LedgerRow & { months: number })[] {
  if (by === "month") return rows.map((r) => ({ ...r, months: 1 }));
  const lastOf = (part: LedgerRow[], k: keyof LedgerRow) => {
    for (let i = part.length - 1; i >= 0; i--) if (part[i][k] != null) return part[i][k] as number;
    return null;
  };
  const sumOf = (part: LedgerRow[], k: "income" | "spending" | "net") =>
    part.some((r) => r[k] != null) ? round2(part.reduce((s, r) => s + (r[k] ?? 0), 0)) : null;
  let prevNet: number | null = null;
  return bucketRuns(
    rows.map((r) => r.label),
    by,
  ).map((run) => {
    const part = rows.slice(run.first, run.last + 1);
    const income = sumOf(part, "income");
    const net = sumOf(part, "net");
    const nw = lastOf(part, "netWorth");
    const row = {
      label: run.key,
      months: part.length,
      income,
      spending: sumOf(part, "spending"),
      net,
      savingsRate: income != null && income > 0 && net != null ? (net / income) * 100 : null,
      cash: lastOf(part, "cash"),
      debt: lastOf(part, "debt"),
      netWorth: nw,
      netWorthChange: nw != null && prevNet != null ? round2(nw - prevNet) : null,
    };
    if (nw != null) prevNet = nw;
    return row;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

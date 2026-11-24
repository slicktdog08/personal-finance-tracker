// The uncategorized backlog, shaped for an advisor working through it in a chat (pure, no DB).
//
// Thousands of uncategorized rows are a few hundred merchants. `groupBacklog` puts every row in
// exactly one group — keyed by its merchant phrase (src/server/lib/suggest.ts), so
// "SQ *JOES GRILL 8842" and "SQ *JOES GRILL 0193" are one decision — and describes each group
// with what a person would use to recognise it: how often, how much, when, on which account,
// whether it repeats monthly, and what its already-categorized look-alikes are filed under.
//
// `backlogTimeline` is the "where were you then" view: per month, how much is uncategorized and
// which places show up in the descriptions. A run of months in another city is usually a move or
// a long trip, which decides how a whole block of restaurants and shops should be filed.

import { describeWords, learnPlaces, merchantPhrase, type SuggestContext } from "./suggest";

export interface BacklogRow {
  id: number;
  description: string;
  /** YYYY-MM-DD */
  txnDate: string;
  amount: number;
  direction: string;
  accountId: number | null;
}

export interface LookalikeVerdict {
  /** The category most already-categorized look-alikes are in. */
  category: string;
  /** How many look-alikes are in it, of `of`. */
  n: number;
  of: number;
  /** Other categories look-alikes landed in, most common first. */
  others: { category: string; n: number }[];
}

export interface BacklogGroup {
  /** The merchant phrase: the default "contains" pattern for a rule covering the group. */
  pattern: string;
  count: number;
  debitCount: number;
  creditCount: number;
  /** Sum of amounts, money out minus money in. */
  net: number;
  amountMin: number;
  amountMax: number;
  firstDate: string;
  lastDate: string;
  /** Distinct YYYY-MM months it appears in. */
  months: number;
  /** Charged about monthly: 3+ months with a typical gap of 25–35 days. */
  monthly: boolean;
  accounts: { accountId: number | null; n: number }[];
  /** Up to 3 distinct descriptions as written. */
  samples: string[];
  /** Places named in its descriptions (city / state words), most common first. */
  places: string[];
  /** Every row in the group, newest first, capped at `idCap`. */
  transactionIds: number[];
  /** True when the group has more rows than transactionIds lists. */
  idsTruncated: boolean;
  /** What categorized descriptions containing the pattern are filed under, when any are. */
  lookalikes: LookalikeVerdict | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const month = (d: string) => d.slice(0, 7);

/** Places a description names: consecutive "place" words joined ("SAN DIEGO CA"). */
export function placesIn(description: string, ctx: SuggestContext = {}): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(run.join(" ").toUpperCase());
    run = [];
  };
  for (const w of describeWords(description, ctx)) {
    if (w.kind === "place") run.push(w.text.replace(/[,.;]+$/, ""));
    else flush();
  }
  flush();
  return out.filter((p) => p.length >= 2);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** About monthly: 3+ distinct months, median gap between distinct charge days 25–35. */
export function looksMonthly(dates: string[]): boolean {
  const days = [...new Set(dates)].sort();
  if (new Set(days.map(month)).size < 3) return false;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
  gaps.sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
  return median >= 25 && median <= 35;
}

function tallyTop<T extends string | number | null>(items: T[]): { key: T; n: number }[] {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

export interface GroupOptions {
  /** City words learned from the whole ledger; learned from the rows given when omitted. */
  places?: ReadonlySet<string>;
  /** Cap on transactionIds per group. */
  idCap?: number;
}

/**
 * Group uncategorized rows by merchant phrase, biggest groups first (then by money moved).
 * `categorized` is the rest of the ledger, used for each group's look-alike verdict.
 */
export function groupBacklog(
  rows: BacklogRow[],
  categorized: { description: string; category: string }[],
  opts: GroupOptions = {},
): BacklogGroup[] {
  const places = opts.places ?? learnPlaces([...rows.map((r) => r.description), ...categorized.map((c) => c.description)]);
  const ctx = { places };
  const idCap = opts.idCap ?? 100;

  const byKey = new Map<string, { pattern: string; rows: BacklogRow[] }>();
  for (const r of rows) {
    const pattern = merchantPhrase(r.description, ctx);
    const key = pattern.toUpperCase();
    const g = byKey.get(key);
    if (g) g.rows.push(r);
    else byKey.set(key, { pattern, rows: [r] });
  }

  // Look-alikes: categorized rows keyed by their own phrase (exact), else any that contain it.
  const catByKey = new Map<string, string[]>();
  const catUpper = categorized.map((c) => ({ u: c.description.toUpperCase(), category: c.category }));
  for (const c of categorized) {
    const key = merchantPhrase(c.description, ctx).toUpperCase();
    const list = catByKey.get(key);
    if (list) list.push(c.category);
    else catByKey.set(key, [c.category]);
  }
  const verdict = (key: string): LookalikeVerdict | null => {
    let cats = catByKey.get(key);
    if (!cats && key.length >= 4) cats = catUpper.filter((c) => c.u.includes(key)).map((c) => c.category);
    if (!cats?.length) return null;
    const [top, ...rest] = tallyTop(cats);
    return {
      category: top.key,
      n: top.n,
      of: cats.length,
      others: rest.slice(0, 3).map((t) => ({ category: t.key, n: t.n })),
    };
  };

  const groups: BacklogGroup[] = [];
  for (const [key, g] of byKey) {
    const sorted = [...g.rows].sort((a, b) => b.txnDate.localeCompare(a.txnDate) || b.id - a.id);
    const amounts = sorted.map((r) => r.amount);
    const debits = sorted.filter((r) => r.direction === "Debit");
    const samples: string[] = [];
    for (const r of sorted) {
      if (samples.length >= 3) break;
      if (!samples.includes(r.description)) samples.push(r.description);
    }
    groups.push({
      pattern: g.pattern,
      count: sorted.length,
      debitCount: debits.length,
      creditCount: sorted.length - debits.length,
      net: round2(sorted.reduce((s, r) => s + (r.direction === "Debit" ? r.amount : -r.amount), 0)),
      amountMin: round2(Math.min(...amounts)),
      amountMax: round2(Math.max(...amounts)),
      firstDate: sorted[sorted.length - 1].txnDate,
      lastDate: sorted[0].txnDate,
      months: new Set(sorted.map((r) => month(r.txnDate))).size,
      monthly: looksMonthly(sorted.map((r) => r.txnDate)),
      accounts: tallyTop(sorted.map((r) => r.accountId)).map((t) => ({ accountId: t.key, n: t.n })),
      samples,
      places: tallyTop(sorted.flatMap((r) => placesIn(r.description, ctx)))
        .slice(0, 3)
        .map((t) => t.key),
      transactionIds: sorted.slice(0, idCap).map((r) => r.id),
      idsTruncated: sorted.length > idCap,
      lookalikes: verdict(key),
    });
  }
  groups.sort((a, b) => b.count - a.count || Math.abs(b.net) - Math.abs(a.net) || a.pattern.localeCompare(b.pattern));
  return groups;
}

export interface TimelineMonth {
  month: string;
  total: number;
  uncategorized: number;
  /** Places named most in that month's descriptions (all rows, not only uncategorized). */
  places: { place: string; n: number }[];
}

/** Per month: totals, the uncategorized share, and the places the descriptions name. */
export function backlogTimeline(
  rows: { description: string; txnDate: string; uncategorized: boolean }[],
  ctx: SuggestContext = {},
): TimelineMonth[] {
  const context = ctx.places ? ctx : { places: learnPlaces(rows.map((r) => r.description)) };
  const byMonth = new Map<string, { total: number; uncategorized: number; places: string[] }>();
  for (const r of rows) {
    const m = month(r.txnDate);
    let e = byMonth.get(m);
    if (!e) byMonth.set(m, (e = { total: 0, uncategorized: 0, places: [] }));
    e.total++;
    if (r.uncategorized) e.uncategorized++;
    e.places.push(...placesIn(r.description, context));
  }
  return [...byMonth]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, e]) => ({
      month: m,
      total: e.total,
      uncategorized: e.uncategorized,
      places: tallyTop(e.places)
        .slice(0, 4)
        .map((t) => ({ place: t.key, n: t.n })),
    }));
}

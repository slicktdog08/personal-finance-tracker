// Pure budget math — no DB, importable from client components (the setup wizard previews the
// plan live off the same functions the server uses to save it). Inputs are already-parsed
// numbers; convert DECIMAL strings with toNum first.
//
// A budget line is `planned` vs `actual`. The debt-snowball GENERATOR below turns the month's
// facts (liabilities, pay schedule, spending history) into a first draft of lines; the user
// then edits. Nothing here is a forecast of the bank — it's a plan.

import type { DebtStrategy } from "@/constants/enums";
import { BUDGET_EXCLUDED_CATEGORIES, SAVINGS_CATEGORY, SNOWBALL_MIN_APR } from "@/constants/enums";
import { clampToMonth, isoToUtc, type PayScheduleInput } from "@/server/lib/pay-schedule";
import { monthBounds } from "@/server/lib/period";

const DAY_MS = 86_400_000;

export interface DebtInput {
  accountId: number;
  label: string;
  balance: number;
  apr: number | null; // percent, e.g. 29.99
  minPayment: number | null;
}

export interface PlannedLine {
  kind: "category" | "debt" | "savings";
  label: string;
  category: string | null;
  accountId: number | null;
  planned: number;
  minimum: number | null;
  isTarget: boolean;
  /** Pinned in the wizard; saved as budget_lines.locked. */
  locked?: boolean;
}

export interface SnowballPlan {
  lines: PlannedLine[];
  income: number;
  spendingPlanned: number; // Σ category lines
  savingsPlanned: number; // the savings line (0 when none)
  minimumsPlanned: number; // Σ debt minimums
  extra: number; // what lands on the target beyond its minimum (0 when nothing is left)
  shortfall: number; // how far minimums + spending exceed income (0 when they don't)
  targetAccountId: number | null;
}

/** How many paydays fall inside one calendar month for the schedule. 0 when unprojectable. */
export function paydaysInMonth(schedule: PayScheduleInput, year: number, month: number): number {
  const { start, end } = monthBounds(year, month);
  if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
    if (!schedule.anchorDate) return 0;
    const anchor = isoToUtc(schedule.anchorDate);
    if (Number.isNaN(anchor)) return 0;
    const step = (schedule.frequency === "weekly" ? 7 : 14) * DAY_MS;
    // Walk back to the first payday on/before the month start, then count forward through it.
    const s = isoToUtc(start);
    let t = anchor + Math.floor((s - anchor) / step) * step;
    if (t < s) t += step;
    let n = 0;
    const e = isoToUtc(end);
    for (; t <= e; t += step) n++;
    return n;
  }
  const days = (
    schedule.frequency === "monthly" ? [schedule.dayOne] : [schedule.dayOne, schedule.dayTwo]
  ).filter((d): d is number => d != null && d >= 1 && d <= 31);
  return new Set(days.map((d) => clampToMonth(year, month, d))).size;
}

/** Expected take-home for the month: per-check amount × paydays landing in it. */
export function monthIncome(
  schedule: (PayScheduleInput & { takeHome: number | null }) | null,
  year: number,
  month: number,
): number | null {
  if (!schedule || schedule.takeHome == null) return null;
  const n = paydaysInMonth(schedule, year, month);
  return n > 0 ? round2(schedule.takeHome * n) : null;
}

/**
 * Is this debt one the snowball works on? Only debt above SNOWBALL_MIN_APR — cheap debt (the
 * student loan) is carried at its minimum, not attacked. An unknown APR is treated as expensive:
 * better to over-pay a card whose rate wasn't recorded than to park it.
 */
export function isSnowballDebt(d: Pick<DebtInput, "apr" | "balance">): boolean {
  return d.balance > 0 && (d.apr == null || d.apr > SNOWBALL_MIN_APR);
}

/**
 * Debts in payoff order for the strategy: snowball-eligible first (sorted by the strategy), then
 * the parked low-APR ones, then zero balances. The parked group keeps the strategy's order too so
 * the list reads consistently.
 */
export function orderDebts(debts: DebtInput[], strategy: DebtStrategy): DebtInput[] {
  const byStrategy = (a: DebtInput, b: DebtInput) =>
    strategy === "avalanche"
      ? (b.apr ?? 0) - (a.apr ?? 0) || a.balance - b.balance
      : a.balance - b.balance || (b.apr ?? 0) - (a.apr ?? 0);
  const live = debts.filter((d) => d.balance > 0);
  const eligible = live.filter(isSnowballDebt).sort(byStrategy);
  const parked = live.filter((d) => !isSnowballDebt(d)).sort(byStrategy);
  const done = debts.filter((d) => d.balance <= 0);
  return [...eligible, ...parked, ...done];
}

/**
 * Trailing average per category, rounded UP to the nearest $10 — a plan you can actually hit.
 * `months` echoes the per-month figures (same order as `history`) so a one-off — a $5k car
 * repair in one month — is visible next to the average it inflated, instead of hiding in it.
 */
export function suggestSpendingLines(
  history: { category: string; total: number }[][], // one array per past month
  opts: { exclude?: readonly string[]; roundTo?: number } = {},
): { category: string; planned: number; months: number[] }[] {
  const exclude = new Set(opts.exclude ?? BUDGET_EXCLUDED_CATEGORIES);
  const roundTo = opts.roundTo ?? 10;
  const n = history.length;
  if (!n) return [];
  const per = new Map<string, number[]>();
  history.forEach((m, i) => {
    for (const r of m) {
      if (!r.category || exclude.has(r.category) || r.total <= 0) continue;
      const arr = per.get(r.category) ?? new Array<number>(n).fill(0);
      arr[i] = round2(arr[i] + r.total);
      per.set(r.category, arr);
    }
  });
  return [...per.entries()]
    .map(([category, months]) => ({
      category,
      months,
      planned: Math.ceil(months.reduce((s, v) => s + v, 0) / n / roundTo) * roundTo,
    }))
    .filter((r) => r.planned > 0)
    .sort((a, b) => b.planned - a.planned);
}

/**
 * The snowball draft. Every debt gets its minimum; every spending category its suggested
 * amount; the income left over goes to the first debt in strategy order as `extra`. When
 * minimums + spending already exceed income there is no extra and `shortfall` says by how much.
 */
export function buildSnowballPlan(input: {
  income: number;
  debts: DebtInput[];
  strategy: DebtStrategy;
  spending: { category: string; planned: number }[];
  /** Money to keep, not spend — becomes a `savings` line and comes off the pie before extra. */
  savings?: number;
  /** Category display labels (emoji-free); falls back to the category name. */
  categoryLabel?: (c: string) => string;
}): SnowballPlan {
  const ordered = orderDebts(input.debts, input.strategy);
  const target = ordered.find(isSnowballDebt) ?? null;

  const spendingPlanned = round2(input.spending.reduce((s, r) => s + r.planned, 0));
  const minimumsPlanned = round2(
    ordered.reduce((s, d) => s + (d.balance > 0 ? d.minPayment ?? 0 : 0), 0),
  );
  const savingsPlanned = Math.max(0, round2(input.savings ?? 0));
  const leftover = round2(input.income - spendingPlanned - minimumsPlanned - savingsPlanned);
  const extra = Math.max(0, leftover);
  const shortfall = Math.max(0, -leftover);

  // Sweep the extra down the order: the target takes what it can absorb (never more than its
  // balance), and anything left spills onto the next debt — a $200 balance with $500 spare
  // doesn't strand $300. Parked (low-APR) debts never take any: minimum only.
  const lines: PlannedLine[] = [];
  let pool = extra;
  for (const d of ordered) {
    if (d.balance <= 0) continue;
    const min = d.minPayment ?? 0;
    const room = isSnowballDebt(d) ? Math.max(0, d.balance - min) : 0;
    const take = Math.min(pool, room);
    pool = round2(pool - take);
    lines.push({
      kind: "debt",
      label: d.label,
      category: null,
      accountId: d.accountId,
      planned: round2(min + take),
      minimum: d.minPayment,
      isTarget: target?.accountId === d.accountId,
    });
  }
  for (const s of input.spending) {
    lines.push({
      kind: "category",
      label: input.categoryLabel?.(s.category) ?? s.category,
      category: s.category,
      accountId: null,
      planned: s.planned,
      minimum: null,
      isTarget: false,
    });
  }
  if (savingsPlanned > 0) {
    lines.push({
      kind: "savings",
      label: SAVINGS_CATEGORY,
      category: SAVINGS_CATEGORY,
      accountId: null,
      planned: savingsPlanned,
      minimum: null,
      isTarget: false,
    });
  }

  return {
    lines,
    income: input.income,
    spendingPlanned,
    savingsPlanned,
    minimumsPlanned,
    extra: round2(extra - pool), // what actually landed on debts beyond their minimums
    shortfall,
    targetAccountId: target?.accountId ?? null,
  };
}

// ---- Payoff projection -------------------------------------------------------------------

export interface PayoffStep {
  accountId: number;
  label: string;
  /** Months from the budget month until this debt hits zero (1 = paid off in the budget month). */
  monthsToPayoff: number;
  paidOffOn: string; // YYYY-MM label
  interestPaid: number;
}

export interface PayoffProjection {
  months: number; // until everything is gone
  debtFreeOn: string | null; // YYYY-MM label; null when the plan never gets there
  totalInterest: number;
  steps: PayoffStep[];
  /** Same debts on minimums only, for the "this plan saves you…" comparison. */
  minimumsOnly: { months: number; totalInterest: number; debtFreeOn: string | null } | null;
  /** True when monthly payments don't even cover interest somewhere — the plan can't finish. */
  stalls: boolean;
  /** Low-APR debts left out of the simulation (carried at their minimum, not attacked). */
  excluded: { accountId: number; label: string; apr: number | null; minPayment: number | null }[];
  /** The APR line the simulation drew. */
  minApr: number;
}

const MAX_MONTHS = 600;

/**
 * Month-by-month simulation of the snowball over the HIGH-INTEREST debts only (see
 * isSnowballDebt): interest accrues at balance × apr/1200, each debt gets its minimum, the target
 * gets `extra`, and when a debt is paid its minimum rolls into the extra for the next one in
 * order. Low-APR debts are reported in `excluded` and play no part — "debt-free" here means
 * high-interest debt-free. A plain motivational estimate — statement timing, promo rates and fees
 * are ignored on purpose.
 */
export function projectPayoff(input: {
  /** All debts; the low-APR ones are filtered out here and echoed back in `excluded`. */
  debts: DebtInput[];
  strategy: DebtStrategy;
  /** Total monthly payment budgeted for the ELIGIBLE debts (Σ their minimums + extra). Held constant. */
  monthlyBudget: number;
  startYear: number;
  startMonth: number;
  compareToMinimums?: boolean;
  /** Pay `debts` in the order given (the user moved the target) instead of re-sorting. */
  preserveOrder?: boolean;
}): PayoffProjection {
  const eligible = input.debts.filter(isSnowballDebt);
  const excluded = input.debts
    .filter((d) => d.balance > 0 && !isSnowballDebt(d))
    .map((d) => ({ accountId: d.accountId, label: d.label, apr: d.apr, minPayment: d.minPayment }));
  const run = (budget: number) => {
    const order = input.preserveOrder ? eligible : orderDebts(eligible, input.strategy);
    const bal = new Map(order.map((d) => [d.accountId, d.balance]));
    const interest = new Map(order.map((d) => [d.accountId, 0]));
    const paidAt = new Map<number, number>();
    let month = 0;
    let stalls = false;
    let lastTotal = Infinity;
    while (month < MAX_MONTHS && [...bal.values()].some((b) => b > 0.005)) {
      month++;
      let pool = budget;
      // Interest first.
      for (const d of order) {
        const b = bal.get(d.accountId)!;
        if (b <= 0) continue;
        const i = round2((b * ((d.apr ?? 0) / 100)) / 12);
        bal.set(d.accountId, round2(b + i));
        interest.set(d.accountId, round2(interest.get(d.accountId)! + i));
      }
      // Minimums.
      for (const d of order) {
        const b = bal.get(d.accountId)!;
        if (b <= 0) continue;
        const pay = Math.min(b, d.minPayment ?? 0, pool);
        bal.set(d.accountId, round2(b - pay));
        pool = round2(pool - pay);
      }
      // Everything left → the first debt in order still carrying a balance, then the next…
      for (const d of order) {
        if (pool <= 0) break;
        const b = bal.get(d.accountId)!;
        if (b <= 0) continue;
        const pay = Math.min(b, pool);
        bal.set(d.accountId, round2(b - pay));
        pool = round2(pool - pay);
      }
      for (const d of order) {
        if (!paidAt.has(d.accountId) && bal.get(d.accountId)! <= 0.005) paidAt.set(d.accountId, month);
      }
      // Detect a stall: no balance moved down this month.
      const totalNow = [...bal.values()].reduce((s, b) => s + b, 0);
      if (month > 1 && totalNow >= lastTotal) {
        stalls = true;
        break;
      }
      lastTotal = totalNow;
    }
    const finished = [...bal.values()].every((b) => b <= 0.005);
    return {
      months: finished ? month : Infinity,
      totalInterest: round2([...interest.values()].reduce((s, i) => s + i, 0)),
      steps: order.map((d) => ({
        accountId: d.accountId,
        label: d.label,
        monthsToPayoff: paidAt.get(d.accountId) ?? Infinity,
        interestPaid: interest.get(d.accountId) ?? 0,
      })),
      stalls: stalls || !finished,
    };
  };
  const labelAfter = (n: number) => {
    if (!Number.isFinite(n)) return null;
    // Month 1 is the budget month itself.
    const zero = input.startYear * 12 + (input.startMonth - 1) + (n - 1);
    const y = Math.floor(zero / 12);
    const m = (zero % 12) + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  };

  // Nothing above the APR line → nothing to project. Say so instead of inventing a date.
  if (!eligible.length) {
    return {
      excluded,
      minApr: SNOWBALL_MIN_APR,
      months: 0,
      debtFreeOn: null,
      totalInterest: 0,
      steps: [],
      minimumsOnly: null,
      stalls: false,
    };
  }
  const main = run(input.monthlyBudget);
  const mins =
    input.compareToMinimums === false
      ? null
      : run(eligible.reduce((s, d) => s + (d.minPayment ?? 0), 0));

  return {
    excluded,
    minApr: SNOWBALL_MIN_APR,
    months: main.months,
    debtFreeOn: labelAfter(main.months),
    totalInterest: main.totalInterest,
    steps: main.steps.map((s) => ({ ...s, paidOffOn: labelAfter(s.monthsToPayoff) ?? "—" })),
    minimumsOnly: mins
      ? { months: mins.months, totalInterest: mins.totalInterest, debtFreeOn: labelAfter(mins.months) }
      : null,
    stalls: main.stalls,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Slider balancing (wizard) ----------------------------------------------------------
// The wizard's sliders are zero-sum when auto-balance is on: income − minimums is a fixed pie
// split between "extra to snowball" and the spending lines. These helpers move money around
// that pie without ever producing a negative line or a stranded cent.

export interface SliderRow {
  category: string;
  planned: number;
  /** Locked rows never move when others are rescaled. */
  locked: boolean;
  /** Weight used when scaling UP from all-zero (the suggested amount). */
  suggested: number;
  max: number;
}

/** Whole-dollar rounding for slider values. */
const dollars = (n: number) => Math.max(0, Math.round(n));

/**
 * Rescale the unlocked rows so the whole set totals `targetTotal` (locked rows are untouched).
 * Proportional to current values; when they're all zero, proportional to `suggested`. Rounding
 * drift lands on the largest unlocked row so the sum is exact. Rows are clamped to their max, and
 * whatever can't fit is simply left for the caller's `extra` to absorb.
 */
export function scaleRowsTo(rows: SliderRow[], targetTotal: number): SliderRow[] {
  const locked = rows.filter((r) => r.locked).reduce((s, r) => s + r.planned, 0);
  const want = Math.max(0, targetTotal - locked);
  const idx = rows.map((r, i) => i).filter((i) => !rows[i].locked);
  if (!idx.length) return rows;
  const cur = idx.reduce((s, i) => s + rows[i].planned, 0);
  const weights = idx.map((i) => (cur > 0 ? rows[i].planned : rows[i].suggested || 1));
  const wsum = weights.reduce((s, w) => s + w, 0) || 1;
  const out = rows.map((r) => ({ ...r }));
  let placed = 0;
  idx.forEach((i, k) => {
    const v = Math.min(out[i].max, dollars((want * weights[k]) / wsum));
    out[i].planned = v;
    placed += v;
  });
  // Push the rounding remainder onto the biggest unlocked row that has room.
  let rem = dollars(want) - placed;
  if (rem !== 0) {
    const order = [...idx].sort((a, b) => out[b].planned - out[a].planned);
    for (const i of order) {
      if (rem === 0) break;
      const room = rem > 0 ? out[i].max - out[i].planned : out[i].planned;
      const take = Math.sign(rem) * Math.min(Math.abs(rem), room);
      out[i].planned += take;
      rem -= take;
    }
  }
  return out;
}

/**
 * The user dragged ONE spending slider to `value` with auto-balance on: hold the extra steady by
 * rescaling the other unlocked rows to absorb the change. If they can't (they'd go negative),
 * they bottom out at zero and the extra shrinks instead.
 */
export function moveRowKeepingExtra(rows: SliderRow[], index: number, value: number): SliderRow[] {
  const v = Math.min(rows[index].max, dollars(value));
  const delta = v - rows[index].planned;
  const others = rows.map((r, i) => (i === index ? { ...r, locked: true } : r));
  const otherTotal = others.filter((r) => !r.locked).reduce((s, r) => s + r.planned, 0);
  const scaled = scaleRowsTo(others, others.filter((r) => r.locked).reduce((s, r) => s + r.planned, 0) + Math.max(0, otherTotal - delta));
  return scaled.map((r, i) => (i === index ? { ...rows[index], planned: v } : { ...r, locked: rows[i].locked }));
}

// ---- Lock-pool balancing (saved plan) ------------------------------------------------------
// Every line starts locked. The UNLOCKED lines are the pool: when one of them changes by `delta`,
// the others absorb −delta between them — one other line takes it exactly, several share it in
// proportion to their planned amounts (equally when they're all zero). Nothing goes below zero;
// whatever the pool can't absorb is returned as `remainder` for the caller to push to the
// leftover / the auto-rebalance target.
export function absorbDelta(
  others: { id: number; planned: number }[],
  delta: number,
): { updates: Map<number, number>; remainder: number } {
  const updates = new Map<number, number>();
  if (!others.length || delta === 0) return { updates, remainder: delta };
  const toAbsorb = -delta; // what the others must collectively change by
  // Reductions can only come from lines that have something; growth can go anywhere.
  const pool = toAbsorb < 0 ? others.filter((o) => o.planned > 0) : others;
  if (!pool.length) return { updates, remainder: delta };
  const poolTotal = pool.reduce((s, o) => s + o.planned, 0);
  let placed = 0;
  pool.forEach((o, i) => {
    const weight = poolTotal > 0 ? o.planned / poolTotal : 1 / pool.length;
    let share = i === pool.length - 1 ? toAbsorb - placed : round2(toAbsorb * weight);
    const next = Math.max(0, round2(o.planned + share));
    share = round2(next - o.planned);
    updates.set(o.id, next);
    placed = round2(placed + share);
  });
  // Clamping may have left some unabsorbed (a line hit zero). Sweep the rest onto lines with room.
  let left = round2(toAbsorb - placed);
  if (left < 0) {
    for (const o of pool) {
      if (left === 0) break;
      const cur = updates.get(o.id) ?? o.planned;
      const take = Math.min(cur, -left);
      updates.set(o.id, round2(cur - take));
      left = round2(left + take);
    }
  } else if (left > 0) {
    const o = pool[0];
    updates.set(o.id, round2((updates.get(o.id) ?? o.planned) + left));
    left = 0;
  }
  return { updates, remainder: round2(-left) || 0 };
}

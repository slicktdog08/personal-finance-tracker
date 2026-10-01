// Pure cash-on-hand projection over a horizon of one or more months. Anchored on the day the
// balances were last recorded (`asOf`), it walks day by day to the end of the last segment:
// paychecks land on their dates, unpaid bills leave on their due days, each month's remaining
// everyday spending drains evenly across that month, and debt payments the plan still owes go
// out on their bill's due day (or at that month's end for the extra). Nothing here is a forecast
// of the bank — it's "if the plan holds, this is the shape of the next few weeks".
//
// Why a horizon and not just the month: a month can end looking fine while rent is due on the
// 1st. Carrying the walk into next month (its bills, its budget or this one's repeated) makes
// that cliff visible before the calendar flips.
//
// Double-counting is the whole difficulty. A bill and a budget line can describe the same money
// (Rent on the sheet AND a Rent category line), and a debt line and its bill instance always do.
// The rules: a bill that maps to a budget line is timed by the bill and *deducted from that line's
// remaining* so the line only spreads what's left; a debt line schedules ONE payment of what the
// plan still owes after both linked transactions and the sheet's "paid" status are honored.
//
// Paydays are the fourth way to double-count, and the subtlest: the SCHEDULE says "$3,000.01 on
// the 21st" while the BANK pays it as two halves that can land on the 20th and the 22nd. Anchored
// on the 20th, the first half is already inside `cashNow` — adding the scheduled lump on top
// counts it twice. So a payday is netted against the deposits that actually arrived within a few
// days of it and only the residual is projected (payday-reconcile.ts).

import { monthlyInterest } from "@/server/lib/debt";
import { isSnowballDebt, round2 } from "@/server/lib/budget";
import { clampToMonth, daysBetween, isoToUtc, utcToIso } from "@/server/lib/pay-schedule";
import { dateToYearMonth } from "@/server/lib/period";
import { DEFAULT_DEPOSIT_WINDOW_DAYS, reconcilePaydays, type ObservedDeposit, type PaydayMatch } from "@/server/lib/payday-reconcile";

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => utcToIso(isoToUtc(iso) + n * DAY_MS);

export type CashEventKind = "paycheck" | "bill" | "debt" | "pending";
export interface CashEvent {
  date: string;
  label: string;
  amount: number; // signed: + in, − out
  kind: CashEventKind;
  overdue?: boolean; // a bill past its due day and still unpaid — assumed to go out tomorrow
}

/**
 * Money committed but not yet in any balance: a hand-entered placeholder for a payment that
 * hasn't posted, or a bank-pending charge dated after the anchor. `lineId` is the budget line
 * whose spend rollup already counts it — the line's remaining is reduced so the same dollars
 * aren't also spread across the rest of the month.
 */
export interface ProjectionPending {
  id: number;
  label: string;
  date: string; // when it's expected to settle
  amount: number; // positive = outflow
  lineId: number | null;
}

export interface ProjectionBill {
  id: number;
  name: string;
  amount: number;
  dueDay: number | null;
  paid: boolean;
  /** Which budget line already accounts for this money, if any. */
  lineId: number | null;
  /** The liability account this bill pays, if any (then it's the debt line's, not a category's). */
  accountId: number | null;
}

export interface ProjectionLine {
  id: number;
  kind: string; // category | debt | savings
  label: string;
  planned: number;
  actual: number;
  accountId: number | null;
}

export interface ProjectionDebt {
  accountId: number;
  label: string;
  balance: number;
  apr: number | null;
}

/** One month of the horizon: its bills, its plan, and its paydays. */
export interface MonthSegment {
  label: string; // YYYY-MM
  start: string;
  end: string;
  paydays: { date: string; amount: number }[];
  /**
   * Payroll credits that already landed in this month, so a scheduled payday can be netted down
   * to what's still coming. Pass only rows the anchor balance already contains; `projectCash`
   * ignores any dated after `asOf` for safety.
   */
  observedDeposits?: ObservedDeposit[];
  /** Committed-but-unposted outflows expected to settle inside this month. */
  pending?: ProjectionPending[];
  bills: ProjectionBill[];
  lines: ProjectionLine[];
  /** True when the plan is this month's own budget repeated (no budget exists for it yet). */
  assumed?: boolean;
}

export interface CashProjectionInput {
  /** Balances are known as of this date; the walk starts the day after. */
  asOf: string;
  cashNow: number;
  /** Cash on hand the day before the first segment began — the savings line's baseline. */
  cashMonthStart?: number | null;
  /** Ascending, contiguous months. Earlier ones may be lead-in — see `focusIndex`. */
  segments: MonthSegment[];
  debts: ProjectionDebt[];
  /**
   * Which segment the flat "this month" figures describe. Default 0. Viewing a FUTURE month, the
   * anchor balance still sits in the current one, so the walk has to cross the months in between
   * to open that month at the right number — those lead-in segments come first and the focus
   * moves past them.
   */
  focusIndex?: number;
  /** ± days a real deposit may drift from its nominal payday. Default 3 (payday-reconcile.ts). */
  depositWindowDays?: number;
  /**
   * Cash that is inside `cashNow` but isn't available to spend — savings goals actually backed by
   * a cash account (an emergency fund). Subtracted for the `spendable` figures only; the walk
   * itself is untouched, because the money is genuinely in the account and a bill paid out of it
   * would clear. This is the difference between "the balance survives the month" and "the month
   * survives without raiding the emergency fund".
   */
  reservedCash?: number;
}

export interface MonthResult {
  label: string;
  start: string;
  end: string;
  endBalance: number;
  low: { date: string; balance: number };
  spreadTotal: number;
  spreadDaily: number;
  spreadDays: number;
  assumed: boolean;
  debtPayments: number;
  /** Per scheduled payday: what was expected, what landed, what's still coming. */
  paydays: PaydayMatch[];
  /** Credits near no payday — income the plan didn't anticipate. */
  unexpectedIncome: number;
  /** Total by which over-plan lines exceeded their envelopes — credited against the rest. */
  overspend: number;
}

export interface CashProjection {
  asOf: string;
  /** This month's end and the horizon's end. */
  end: string;
  horizonEnd: string;
  start: number; // cash as of `asOf`
  monthStart: number | null; // cash the day before this month began
  endBalance: number; // this month's end
  horizonBalance: number; // end of the last segment
  low: { date: string; balance: number }; // over the whole horizon
  lowThisMonth: { date: string; balance: number };
  days: { date: string; balance: number; paycheck: boolean; outflow: boolean; spread: number }[];
  events: CashEvent[]; // dated inflows/outflows across the horizon, ascending
  months: MonthResult[];
  // This month's everyday-spending figures (kept flat for the widgets that only speak of "now").
  spreadDaily: number;
  spreadTotal: number;
  spreadDays: number;
  /** The focus month's payday reconciliation — why the projected inflow is what it is. */
  paydays: PaydayMatch[];
  /** Index into `months` that the flat figures above describe. */
  focusIndex: number;
  /**
   * The same three landmarks with reserved cash taken out — what's actually free to spend. A low
   * point of $4,148 reads very differently when $4,134 of it is the emergency fund.
   */
  spendable: { reserved: number; now: number; end: number; low: { date: string; balance: number } };
  totals: { inflow: number; bills: number; debt: number; spending: number; pending: number }; // whole horizon
  savingsPlanned: number; // this month's savings line
  debt: {
    hotNow: number;
    hotEnd: number; // end of THIS month
    hotHorizon: number; // end of the horizon
    allNow: number;
    allEnd: number;
    allHorizon: number;
    interest: number; // one month at today's balances
    payments: number; // this month's planned debt payments
  };
  /** Filled in by the caller from stored snapshots — how today's projection compares to earlier ones. */
  trend?: ProjectionTrend | null;
}

export interface ProjectionPoint {
  takenOn: string;
  endBalance: number;
  horizonBalance: number;
  spreadTotal: number;
}

export interface ProjectionTrend {
  /** The earliest snapshot this month and the most recent one at least a week old (may be the same). */
  first: ProjectionPoint | null;
  weekAgo: ProjectionPoint | null;
  count: number;
  /**
   * Every snapshot for the month, ascending — "what the forecast for month-end said, day by day".
   * Drawn as its own line so the drift is visible as a shape instead of a single sentence about
   * one earlier day. It converges on the projection's own endpoint as the month runs out.
   */
  series: ProjectionPoint[];
}

export function projectCash(input: CashProjectionInput): CashProjection {
  const { asOf, segments } = input;
  // (segments[0] is the anchor month; the reported month is segments[focus] — see focusIndex.)
  const horizonEnd = segments[segments.length - 1].end;
  const firstDay = addDays(asOf, 1);
  const nDays = Math.max(0, daysBetween(asOf, horizonEnd));
  // How many days late a payday may be and still count as "in flight" — the same window a
  // deposit is allowed to drift by, since that is exactly the uncertainty being modelled.
  const lateWindow = Math.max(0, input.depositWindowDays ?? DEFAULT_DEPOSIT_WINDOW_DAYS);
  // Anything due on/before the anchor and still unpaid goes out on the first projected day.
  const schedule = (iso: string | null, segEnd: string) => (iso == null || iso <= asOf ? firstDay : iso > segEnd ? segEnd : iso);

  const events: CashEvent[] = [];
  const segInfo = segments.map((seg) => {
    const ym = dateToYearMonth(seg.end);
    const dueDate = (d: number | null) => (d != null && ym ? clampToMonth(ym.year, ym.month, d) : null);
    // Remaining per line, ALLOWED TO GO NEGATIVE. A line that's over its plan has spent money the
    // rest of the month no longer has, so that overspend is credited forward against the other
    // envelopes; only the month's total is floored at zero. Flooring each line instead (the old
    // rule) made the arithmetic one-sided: overspending was ignored while underspending was still
    // assumed to be spent, so a month could only ever look worse than it was.
    const remaining = new Map<number, number>();
    for (const l of seg.lines) if (l.kind === "category") remaining.set(l.id, round2(l.planned - l.actual));

    // Paydays, netted against the deposits that actually landed. Only deposits inside the anchor
    // (date ≤ asOf) can be netted out — those are the ones already sitting in `cashNow`. Anything
    // later is still the future, and the schedule is what covers it.
    const pay = reconcilePaydays({
      scheduled: seg.paydays.filter((p) => p.date >= seg.start && p.date <= seg.end),
      deposits: (seg.observedDeposits ?? []).filter((d) => d.date <= asOf),
      windowDays: input.depositWindowDays,
    });
    for (const r of pay.residuals) {
      // A payday a few days past with nothing matched is plausibly just late — carry it to the
      // first projected day, like an overdue bill. One LONG past is not money in flight: it is a
      // deposit the matcher failed to recognise (a description the payroll pattern misses, an
      // untracked account), and resurrecting it as income would invent cash that already arrived.
      // Drop it; `months[].paydays` still reports it incomplete so the UI can say so.
      const late = daysBetween(r.date, asOf);
      if (late > lateWindow) continue;
      const date = schedule(r.date, seg.end);
      if (date <= asOf) continue;
      events.push({ date, label: "Paycheck", amount: round2(r.amount), kind: "paycheck", overdue: late > 0 });
    }

    // Bills: every unpaid one leaves in full on its due day; a covering line's remaining shrinks.
    const debtBillByAccount = new Map<number, ProjectionBill>();
    for (const b of seg.bills) {
      if (b.accountId != null) {
        debtBillByAccount.set(b.accountId, b);
        continue;
      }
      if (b.paid || b.amount <= 0) continue;
      const due = dueDate(b.dueDay);
      const date = schedule(due, seg.end);
      if (date <= asOf) continue;
      events.push({ date, label: b.name, amount: -round2(b.amount), kind: "bill", overdue: due != null && due <= asOf });
      if (b.lineId != null && remaining.has(b.lineId)) remaining.set(b.lineId, round2(remaining.get(b.lineId)! - b.amount));
    }

    // Debt lines: one payment of what the plan still owes, honoring linked payments and paid marks.
    let debtPayments = 0;
    for (const l of seg.lines) {
      if (l.kind !== "debt" || l.accountId == null) continue;
      const bill = debtBillByAccount.get(l.accountId);
      const covered = Math.max(l.actual, bill && bill.paid ? bill.amount : 0);
      const owed = Math.max(0, round2(l.planned - covered));
      if (owed <= 0) continue;
      const due = bill && !bill.paid ? dueDate(bill.dueDay) : null;
      const date = due ? schedule(due, seg.end) : seg.end;
      if (date <= asOf) continue;
      events.push({ date, label: `${l.label} payment`, amount: -owed, kind: "debt", overdue: !!due && due <= asOf });
      debtPayments += owed;
    }

    // Committed-but-unposted outflows: the balance hasn't seen them, so the walk has to. Timed
    // and line-deducted exactly like a bill, for the same anti-double-count reason — the category
    // spend rollup already counts a pending row, so spreading it again would charge it twice.
    for (const p of seg.pending ?? []) {
      if (p.amount <= 0) continue;
      const date = schedule(p.date, seg.end);
      if (date <= asOf) continue;
      events.push({ date, label: p.label, amount: -round2(p.amount), kind: "pending", overdue: p.date <= asOf });
      if (p.lineId != null && remaining.has(p.lineId)) remaining.set(p.lineId, round2(remaining.get(p.lineId)! - p.amount));
    }

    // Everyday spending for this segment, drained evenly over ITS remaining days. Netted across
    // lines first, then floored: blowing one envelope leaves the month with less to spend, not the
    // same amount. `overspend` is how much was absorbed, so the UI can say so rather than leaving
    // the drop unexplained.
    // Subtracting the negatives (rather than negating their sum) keeps this a clean positive 0
    // when nothing is over — `-0` would render as "−$0.00".
    const overspend = round2([...remaining.values()].reduce((s, v) => (v < 0 ? s - v : s), 0));
    const spreadTotal = Math.max(0, round2([...remaining.values()].reduce((s, v) => s + v, 0)));
    const from = seg.start > asOf ? addDays(seg.start, -1) : asOf; // day before the first walked day
    const spreadDays = Math.max(0, daysBetween(from, seg.end));
    const spreadDaily = spreadDays > 0 ? spreadTotal / spreadDays : 0;
    return { seg, spreadTotal, spreadDays, spreadDaily, debtPayments: round2(debtPayments), pay, overspend };
  });
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));

  // Walk the days. The running balance stays exact; only the reported figure is rounded.
  const days: CashProjection["days"] = [];
  let exact = input.cashNow;
  let low = { date: asOf, balance: input.cashNow };
  let lowThisMonth = { date: asOf, balance: input.cashNow };
  const byDate = new Map<string, CashEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  // `low` starts empty: a month's low must come from its OWN days. Seeding it with today's cash
  // made every later month report `{ asOf, cashNow }` — a date outside the month — whenever it
  // never dipped below today. Filled in for real below, or defaulted after the walk.
  const monthResults: (Omit<MonthResult, "low"> & { low: MonthResult["low"] | null })[] = segInfo.map((si) => ({
    label: si.seg.label,
    start: si.seg.start,
    end: si.seg.end,
    endBalance: input.cashNow,
    low: null,
    spreadTotal: si.spreadTotal,
    spreadDaily: round2(si.spreadDaily),
    spreadDays: si.spreadDays,
    assumed: !!si.seg.assumed,
    debtPayments: si.debtPayments,
    paydays: si.pay.matches,
    unexpectedIncome: round2(si.pay.unmatched.reduce((s, d) => s + d.amount, 0)),
    overspend: si.overspend,
  }));
  const focus = Math.min(Math.max(input.focusIndex ?? 0, 0), segments.length - 1);
  for (let i = 1; i <= nDays; i++) {
    const date = addDays(asOf, i);
    const k = segInfo.findIndex((si) => date >= si.seg.start && date <= si.seg.end);
    // A day can fall outside every segment when the anchor precedes the first one. Clamp to the
    // NEAREST segment, not blindly to the last: `findIndex`'s −1 used to hand the leftover days
    // of the anchor month next November's daily burn rate.
    const idx = k >= 0 ? k : date < segInfo[0].seg.start ? 0 : segInfo.length - 1;
    const si = segInfo[idx];
    const todays = byDate.get(date) ?? [];
    for (const e of todays) exact += e.amount;
    // Only drain a segment's everyday spending on days that really belong to it.
    if (k >= 0) exact -= si.spreadDaily;
    const bal = round2(exact);
    days.push({ date, balance: bal, paycheck: todays.some((e) => e.kind === "paycheck"), outflow: todays.some((e) => e.kind !== "paycheck"), spread: k >= 0 ? round2(si.spreadDaily) : 0 });
    if (bal < low.balance) low = { date, balance: bal };
    const mr = monthResults[idx];
    if (k >= 0 && (mr.low == null || bal < mr.low.balance)) mr.low = { date, balance: bal };
    if (date === mr.end) mr.endBalance = bal;
    if (idx === focus && k >= 0 && bal < lowThisMonth.balance) lowThisMonth = { date, balance: bal };
  }
  // A month with no walked days of its own (already over) falls back to the anchor.
  for (const mr of monthResults) mr.low ??= { date: asOf, balance: input.cashNow };
  const months = monthResults as MonthResult[];
  // For a focus month in the future, today's cash is not a candidate for ITS low point.
  if (focus > 0) lowThisMonth = months[focus].low;
  // A month that ends before the walk starts (already over) keeps the anchor balance.
  const sum = (k: CashEventKind) => round2(events.filter((e) => e.kind === k).reduce((s, e) => s + Math.abs(e.amount), 0));

  // Debt: roll each month's interest and planned payments forward, month by month.
  let hotNow = 0, allNow = 0, interest = 0;
  const bal = new Map(input.debts.map((d) => [d.accountId, d.balance]));
  const hot = new Set(input.debts.filter(isSnowballDebt).map((d) => d.accountId));
  for (const d of input.debts) {
    if (d.balance <= 0) continue;
    allNow += d.balance;
    interest += monthlyInterest(d.balance, d.apr) ?? 0;
    if (hot.has(d.accountId)) hotNow += d.balance;
  }
  const monthEnds: { hot: number; all: number }[] = [];
  let thisMonthPayments = 0;
  segments.forEach((seg, k) => {
    for (const d of input.debts) {
      const b = bal.get(d.accountId)!;
      if (b <= 0) continue;
      const planned = seg.lines.find((l) => l.kind === "debt" && l.accountId === d.accountId)?.planned ?? 0;
      if (k === focus) thisMonthPayments += planned;
      bal.set(d.accountId, Math.max(0, round2(b + (monthlyInterest(b, d.apr) ?? 0) - planned)));
    }
    let h = 0, a = 0;
    for (const [id, b] of bal) {
      a += b;
      if (hot.has(id)) h += b;
    }
    monthEnds.push({ hot: round2(h), all: round2(a) });
  });

  const reserved = Math.max(0, input.reservedCash ?? 0);
  const focusSeg = segments[focus];
  const savingsPlanned = round2(focusSeg.lines.filter((l) => l.kind === "savings").reduce((s, l) => s + l.planned, 0));
  const mf = months[focus];
  return {
    asOf,
    end: focusSeg.end,
    horizonEnd,
    start: input.cashNow,
    monthStart: input.cashMonthStart ?? null,
    endBalance: mf.endBalance,
    horizonBalance: days.length ? days[days.length - 1].balance : input.cashNow,
    low,
    lowThisMonth,
    days,
    events,
    months: months.map((m) => (m.end <= asOf ? { ...m, endBalance: input.cashNow } : m)),
    spreadDaily: mf.spreadDaily,
    spreadTotal: mf.spreadTotal,
    spreadDays: mf.spreadDays,
    paydays: mf.paydays,
    focusIndex: focus,
    spendable: {
      reserved: round2(reserved),
      now: round2(input.cashNow - reserved),
      end: round2(mf.endBalance - reserved),
      low: { date: low.date, balance: round2(low.balance - reserved) },
    },
    totals: { inflow: sum("paycheck"), bills: sum("bill"), debt: sum("debt"), pending: sum("pending"), spending: round2(months.reduce((s, m) => s + m.spreadTotal, 0)) },
    savingsPlanned,
    debt: {
      hotNow: round2(hotNow),
      hotEnd: monthEnds[focus]?.hot ?? round2(hotNow),
      hotHorizon: monthEnds[monthEnds.length - 1]?.hot ?? round2(hotNow),
      allNow: round2(allNow),
      allEnd: monthEnds[focus]?.all ?? round2(allNow),
      allHorizon: monthEnds[monthEnds.length - 1]?.all ?? round2(allNow),
      interest: round2(interest),
      payments: round2(thisMonthPayments),
    },
    trend: null,
  };
}

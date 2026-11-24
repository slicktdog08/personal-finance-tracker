// Spending Pace: a slow-moving monitor that says when discretionary spending has been running
// ahead of what income leaves room for — for a week or two, not for one big night.
//
// Everything here is pure (no DB, no clock), so the dashboard, the daily job, the backtest script
// and the unit tests all run the exact same arithmetic. The DB loader (queries.ts getPaceInputs)
// turns ledger rows into PaceTxn pieces; this module classifies them, builds daily series, derives
// the allowances and replays the status machine day by day. Because the status is a deterministic
// replay of history, it needs no stored state of its own: only "which escalation did we already
// notify about" is persisted (app_settings), so a restart can never double-notify.
//
// See planning/features/spending-pace.md for the rules and the reasoning behind them.

import { normalizeMerchant } from "@/server/lib/merchant";
import { isPayrollDescription } from "@/server/lib/payday-reconcile";
import { isoToUtc, utcToIso } from "@/server/lib/pay-schedule";

/** Average days per month: every per-day allowance is a monthly figure ÷ this. */
export const DAYS_PER_MONTH = 30.4;
const DAY_MS = 86_400_000;

// ---- Config ------------------------------------------------------------------------------

export interface PaceConfig {
  /** Share of the income baseline set aside before anything is "allowed", in percent. */
  savingsPct: number;
  /** Everyday necessities averaged into the essentials baseline (never discretionary). */
  essentialsCategories: string[];
  /** Fixed costs paid through categories rather than bills (rent paid by transfer, say). */
  fixedCategories: string[];
  /** Never spending and never income: internal moves, card payments, investing. */
  excludedCategories: string[];
  /** Credits in these categories are income. */
  incomeCategories: string[];
  /** Interest and fees: shown as "cost of carrying debt", never in discretionary. */
  carryingCategories: string[];
  /** Uncategorized debits on a cash account matching this are card payments, not spending. */
  cardPaymentPattern: string;
  /** Uncategorized credits on a card matching this are payments to it, not refunds. */
  cardCreditPaymentPattern: string;
  /** Payroll deposits (smooths paycheck timing). Empty = the pay schedule's / built-in pattern. */
  payrollPattern: string;
  windows: { short: number; mid: number; long: number };
  /** Trailing days behind the income / essentials / fixed baselines. */
  baselineDays: number;
  /** Days the 14-day average must stay over break-even before Warning. */
  warningDays: number;
  /** Days the Alert condition must hold before Alert. */
  alertDays: number;
  /** Consecutive days below a level before stepping down from it. */
  deescalateDays: number;
  /** Alert when the long average exceeds break-even × this. */
  alertMultiplier: number;
  /**
   * Alert when revolving card balances grew this many consecutive weeks. Each weekly check asks
   * "is the balance higher than four weeks ago?" — a full payment cycle — so the ordinary
   * charge-all-month, pay-once pattern never counts as growth on its own.
   */
  cardGrowthWeeks: number;
  /** Growth under this many dollars (over the four weeks) doesn't count. */
  cardGrowthMin: number;
  /** A single day of discretionary spending over this is a "big night". */
  bigNightThreshold: number;
  /** Same merchant this many times in 7 days is a streak. */
  merchantStreakCount: number;
  /** Charge frequency over norm × this … */
  frequencyRatio: number;
  /** … for this many consecutive days is a flag. */
  frequencyDays: number;
  /** One-off charges tagged "spread" are amortized over this many days. */
  spreadDays: number;
  /** Status reads "stale" when bank sync hasn't completed in this many days. */
  staleDays: number;
  /** Weekly digest: 0 = Sunday … 6 = Saturday, at "HH:MM" local server time. */
  digestDay: number;
  digestTime: string;
}

export const DEFAULT_PACE_CONFIG: PaceConfig = {
  savingsPct: 20,
  essentialsCategories: ["Food/Groceries", "Gas", "Essentials"],
  fixedCategories: ["Housing", "Utilities"],
  excludedCategories: ["Transfer", "Debt Repayment", "Investing", "Savings"],
  incomeCategories: ["Deposit"],
  carryingCategories: ["Interest", "Fees", "Interest/Rewards"],
  cardPaymentPattern: "(card|crd|credit).{0,24}(payment|pmt|pymt)|(payment|pmt|pymt).{0,24}(card|crd)|autopay|epay",
  cardCreditPaymentPattern: "payment|pymt|pmt|thank you|autopay",
  payrollPattern: "",
  windows: { short: 7, mid: 14, long: 28 },
  baselineDays: 90,
  warningDays: 7,
  alertDays: 1,
  deescalateDays: 7,
  alertMultiplier: 1.25,
  cardGrowthWeeks: 3,
  cardGrowthMin: 100,
  bigNightThreshold: 250,
  merchantStreakCount: 4,
  frequencyRatio: 1.5,
  frequencyDays: 10,
  spreadDays: 90,
  staleDays: 2,
  digestDay: 0,
  digestTime: "18:00",
};

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
const clampNum = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const strList = (v: unknown, dflt: string[]) =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean))] : dflt;
const str = (v: unknown, dflt: string) => (typeof v === "string" ? v : dflt);

/** Any stored (possibly partial, possibly stale-shaped) config → a complete, sane one. */
export function normalizePaceConfig(raw: unknown): PaceConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PACE_CONFIG;
  const w = (r.windows && typeof r.windows === "object" ? r.windows : {}) as Record<string, unknown>;
  const short = clampInt(w.short, 3, 60, d.windows.short);
  const mid = clampInt(w.mid, short, 90, Math.max(short, d.windows.mid));
  const long = clampInt(w.long, mid, 120, Math.max(mid, d.windows.long));
  const time = str(r.digestTime, d.digestTime);
  return {
    savingsPct: clampNum(r.savingsPct, 0, 90, d.savingsPct),
    essentialsCategories: strList(r.essentialsCategories, d.essentialsCategories),
    fixedCategories: strList(r.fixedCategories, d.fixedCategories),
    excludedCategories: strList(r.excludedCategories, d.excludedCategories),
    incomeCategories: strList(r.incomeCategories, d.incomeCategories),
    carryingCategories: strList(r.carryingCategories, d.carryingCategories),
    cardPaymentPattern: str(r.cardPaymentPattern, d.cardPaymentPattern),
    cardCreditPaymentPattern: str(r.cardCreditPaymentPattern, d.cardCreditPaymentPattern),
    payrollPattern: str(r.payrollPattern, d.payrollPattern),
    windows: { short, mid, long },
    baselineDays: clampInt(r.baselineDays, 28, 365, d.baselineDays),
    warningDays: clampInt(r.warningDays, 1, 60, d.warningDays),
    alertDays: clampInt(r.alertDays, 1, 60, d.alertDays),
    deescalateDays: clampInt(r.deescalateDays, 1, 60, d.deescalateDays),
    alertMultiplier: clampNum(r.alertMultiplier, 1, 5, d.alertMultiplier),
    cardGrowthWeeks: clampInt(r.cardGrowthWeeks, 1, 26, d.cardGrowthWeeks),
    cardGrowthMin: clampNum(r.cardGrowthMin, 0, 100_000, d.cardGrowthMin),
    bigNightThreshold: clampNum(r.bigNightThreshold, 1, 1_000_000, d.bigNightThreshold),
    merchantStreakCount: clampInt(r.merchantStreakCount, 2, 50, d.merchantStreakCount),
    frequencyRatio: clampNum(r.frequencyRatio, 1, 10, d.frequencyRatio),
    frequencyDays: clampInt(r.frequencyDays, 1, 60, d.frequencyDays),
    spreadDays: clampInt(r.spreadDays, 2, 365, d.spreadDays),
    staleDays: clampInt(r.staleDays, 1, 30, d.staleDays),
    digestDay: clampInt(r.digestDay, 0, 6, d.digestDay),
    digestTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : d.digestTime,
  };
}

// ---- Inputs ------------------------------------------------------------------------------

/**
 * One piece of the ledger. A split transaction arrives as several pieces (its own remainder
 * plus each split part) sharing `id`; a cash withdrawal arrives as only its unaccounted part.
 */
export interface PaceTxn {
  id: number;
  date: string; // YYYY-MM-DD — the transaction date (a card purchase counts when made)
  amount: number; // magnitude, > 0
  direction: "Debit" | "Credit";
  category: string | null;
  description: string;
  accountId: number | null;
  /** Checking | Savings | Cash | Credit | Loan | … ; null when unknown. */
  accountType: string | null;
  billId: number | null;
  /** One side of an internal transfer pair. */
  isTransfer: boolean;
  pending: boolean;
}

export interface PaceBill {
  id: number;
  name: string;
  /** Paid by paying off a credit card — a card payment, not a fixed cost. */
  isCardPayment: boolean;
}

export type OneOffMode = "exclude" | "spread";
export interface PaceOneOff {
  txnId: number;
  mode: OneOffMode;
  note: string | null;
}

/** A card statement: balance due as of its closing date. */
export interface CardStatement {
  accountId: number;
  name: string;
  closedOn: string;
  balance: number;
}

export interface PaceInputs {
  txns: PaceTxn[];
  bills: PaceBill[];
  /** "YYYY-MM" → billId → that month's planned amount (non-cancelled instances only). */
  billAmounts: Map<string, Map<number, number>>;
  oneOffs: PaceOneOff[];
  statements?: CardStatement[];
  /** First date the ledger is trusted to be complete; baselines never reach before it. */
  historyStart: string;
}

// ---- Date helpers ------------------------------------------------------------------------

export const addDays = (iso: string, n: number) => utcToIso(isoToUtc(iso) + n * DAY_MS);
export const daysBetween = (a: string, b: string) => Math.round((isoToUtc(b) - isoToUtc(a)) / DAY_MS);
const monthOf = (iso: string) => iso.slice(0, 7);
function daysInMonth(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Classification ----------------------------------------------------------------------

export type PaceKind = "income" | "fixed" | "essential" | "carrying" | "discretionary" | "ignore";

function safeRegex(src: string): RegExp | null {
  if (!src.trim()) return null;
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
}

interface Classifier {
  (t: PaceTxn): PaceKind;
}

/** Where one piece of the ledger lands. Order matters: the first rule that fits wins. */
export function makeClassifier(cfg: PaceConfig, bills: PaceBill[]): Classifier {
  const excluded = new Set(cfg.excludedCategories);
  const essentials = new Set(cfg.essentialsCategories);
  const fixed = new Set(cfg.fixedCategories);
  const income = new Set(cfg.incomeCategories);
  const carrying = new Set(cfg.carryingCategories);
  const cardBills = new Set(bills.filter((b) => b.isCardPayment).map((b) => b.id));
  const fixedBills = new Set(bills.filter((b) => !b.isCardPayment).map((b) => b.id));
  const payDebit = safeRegex(cfg.cardPaymentPattern);
  const payCredit = safeRegex(cfg.cardCreditPaymentPattern);
  return (t) => {
    const cat = t.category;
    const onCard = t.accountType === "Credit";
    const onLoan = t.accountType === "Loan";
    if (t.isTransfer || (cat != null && excluded.has(cat))) return "ignore";
    if (t.billId != null && cardBills.has(t.billId)) return "ignore"; // paying a card off
    if (onLoan) return "ignore"; // loan-side ledger rows mirror payments made elsewhere
    if (t.direction === "Credit") {
      if (cat != null && income.has(cat)) return onCard ? "ignore" : "income";
      if (cat != null && carrying.has(cat)) return "ignore"; // rewards, interest refunds
      if (cat == null) {
        if (!onCard) return "ignore"; // an unlabeled deposit: not provably income or a refund
        if (payCredit?.test(t.description)) return "ignore";
        return "discretionary"; // a refund on a card
      }
      if (essentials.has(cat)) return "essential";
      if (fixed.has(cat)) return "fixed";
      return "discretionary"; // a refund in a spending category nets out
    }
    // Debits
    if (t.billId != null && fixedBills.has(t.billId)) return "fixed";
    if (cat != null && carrying.has(cat)) return "carrying";
    if (cat != null && income.has(cat)) return "ignore";
    if (cat != null && essentials.has(cat)) return "essential";
    if (cat != null && fixed.has(cat)) return "fixed";
    if (cat == null && !onCard && payDebit?.test(t.description)) return "ignore";
    return "discretionary";
  };
}

/**
 * Pending rows the bank later posted. Sync merges them in place, so the ledger rarely holds both;
 * a hand-entered pending row next to its imported twin is the case this catches. A pending row is
 * dropped when a posted row on the same account and direction, within −3…+10 days, has an amount
 * within a tip's reach and shares the merchant's first word (or the exact amount).
 */
export function dropPostedPending(txns: PaceTxn[]): PaceTxn[] {
  const posted = txns.filter((t) => !t.pending);
  const used = new Set<PaceTxn>();
  const firstWord = (d: string) => normalizeMerchant(d).split(" ")[0] ?? "";
  return txns.filter((p) => {
    if (!p.pending) return true;
    const twin = posted.find((q) => {
      if (used.has(q) || q.id === p.id) return false;
      if (q.accountId !== p.accountId || q.direction !== p.direction) return false;
      const gap = daysBetween(p.date, q.date);
      if (gap < -3 || gap > 10) return false;
      const exact = Math.abs(q.amount - p.amount) < 0.005;
      const near = Math.abs(q.amount - p.amount) <= Math.max(2, p.amount * 0.3);
      const fw = firstWord(p.description);
      return exact || (near && fw !== "" && fw === firstWord(q.description));
    });
    if (!twin) return true;
    used.add(twin);
    return false;
  });
}

// ---- Daily series ------------------------------------------------------------------------

export interface DayMerchant {
  merchant: string;
  amount: number;
  count: number;
}

interface Series {
  from: string;
  days: number;
  disc: Float64Array; // net discretionary (refunds subtract, spread one-offs added)
  count: Int32Array; // discretionary charges (debits)
  essential: Float64Array;
  fixedCat: Float64Array; // fixed-category spend NOT linked to a bill
  carrying: Float64Array;
  income: Float64Array;
  cardFlow: Float64Array; // net change in revolving card balances (charges − credits)
  merchants: Map<number, Map<string, DayMerchant>>; // day index → merchant → totals
  categories: Map<number, Map<string, number>>; // day index → category → net discretionary
  payroll: { date: string; amount: number }[];
  billSpend: Map<number, { date: string; amount: number }[]>;
}

/** "Restaurant/Bar" → "Restaurant/Bar"; null → "Uncategorized". Merchant label for display. */
export function merchantLabel(description: string): string {
  const key = normalizeMerchant(description);
  return key ? key.split(" ").slice(0, 3).join(" ") : description.trim().slice(0, 24) || "Unknown";
}

/** The amortized one-off amount added to each day of its spread. */
export function spreadPerDay(amount: number, spreadDays: number): number {
  return amount / spreadDays;
}

function buildSeries(inp: PaceInputs, cfg: PaceConfig, from: string, to: string): Series {
  const days = daysBetween(from, to) + 1;
  const s: Series = {
    from,
    days,
    disc: new Float64Array(days),
    count: new Int32Array(days),
    essential: new Float64Array(days),
    fixedCat: new Float64Array(days),
    carrying: new Float64Array(days),
    income: new Float64Array(days),
    cardFlow: new Float64Array(days),
    merchants: new Map(),
    categories: new Map(),
    payroll: [],
    billSpend: new Map(),
  };
  const classify = makeClassifier(cfg, inp.bills);
  const oneOff = new Map(inp.oneOffs.map((o) => [o.txnId, o]));
  const payroll = cfg.payrollPattern.trim() || null;
  const idx = (d: string) => daysBetween(from, d);
  for (const t of dropPostedPending(inp.txns)) {
    const i = idx(t.date);
    const sign = t.direction === "Debit" ? 1 : -1;
    // Revolving balance flow: everything that moves a card's balance, payments included.
    if (t.accountType === "Credit" && i >= 0 && i < days) s.cardFlow[i] += sign * t.amount;
    const tag = oneOff.get(t.id);
    if (tag?.mode === "exclude") continue;
    const kind = classify(t);
    if (kind === "ignore") continue;
    if (kind === "discretionary" && tag?.mode === "spread") {
      const per = spreadPerDay(sign * t.amount, cfg.spreadDays);
      for (let k = 0; k < cfg.spreadDays; k++) {
        const j = i + k;
        if (j >= 0 && j < days) s.disc[j] += per;
      }
      continue;
    }
    if (i < 0 || i >= days) continue;
    switch (kind) {
      case "income":
        s.income[i] += t.amount;
        if (isPayrollDescription(t.description, payroll)) s.payroll.push({ date: t.date, amount: t.amount });
        break;
      case "essential":
        s.essential[i] += sign * t.amount;
        break;
      case "carrying":
        s.carrying[i] += sign * t.amount;
        break;
      case "fixed":
        if (t.billId != null) {
          const list = s.billSpend.get(t.billId) ?? [];
          list.push({ date: t.date, amount: sign * t.amount });
          s.billSpend.set(t.billId, list);
        } else s.fixedCat[i] += sign * t.amount;
        break;
      case "discretionary": {
        s.disc[i] += sign * t.amount;
        if (sign > 0) s.count[i] += 1;
        const m = merchantLabel(t.description);
        const dm = s.merchants.get(i) ?? new Map<string, DayMerchant>();
        const cur = dm.get(m) ?? { merchant: m, amount: 0, count: 0 };
        cur.amount += sign * t.amount;
        if (sign > 0) cur.count += 1;
        dm.set(m, cur);
        s.merchants.set(i, dm);
        const cat = t.category ?? "Uncategorized";
        const dc = s.categories.get(i) ?? new Map<string, number>();
        dc.set(cat, (dc.get(cat) ?? 0) + sign * t.amount);
        s.categories.set(i, dc);
        break;
      }
    }
  }
  s.payroll.sort((a, b) => a.date.localeCompare(b.date));
  return s;
}

function sumRange(arr: Float64Array | Int32Array, lo: number, hi: number): number {
  let t = 0;
  for (let k = Math.max(0, lo); k <= Math.min(arr.length - 1, hi); k++) t += arr[k];
  return t;
}

// ---- Baselines & allowances --------------------------------------------------------------

/**
 * Monthly take-home from paychecks, smoothed for timing: same-week deposits (a split direct
 * deposit) are merged into one paycheck, then the median paycheck × paychecks per month at the
 * median spacing. A 90-day window holds six or seven biweekly checks depending on where it falls,
 * and a three-check month is just timing; the median spacing removes both. Null with fewer than
 * three paychecks — the caller then falls back to the plain average.
 */
export function smoothedPayroll(deposits: { date: string; amount: number }[]): number | null {
  const merged: { date: string; amount: number }[] = [];
  for (const d of [...deposits].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = merged[merged.length - 1];
    if (last && daysBetween(last.date, d.date) <= 3) last.amount += d.amount;
    else merged.push({ ...d });
  }
  if (merged.length < 3) return null;
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const gaps = merged.slice(1).map((d, k) => daysBetween(merged[k].date, d.date));
  const gap = median(gaps);
  if (gap <= 0) return null;
  return median(merged.map((d) => d.amount)) * (DAYS_PER_MONTH / gap);
}

export interface Allowances {
  income: number;
  fixed: number;
  essentials: number;
  savings: number;
  /** (income − fixed − essentials) / 30.4 */
  breakEven: number;
  /** (income − fixed − essentials − savings) / 30.4 */
  target: number;
}

/** The allowance math, from monthly figures. */
export function allowances(income: number, fixed: number, essentials: number, savingsPct: number): Allowances {
  const savings = income * (savingsPct / 100);
  const free = income - fixed - essentials;
  return {
    income: round2(income),
    fixed: round2(fixed),
    essentials: round2(essentials),
    savings: round2(savings),
    breakEven: round2(free / DAYS_PER_MONTH),
    target: round2((free - savings) / DAYS_PER_MONTH),
  };
}

interface Baselines extends Allowances {
  /** Days of history behind the baseline (less than baselineDays near the start of data). */
  coveredDays: number;
}

function baselinesAt(s: Series, inp: PaceInputs, cfg: PaceConfig, i: number): Baselines {
  const date = addDays(s.from, i);
  const startIso = addDays(date, -(cfg.baselineDays - 1));
  const lo = Math.max(i - cfg.baselineDays + 1, daysBetween(s.from, inp.historyStart), 0);
  const covered = i - lo + 1;
  const perMonth = DAYS_PER_MONTH / covered;
  const loIso = addDays(s.from, lo);

  // Income: smoothed paychecks plus everything else at its plain average.
  const inWindow = s.payroll.filter((p) => p.date >= loIso && p.date <= date && p.date >= startIso);
  const total = sumRange(s.income, lo, i);
  const smooth = smoothedPayroll(inWindow);
  const payrollTotal = inWindow.reduce((t, p) => t + p.amount, 0);
  const income = smooth != null ? smooth + (total - payrollTotal) * perMonth : total * perMonth;

  const essentials = Math.max(0, sumRange(s.essential, lo, i) * perMonth);

  // Fixed: this month's bill amounts where a bill has one, else the bill's own trailing average;
  // plus fixed-category spend no bill accounts for.
  const planned = inp.billAmounts.get(monthOf(date)) ?? new Map<number, number>();
  let fixed = 0;
  for (const b of inp.bills) {
    if (b.isCardPayment) continue;
    const amt = planned.get(b.id);
    if (amt != null && amt > 0) {
      fixed += amt;
      continue;
    }
    const spent = (s.billSpend.get(b.id) ?? []).filter((x) => x.date >= loIso && x.date <= date).reduce((t, x) => t + x.amount, 0);
    fixed += Math.max(0, spent * perMonth);
  }
  fixed += Math.max(0, sumRange(s.fixedCat, lo, i) * perMonth);

  return { ...allowances(income, fixed, essentials, cfg.savingsPct), coveredDays: covered };
}

// ---- Status machine ----------------------------------------------------------------------

export const PACE_LEVELS = ["green", "watch", "warning", "alert"] as const;
export type PaceLevel = (typeof PACE_LEVELS)[number];
export const levelRank = (l: PaceLevel) => PACE_LEVELS.indexOf(l);

/** One day's facts the status machine needs. */
export interface DayFacts {
  avgShort: number;
  avgMid: number;
  avgLong: number;
  target: number;
  breakEven: number;
  /** Consecutive whole weeks (ending today) in which revolving card balances grew. */
  cardGrowthWeeks: number;
}

export interface MachineState {
  status: PaceLevel;
  /** Consecutive days the mid average has been over break-even. */
  overBreakEvenDays: number;
  /** Consecutive days the Alert condition has held. */
  alertDays: number;
  /** Consecutive days the candidate level has been below the status, and the highest seen. */
  belowDays: number;
  belowPeak: PaceLevel;
}

export const INITIAL_STATE: MachineState = {
  status: "green",
  overBreakEvenDays: 0,
  alertDays: 0,
  belowDays: 0,
  belowPeak: "green",
};

export type PaceEvent = { kind: "escalate" | "deescalate"; from: PaceLevel; to: PaceLevel } | null;

/**
 * Advance the status by one daily evaluation.
 *
 * The candidate level is what today's numbers support, with each escalation's holding period
 * built in (Warning needs the mid average over break-even for `warningDays` evaluations in a row).
 * The status rises to the candidate at once — the hold already happened — but only falls after
 * `deescalateDays` consecutive days below its threshold, and then to the highest level the
 * candidate reached during those days. That asymmetry is the hysteresis: one quiet day doesn't clear a Warning, one loud day
 * doesn't raise one.
 */
export function stepStatus(prev: MachineState, f: DayFacts, cfg: PaceConfig): { state: MachineState; candidate: PaceLevel; event: PaceEvent } {
  const overBE = f.avgMid > f.breakEven;
  const overBreakEvenDays = overBE ? prev.overBreakEvenDays + 1 : 0;
  const alertCond = f.avgLong > f.breakEven * cfg.alertMultiplier || f.cardGrowthWeeks >= cfg.cardGrowthWeeks;
  const alertDays = alertCond ? prev.alertDays + 1 : 0;
  // Watch: mid average above target (between target and break-even, or above break-even but not
  // for long enough to be a Warning yet), or the short average over break-even.
  const watchCond = f.avgMid > f.target || f.avgShort > f.breakEven;

  let candidate: PaceLevel = "green";
  if (alertDays >= cfg.alertDays) candidate = "alert";
  else if (overBreakEvenDays >= cfg.warningDays) candidate = "warning";
  else if (watchCond) candidate = "watch";
  // Which level's threshold today's numbers cross, ignoring holding periods. De-escalation counts
  // days below the THRESHOLD: a day back over break-even resets a Warning's cool-down even though
  // the Warning's own 7-day hold would have to start over.
  const raw: PaceLevel = alertCond ? "alert" : overBE ? "warning" : watchCond ? "watch" : "green";

  let { status, belowDays, belowPeak } = prev;
  let event: PaceEvent = null;
  if (levelRank(candidate) > levelRank(status)) {
    event = { kind: "escalate", from: status, to: candidate };
    status = candidate;
    belowDays = 0;
    belowPeak = "green";
  } else if (levelRank(raw) < levelRank(status)) {
    belowDays += 1;
    if (levelRank(candidate) > levelRank(belowPeak)) belowPeak = candidate;
    if (belowDays >= cfg.deescalateDays) {
      event = { kind: "deescalate", from: status, to: belowPeak };
      status = belowPeak;
      belowDays = 0;
      belowPeak = "green";
    }
  } else {
    belowDays = 0;
    belowPeak = "green";
  }
  return { state: { status, overBreakEvenDays, alertDays, belowDays, belowPeak }, candidate, event };
}

// ---- Replay ------------------------------------------------------------------------------

/** How far before the first evaluated day the ledger must reach for every window and baseline. */
export function paceLookbackDays(cfg: PaceConfig): number {
  return Math.max(cfg.baselineDays + cfg.windows.short, cfg.windows.long, cfg.spreadDays) + 7 * (cfg.cardGrowthWeeks + 4) + 28;
}

/** Days replayed before "today" so the hysteresis has settled (status starts Green). */
export const REPLAY_DAYS = 120;

export interface PaceDay extends DayFacts {
  date: string;
  /** Net discretionary spend that day (spread one-offs included). */
  spend: number;
  charges: number;
  carrying: number;
  income: number;
  fixed: number;
  essentials: number;
  savings: number;
  candidate: PaceLevel;
  status: PaceLevel;
  event: PaceEvent;
}

export interface PaceTimeline {
  days: PaceDay[];
  series: Series;
}

/**
 * Evaluate every day from `evalFrom` to `to`, replaying the status machine from Green. Start the
 * replay well before the day you care about (the daily job uses ~120 days) so the hysteresis has
 * settled by then; the series itself reaches back far enough for every window and baseline.
 */
export function replayPace(inp: PaceInputs, cfg: PaceConfig, evalFrom: string, to: string): PaceTimeline {
  const seriesFrom = addDays(evalFrom, -paceLookbackDays(cfg));
  const s = buildSeries(inp, cfg, seriesFrom, to);
  const { short, mid, long } = cfg.windows;
  const avg = (i: number, w: number) => Math.max(0, sumRange(s.disc, i - w + 1, i)) / w;
  const weekGrew = (end: number) => sumRange(s.cardFlow, end - 27, end) > cfg.cardGrowthMin;
  let state = INITIAL_STATE;
  const days: PaceDay[] = [];
  for (let i = daysBetween(seriesFrom, evalFrom); i < s.days; i++) {
    const b = baselinesAt(s, inp, cfg, i);
    let weeks = 0;
    while (weeks < cfg.cardGrowthWeeks + 4 && weekGrew(i - 7 * weeks)) weeks++;
    const facts: DayFacts = {
      avgShort: round2(avg(i, short)),
      avgMid: round2(avg(i, mid)),
      avgLong: round2(avg(i, long)),
      target: b.target,
      breakEven: b.breakEven,
      cardGrowthWeeks: weeks,
    };
    const step = stepStatus(state, facts, cfg);
    state = step.state;
    days.push({
      ...facts,
      date: addDays(seriesFrom, i),
      spend: round2(s.disc[i]),
      charges: s.count[i],
      carrying: round2(s.carrying[i]),
      income: b.income,
      fixed: b.fixed,
      essentials: b.essentials,
      savings: b.savings,
      candidate: step.candidate,
      status: state.status,
      event: step.event,
    });
  }
  return { days, series: s };
}

// ---- Leading indicators ------------------------------------------------------------------

export interface MerchantTotal {
  merchant: string;
  amount: number;
  count: number;
}
export interface MerchantStreak extends MerchantTotal {
  from: string;
  to: string;
}
export interface BigNight {
  date: string;
  amount: number;
  topMerchants: MerchantTotal[];
}

export interface PaceIndicators {
  /** Discretionary charges per day: the last `short` days vs the 90-day norm before them. */
  frequency: { recent: number; norm: number; ratio: number | null; daysOver: number; flagged: boolean };
  streaks: MerchantStreak[];
  bigNights: BigNight[];
  /** Weeks of consecutive card-balance growth and this week's change. */
  cards: { growthWeeks: number; weekChange: number; lastWeekChange: number; unpaidStatements: { name: string; closedOn: string; balance: number; paid: number }[] };
  monthEnd: { projectedNet: number; spentSoFar: number; daysRemaining: number };
  topMerchants: MerchantTotal[];
  topCategories: { category: string; amount: number }[];
  carryingCost: number;
}

function merchantsOver(s: Series, lo: number, hi: number): MerchantTotal[] {
  const tot = new Map<string, MerchantTotal>();
  for (let k = Math.max(0, lo); k <= hi; k++) {
    for (const m of s.merchants.get(k)?.values() ?? []) {
      const cur = tot.get(m.merchant) ?? { merchant: m.merchant, amount: 0, count: 0 };
      cur.amount += m.amount;
      cur.count += m.count;
      tot.set(m.merchant, cur);
    }
  }
  return [...tot.values()].map((m) => ({ ...m, amount: round2(m.amount) })).sort((a, b) => b.amount - a.amount);
}

/** Indicators as of the timeline's last day (or `at`). They describe; they never set the status. */
export function paceIndicators(tl: PaceTimeline, inp: PaceInputs, cfg: PaceConfig, at?: string): PaceIndicators {
  const s = tl.series;
  const date = at ?? tl.days[tl.days.length - 1].date;
  const i = daysBetween(s.from, date);
  const day = tl.days.find((d) => d.date === date)!;
  const mid = cfg.windows.mid;
  const short = cfg.windows.short;

  // Charge frequency. The norm is the 90 days BEFORE the recent window, so a binge can't raise
  // its own yardstick.
  const rateAt = (k: number) => sumRange(s.count, k - short + 1, k) / short;
  const normAt = (k: number) => {
    const lo = Math.max(k - short - cfg.baselineDays + 1, daysBetween(s.from, inp.historyStart), 0);
    const hi = k - short;
    return hi >= lo ? sumRange(s.count, lo, hi) / (hi - lo + 1) : 0;
  };
  let daysOver = 0;
  while (daysOver < 120) {
    const k = i - daysOver;
    const n = normAt(k);
    if (k < 0 || n <= 0 || rateAt(k) <= n * cfg.frequencyRatio) break;
    daysOver++;
  }
  const norm = normAt(i);
  const recent = rateAt(i);

  // Merchant streaks: same merchant N+ times in the last 7 days.
  const streaks: MerchantStreak[] = merchantsOver(s, i - 6, i)
    .filter((m) => m.count >= cfg.merchantStreakCount)
    .map((m) => {
      const seen: string[] = [];
      for (let k = i - 6; k <= i; k++) if (s.merchants.get(k)?.get(m.merchant)?.count) seen.push(addDays(s.from, k));
      return { ...m, from: seen[0], to: seen[seen.length - 1] };
    });

  // Big nights inside the mid window.
  const bigNights: BigNight[] = [];
  for (let k = i - mid + 1; k <= i; k++) {
    if (k < 0) continue;
    if (s.disc[k] > cfg.bigNightThreshold) {
      bigNights.push({
        date: addDays(s.from, k),
        amount: round2(s.disc[k]),
        topMerchants: merchantsOver(s, k, k).slice(0, 3),
      });
    }
  }

  // Card behavior.
  const weekChange = round2(sumRange(s.cardFlow, i - 6, i));
  const lastWeekChange = round2(sumRange(s.cardFlow, i - 13, i - 7));
  const unpaidStatements: PaceIndicators["cards"]["unpaidStatements"] = [];
  const latest = new Map<number, CardStatement>();
  for (const st of inp.statements ?? []) {
    if (st.closedOn > date || st.balance <= 0) continue;
    const cur = latest.get(st.accountId);
    if (!cur || st.closedOn > cur.closedOn) latest.set(st.accountId, st);
  }
  for (const st of latest.values()) {
    const due = addDays(st.closedOn, 25);
    if (date <= due) continue; // still inside the grace period
    const paid = inp.txns
      .filter((t) => t.accountId === st.accountId && t.direction === "Credit" && t.date > st.closedOn && t.date <= due)
      .reduce((tot, t) => tot + t.amount, 0);
    if (paid < st.balance - 1) unpaidStatements.push({ name: st.name, closedOn: st.closedOn, balance: st.balance, paid: round2(paid) });
  }

  // Projected month-end net: baseline income − (fixed + essentials + discretionary so far this
  // month + the mid pace for every day left).
  const monthStart = daysBetween(s.from, `${monthOf(date)}-01`);
  const spentSoFar = round2(Math.max(0, sumRange(s.disc, monthStart, i)));
  const daysRemaining = daysInMonth(date) - Number(date.slice(8, 10));
  const projectedNet = round2(day.income - (day.fixed + day.essentials + spentSoFar + day.avgMid * daysRemaining));

  const cats = new Map<string, number>();
  for (let k = i - mid + 1; k <= i; k++) for (const [c, v] of s.categories.get(k) ?? []) cats.set(c, (cats.get(c) ?? 0) + v);
  const topCategories = [...cats].map(([category, amount]) => ({ category, amount: round2(amount) })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);

  return {
    frequency: { recent: round2(recent), norm: round2(norm), ratio: norm > 0 ? round2(recent / norm) : null, daysOver, flagged: daysOver >= cfg.frequencyDays },
    streaks,
    bigNights,
    cards: { growthWeeks: day.cardGrowthWeeks, weekChange, lastWeekChange, unpaidStatements },
    monthEnd: { projectedNet, spentSoFar, daysRemaining },
    topMerchants: merchantsOver(s, i - mid + 1, i).filter((m) => m.amount > 0).slice(0, 5),
    topCategories,
    carryingCost: round2(sumRange(s.carrying, i - mid + 1, i)),
  };
}

// ---- Wording -----------------------------------------------------------------------------

export const LEVEL_LABEL: Record<PaceLevel | "stale", string> = {
  green: "Green",
  watch: "Watch",
  warning: "Warning",
  alert: "Alert",
  stale: "Stale",
};

const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const usd2 = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Restaurant/Bar" → "restaurant and bar". */
export function categoryPhrase(category: string): string {
  return category === "Uncategorized" ? "uncategorized charges" : category.replace(/\s*\/\s*/g, " and ").toLowerCase();
}

/**
 * The digest's one plain-language sentence. Numbers, not judgments; no exclamation marks.
 * e.g. "You're running about $40/day over break-even for the second week; most of it is restaurant and bar."
 */
export function paceSentence(day: PaceDay, ind: Pick<PaceIndicators, "topCategories">, overDays: number): string {
  const top = ind.topCategories[0];
  const total = ind.topCategories.reduce((t, c) => t + c.amount, 0);
  const share = top && total > 0 ? top.amount / total : 0;
  const where = top ? (share >= 0.5 ? `; most of it is ${categoryPhrase(top.category)}` : `; the largest share is ${categoryPhrase(top.category)}`) : "";
  const overBE = day.avgMid - day.breakEven;
  if (overBE > 0) {
    const week = Math.max(1, Math.ceil(overDays / 7));
    const when = week >= 2 && week < ORDINAL.length ? ` for the ${ORDINAL[week]} week` : week >= ORDINAL.length ? ` for ${week} weeks` : "";
    return `You're running about ${usd(overBE)}/day over break-even${when}${where}.`;
  }
  const overTarget = day.avgMid - day.target;
  if (overTarget > 0) return `You're about ${usd(overTarget)}/day over target and ${usd(-overBE)}/day under break-even${where}.`;
  return `You're about ${usd(-overTarget)}/day under target over the last 14 days.`;
}

export interface PaceDigest {
  title: string;
  body: string;
  sentence: string;
}

/** The weekly digest, as a short plain-text/markdown note. */
export function buildDigest(tl: PaceTimeline, ind: PaceIndicators, cfg: PaceConfig, stale: boolean): PaceDigest {
  const day = tl.days[tl.days.length - 1];
  let overDays = 0;
  for (let k = tl.days.length - 1; k >= 0 && tl.days[k].avgMid > tl.days[k].breakEven; k--) overDays++;
  const sentence = paceSentence(day, ind, overDays);
  const status = stale ? "Stale (bank sync is behind; numbers below may be incomplete)" : LEVEL_LABEL[day.status];
  const lines = [
    `Status: ${status}`,
    `${cfg.windows.mid}-day pace: ${usd2(day.avgMid)}/day · target ${usd2(day.target)} · break-even ${usd2(day.breakEven)}`,
    `Projected month-end net: ${ind.monthEnd.projectedNet < 0 ? "−" : ""}${usd(ind.monthEnd.projectedNet)}`,
  ];
  if (ind.topMerchants.length) {
    lines.push("", `Top merchants (${cfg.windows.mid} days):`);
    for (const m of ind.topMerchants) lines.push(`- ${m.merchant}: ${usd2(m.amount)} (${m.count}×)`);
  }
  if (ind.streaks.length) {
    lines.push("", "Streaks (7 days):");
    for (const st of ind.streaks) lines.push(`- ${st.merchant}: ${st.count} times, ${usd2(st.amount)}`);
  }
  if (ind.bigNights.length) {
    lines.push("", `Days over ${usd(cfg.bigNightThreshold)}:`);
    for (const b of ind.bigNights) lines.push(`- ${b.date}: ${usd2(b.amount)}${b.topMerchants.length ? ` (${b.topMerchants.map((m) => m.merchant).join(", ")})` : ""}`);
  }
  if (ind.carryingCost > 0) lines.push("", `Cost of carrying debt (${cfg.windows.mid} days): ${usd2(ind.carryingCost)}`);
  lines.push("", sentence);
  return { title: `Spending pace: ${LEVEL_LABEL[stale ? "stale" : day.status]}, ${usd(day.avgMid)}/day`, body: lines.join("\n"), sentence };
}

/** The escalation notice — only ever for Warning or Alert. */
export function escalationNotice(day: PaceDay, ind: PaceIndicators, cfg: PaceConfig): PaceDigest {
  const reason =
    day.status === "alert"
      ? day.avgLong > day.breakEven * cfg.alertMultiplier
        ? `The ${cfg.windows.long}-day average is ${usd2(day.avgLong)}/day, over ${cfg.alertMultiplier}× break-even (${usd2(day.breakEven * cfg.alertMultiplier)}).`
        : `Card balances have grown ${day.cardGrowthWeeks} weeks in a row.`
      : `The ${cfg.windows.mid}-day average has been over break-even (${usd2(day.breakEven)}/day) for ${cfg.warningDays}+ days; it is ${usd2(day.avgMid)}/day.`;
  let overDays = 0;
  // Approximate from the facts available on the day itself.
  if (day.avgMid > day.breakEven) overDays = cfg.warningDays;
  const sentence = paceSentence(day, ind, overDays);
  return {
    title: `Spending pace moved to ${LEVEL_LABEL[day.status]}`,
    body: [reason, `Projected month-end net: ${ind.monthEnd.projectedNet < 0 ? "−" : ""}${usd(ind.monthEnd.projectedNet)}.`, sentence].join("\n\n"),
    sentence,
  };
}

/** Should a notice go out for this event? Only escalations to Warning or Alert. */
export function shouldNotify(event: PaceEvent): event is { kind: "escalate"; from: PaceLevel; to: PaceLevel } {
  return !!event && event.kind === "escalate" && (event.to === "warning" || event.to === "alert");
}

/**
 * Is the weekly digest due? `now` is broken into local parts by the caller. Due once the digest
 * day's time has passed, at most once per calendar date.
 */
export function digestDue(local: { date: string; weekday: number; minutes: number }, cfg: PaceConfig, lastDigestOn: string | null): boolean {
  if (local.weekday !== cfg.digestDay) return false;
  const [h, m] = cfg.digestTime.split(":").map(Number);
  if (local.minutes < h * 60 + m) return false;
  return lastDigestOn !== local.date;
}

/** Today's remaining allowance: target per day minus what today has already spent. */
export function remainingToday(day: PaceDay): number {
  return round2(day.target - Math.max(0, day.spend));
}

// ---- Drill-down helpers ------------------------------------------------------------------

/** Merchant totals over the last `days` days of the timeline (net of refunds). */
export function merchantBreakdown(tl: PaceTimeline, days: number): MerchantTotal[] {
  const s = tl.series;
  const i = daysBetween(s.from, tl.days[tl.days.length - 1].date);
  return merchantsOver(s, i - days + 1, i).filter((m) => m.amount > 0);
}

/** Category totals over the last `days` days of the timeline (net of refunds). */
export function categoryBreakdown(tl: PaceTimeline, days: number): { category: string; amount: number }[] {
  const s = tl.series;
  const i = daysBetween(s.from, tl.days[tl.days.length - 1].date);
  const cats = new Map<string, number>();
  for (let k = i - days + 1; k <= i; k++) for (const [c, v] of s.categories.get(k) ?? []) cats.set(c, (cats.get(c) ?? 0) + v);
  return [...cats].map(([category, amount]) => ({ category, amount: round2(amount) })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
}

/**
 * Discretionary charges in [from, to] of at least `min`, largest first — the rows worth offering a
 * one-off tag. Offering is all this does: nothing is tagged unless the user chooses to.
 */
export function discretionaryCharges(inp: PaceInputs, cfg: PaceConfig, from: string, to: string, min: number): PaceTxn[] {
  const classify = makeClassifier(cfg, inp.bills);
  const byId = new Map<number, PaceTxn>();
  for (const t of dropPostedPending(inp.txns)) {
    if (t.date < from || t.date > to || t.direction !== "Debit" || classify(t) !== "discretionary") continue;
    const cur = byId.get(t.id);
    byId.set(t.id, cur ? { ...cur, amount: cur.amount + t.amount } : { ...t });
  }
  return [...byId.values()].filter((t) => t.amount >= min).sort((a, b) => b.amount - a.amount);
}

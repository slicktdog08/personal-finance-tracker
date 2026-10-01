// Match a pay SCHEDULE against the payroll deposits that actually landed, so the projection
// adds only the part of a payday that hasn't arrived yet.
//
// Why this exists: a schedule says "$3,000.01 on the 21st". Reality is a split direct deposit —
// two halves of about $1,500 that can land on the 20th and the 22nd. Anchored on the 20th, the old
// projection had one half already inside the recorded balance AND added the whole $3,000.01 on
// top, overstating month-end by exactly one half. The same shape breaks
// any schedule whose real deposits drift off their nominal date: a Friday payday paid Thursday
// before a holiday, a bank that posts at 11pm, a two-account split.
//
// The model: one scheduled payday is a BUCKET with a dollar need. Every deposit that lands within
// `windowDays` of it may fill that bucket, however many deposits that takes. What's left of the
// bucket is the residual — the only part the projection should still add. A deposit no bucket
// wanted (a bonus, a refund, a reimbursement) is reported as `unmatched` rather than silently
// eaten, because it is real money the plan didn't know about.
//
// Only feed in deposits the anchor balance ALREADY contains (date ≤ the projection's `asOf`).
// A deposit the balance hasn't seen yet is still the future, and the schedule is what covers it.

import { round2 } from "@/server/lib/budget";
import { daysBetween } from "@/server/lib/pay-schedule";

// A residual this small is rounding, not money: splitting $3,000.01 in two gives halves of
// $1,500.005 that the bank pays as $1,500.01 / $1,500.00, so the arrived total can miss by a cent
// per deposit. Tolerating exactly that and no more keeps a genuinely short paycheck visible — a
// flat "close enough" band would quietly swallow it.
const roundingSlack = (deposits: number) => 0.01 * Math.max(1, deposits);
/** Any bucket still short by more than its rounding slack needs a residual. */
const HUNGRY = 0.01;

/** How far a deposit may drift from its nominal payday and still count as that payday. */
export const DEFAULT_DEPOSIT_WINDOW_DAYS = 3;

/** Descriptions that read as payroll when no explicit pattern is configured. */
export const DEFAULT_DEPOSIT_MATCH = "payroll|direct dep|dir dep|salary|payco|gusto|adp";

export interface ScheduledPayday {
  date: string;
  amount: number;
}

export interface ObservedDeposit {
  /** Transaction id, for explaining the match in the UI. */
  id?: number;
  date: string;
  amount: number;
  description?: string;
  /** A hand-entered or bank-pending row. Still real money once it's inside the anchor balance. */
  pending?: boolean;
}

export interface PaydayMatch {
  /** The scheduled payday this bucket came from. */
  date: string;
  expected: number;
  /** Deposits that landed against it, ascending by date. */
  deposits: ObservedDeposit[];
  arrived: number;
  /** Still expected — what the projection adds. 0 once the payday is fully in. */
  residual: number;
  /** True when `arrived` covers `expected` (within a half-cent). */
  complete: boolean;
}

export interface PaydayReconciliation {
  /** One per scheduled payday, in date order — the audit trail behind the residuals. */
  matches: PaydayMatch[];
  /** What the walk should still add: only the unarrived part of each payday. */
  residuals: ScheduledPayday[];
  /** Deposits no payday claimed — income the plan didn't anticipate. */
  unmatched: ObservedDeposit[];
  /** Every deposit that was credited to a payday, summed. */
  arrivedTotal: number;
}

export interface ReconcileInput {
  scheduled: ScheduledPayday[];
  /** Deposits already reflected in the anchor balance. Order doesn't matter. */
  deposits: ObservedDeposit[];
  /** ± days a deposit may drift from its payday. Default 3. */
  windowDays?: number;
}

/**
 * Fill each scheduled payday from the deposits that landed near it.
 *
 * Deposits are walked oldest-first and each is spent on ONE payday: of the paydays within the
 * window, the one still owed the most, breaking ties by date proximity. "Still owed the most"
 * is what makes a split deposit work — the second half finds the same half-filled bucket as the
 * first instead of drifting to a neighbouring payday. A deposit that overshoots its bucket is
 * kept whole in that bucket (so `arrived` can exceed `expected`); a deposit with no bucket in
 * range is returned in `unmatched`.
 */
export function reconcilePaydays(input: ReconcileInput): PaydayReconciliation {
  const windowDays = Math.max(0, input.windowDays ?? DEFAULT_DEPOSIT_WINDOW_DAYS);
  const buckets: PaydayMatch[] = [...input.scheduled]
    .filter((p) => p.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((p) => ({ date: p.date, expected: round2(p.amount), deposits: [], arrived: 0, residual: round2(p.amount), complete: false }));

  const unmatched: ObservedDeposit[] = [];
  const deposits = [...input.deposits]
    .filter((d) => d.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const dep of deposits) {
    const inRange = buckets
      .map((b, i) => ({ i, b, gap: Math.abs(daysBetween(b.date, dep.date)) }))
      .filter((c) => c.gap <= windowDays);
    if (!inRange.length) {
      unmatched.push(dep);
      continue;
    }
    // Prefer the hungriest bucket; among equally hungry ones, the nearest date.
    inRange.sort((a, b) => b.b.residual - a.b.residual || a.gap - b.gap || a.i - b.i);
    const need = inRange.find((c) => c.b.residual > HUNGRY) ?? inRange[0];
    need.b.deposits.push(dep);
    need.b.arrived = round2(need.b.arrived + dep.amount);
    need.b.residual = round2(Math.max(0, need.b.expected - need.b.arrived));
  }

  for (const b of buckets) {
    b.complete = b.residual <= roundingSlack(b.deposits.length);
    if (b.complete) b.residual = 0;
  }

  return {
    matches: buckets,
    residuals: buckets.filter((b) => b.residual > 0).map((b) => ({ date: b.date, amount: b.residual })),
    unmatched,
    arrivedTotal: round2(buckets.reduce((s, b) => s + b.arrived, 0)),
  };
}

/**
 * Does this credit read as payroll? `pattern` is a case-insensitive regex alternation
 * (`pay_schedule.deposit_match`, defaulting to DEFAULT_DEPOSIT_MATCH). An invalid pattern
 * matches nothing rather than throwing mid-projection.
 */
export function isPayrollDescription(description: string | null | undefined, pattern?: string | null): boolean {
  if (!description) return false;
  try {
    return new RegExp(pattern?.trim() || DEFAULT_DEPOSIT_MATCH, "i").test(description);
  } catch {
    return false;
  }
}

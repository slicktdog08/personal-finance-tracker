// How a budget month actually went — the close-out report. Pure (no DB) so the page's live
// preview, the stored snapshot written when a month is finalized, and the tests share one rule.
//
// "By the plan" sweeps every envelope back into one number:
//
//   unallocated  = planned income − everything planned (debt + everyday + savings)
//   + income variance          actual income − planned income
//   + swept                    Σ unspent everyday envelopes (planned − spent, where positive)
//   − overspent                Σ everyday envelopes past their plan
//   − unplanned                spending in categories with no envelope
//   + debt variance            Σ (due − paid toward each debt line): under-paying a debt frees
//                              cash, paying extra beyond the plan uses it
//   = leftover                 cash the month didn't use, beyond the savings line
//   − interest + rewards       what carrying the cards cost (rewards/cashback net against it)
//   = outcome
//
// "By the balances" is the reality check: what cash on hand and debt actually did. The two can
// disagree — transfers, money in pending, a snapshot recorded a few days late — so the report
// shows both rather than forcing one to match the other.

export const OUTCOME_VERSION = 1;

export interface OutcomeLineInput {
  kind: string; // category | debt | savings
  label: string;
  planned: number;
  /** Everyday: spent. Debt: paid toward the line (minimum + payoff). */
  actual: number;
  /** Debt lines: what the envelope measured against (BudgetLineRow.due). */
  due?: number;
  /** Debt lines: every linked payment (BudgetLineRow.paid). */
  paid?: number;
}

export interface OutcomeInput {
  periodLabel: string;
  plannedIncome: number | null;
  actualIncome: number;
  lines: OutcomeLineInput[];
  unplanned: { total: number; categories: { category: string | null; amount: number }[] };
  /** Interest charged on liabilities this month, and rewards/cashback credited to them. */
  interest: number;
  rewards: number;
  cash: { start: number | null; end: number | null };
  debt: { start: number | null; end: number | null };
}

export interface OutcomeLine {
  label: string;
  planned: number;
  actual: number;
  /** planned − actual: positive = under plan (swept), negative = over. */
  variance: number;
}

export interface BudgetOutcome {
  version: number;
  periodLabel: string;
  income: { planned: number | null; actual: number; variance: number };
  plannedTotal: number;
  unallocated: number;
  everyday: { planned: number; spent: number; swept: number; overspent: number; lines: OutcomeLine[] };
  unplanned: OutcomeInput["unplanned"];
  debt: {
    planned: number;
    paidToward: number;
    paidTotal: number;
    /** Σ (due − paid toward): + = paid less than planned, − = paid extra. */
    variance: number;
    lines: OutcomeLine[];
    interest: number;
    rewards: number;
    balanceStart: number | null;
    balanceEnd: number | null;
    /** balanceEnd − balanceStart: negative = debt went down. */
    change: number | null;
  };
  savings: { planned: number; cashStart: number | null; cashEnd: number | null; cashChange: number | null };
  /** By the plan, before interest. */
  leftover: number;
  /** leftover − interest + rewards. */
  outcome: number;
  /** By the balances: cash change minus the change in debt (+ = better off). */
  netChange: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

export function budgetOutcome(i: OutcomeInput): BudgetOutcome {
  const everydayLines = i.lines.filter((l) => l.kind === "category");
  const debtLines = i.lines.filter((l) => l.kind === "debt");
  const savingsLines = i.lines.filter((l) => l.kind === "savings");

  const plannedTotal = sum(i.lines.map((l) => l.planned));
  const unallocated = i.plannedIncome != null ? round2(i.plannedIncome - plannedTotal) : 0;
  const incomeVariance = i.plannedIncome != null ? round2(i.actualIncome - i.plannedIncome) : 0;

  const everyday = everydayLines.map((l) => ({ label: l.label, planned: round2(l.planned), actual: round2(l.actual), variance: round2(l.planned - l.actual) }));
  const swept = sum(everyday.map((l) => Math.max(0, l.variance)));
  const overspent = sum(everyday.map((l) => Math.max(0, -l.variance)));

  const debts = debtLines.map((l) => {
    const due = l.due ?? l.planned;
    return { label: l.label, planned: round2(due), actual: round2(l.actual), variance: round2(due - l.actual) };
  });
  const debtVariance = sum(debts.map((l) => l.variance));

  const leftover = round2(unallocated + incomeVariance + swept - overspent - i.unplanned.total + debtVariance);
  const outcome = round2(leftover - i.interest + i.rewards);

  const cashChange = i.cash.start != null && i.cash.end != null ? round2(i.cash.end - i.cash.start) : null;
  const debtChange = i.debt.start != null && i.debt.end != null ? round2(i.debt.end - i.debt.start) : null;

  return {
    version: OUTCOME_VERSION,
    periodLabel: i.periodLabel,
    income: { planned: i.plannedIncome, actual: round2(i.actualIncome), variance: incomeVariance },
    plannedTotal,
    unallocated,
    everyday: {
      planned: sum(everyday.map((l) => l.planned)),
      spent: sum(everyday.map((l) => l.actual)),
      swept,
      overspent,
      lines: everyday.sort((a, b) => a.variance - b.variance),
    },
    unplanned: i.unplanned,
    debt: {
      planned: sum(debts.map((l) => l.planned)),
      paidToward: sum(debts.map((l) => l.actual)),
      paidTotal: sum(debtLines.map((l) => l.paid ?? l.actual)),
      variance: debtVariance,
      lines: debts,
      interest: round2(i.interest),
      rewards: round2(i.rewards),
      balanceStart: i.debt.start,
      balanceEnd: i.debt.end,
      change: debtChange,
    },
    savings: { planned: sum(savingsLines.map((l) => l.planned)), cashStart: i.cash.start, cashEnd: i.cash.end, cashChange },
    leftover,
    outcome,
    netChange: cashChange != null && debtChange != null ? round2(cashChange - debtChange) : null,
  };
}

/** The report for a budget view as it stands right now (live preview, or what finalize freezes). */
export function outcomeFromView(v: {
  periodLabel: string;
  plannedIncome: number | null;
  actualIncome: number;
  lines: { kind: string; label: string; planned: number; actual: number; due: number; paid: number }[];
  unplannedSpend: OutcomeInput["unplanned"];
  carryCost: { interest: number; rewards: number };
  cash: { start: number | null; now: number | null };
  debtTotals: { start: number | null; end: number | null };
}): BudgetOutcome {
  return budgetOutcome({
    periodLabel: v.periodLabel,
    plannedIncome: v.plannedIncome,
    actualIncome: v.actualIncome,
    lines: v.lines.map((l) => ({ kind: l.kind, label: l.label, planned: l.planned, actual: l.actual, due: l.kind === "debt" ? l.due : undefined, paid: l.kind === "debt" ? l.paid : undefined })),
    unplanned: v.unplannedSpend,
    interest: v.carryCost.interest,
    rewards: v.carryCost.rewards,
    cash: { start: v.cash.start, end: v.cash.now },
    debt: v.debtTotals,
  });
}

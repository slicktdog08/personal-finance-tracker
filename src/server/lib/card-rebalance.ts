// "What do I owe my cards right now?" — how far each credit card has climbed above the balance it
// should be at. That growth is what to pay to rebalance the card after charging to it.
// Pure (no DB) so the dashboard, the budget page and the tests share one rule.
//
// The bank's current balance lags spending: charges still pending aren't in it yet. So "today" is
// that balance plus the card's pending activity (pending charges add, pending credits/payments
// subtract) — the same figure as credit limit − available credit. A payment still pending on the
// account it's paid FROM (checking, linked to the card's bill) hasn't reached the card at all yet,
// so it comes off too; otherwise it would count as "paid" for the plan while the balance it pays
// down still looks untouched.
//
// Which balance it "should be at" depends on the month's budgeted payoff payment:
//   - not made yet → the month's starting balance (the payoff is still to come, on top of this)
//   - made         → where the plan leaves the card: start + interest − planned. Otherwise the
//                    bulk payment would hide every charge made after it.
// "Made" = payments linked to the card's bill this month reach the planned amount.
//
//   today  = balance + pending − pendingPayments
//   target = planPaid ? start + interest − planned : start      (never below 0)
//   owe    = today − target        (never below 0)
//
// Credit balances. A card paid past zero holds a credit (a negative balance), and that credit
// absorbs new charges before anything is owed. Two things used to hide it:
//   - Many banks report a card in credit as a balance of 0. When the bank says 0 but the month's
//     starting balance plus every posted row since is negative, that ledger figure is used instead.
//   - A planned payoff bigger than the card owed made the plan's balance negative, so the target
//     asked for a credit back. A plan can't expect a card below 0: the extra payment is a credit
//     that covers charges, so the target floors at 0.

import { toNum } from "./money";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CardRebalanceInput {
  accountId: number;
  label: string;
  /** Balance owed when the month began (or the first one recorded this month). */
  start: number | null;
  startAsOf: string | null;
  /** Latest recorded balance owed (posted only — pending charges aren't in it). */
  balance: number | null;
  nowAsOf: string | null;
  /**
   * Net posted activity on the card since `startAsOf` (charges minus credits/payments), when
   * known. Used only to recover a credit balance the bank reports as 0.
   */
  postedSince?: number | null;
  /** Net pending activity on the card: charges minus credits. */
  pending: number;
  /** Payments still pending on another account (linked to this card's bill), not yet on the card. */
  pendingPayments?: number;
  /** This month's budget line for the card, if it has one. */
  plan?: RebalancePlan | null;
}

export interface RebalancePlan {
  /** The budget's payoff payment for the month. */
  planned: number;
  apr: number | null;
  /** Every payment linked to the card's bill this month (BudgetLineRow.paid). */
  paid: number;
}

export interface CardRebalanceRow extends CardRebalanceInput {
  start: number;
  balance: number;
  pendingPayments: number;
  /** The balance the bank reported, when `balance` was replaced by the ledger's credit balance. */
  bankBalance: number | null;
  /** balance + pending − pendingPayments: what's really on the card right now. */
  now: number;
  /** today − start: positive = the balance grew this month. */
  change: number;
  /** Balance the plan expects by month end (start + interest − planned); null with no plan payment. */
  expected: number | null;
  /** The month's planned payoff has been paid, so `target` is `expected` rather than `start`. */
  planPaid: boolean;
  /** The balance the card should be at right now. */
  target: number;
  /** Pay this much to bring the card back to `target`. */
  owe: number;
}

/** start + a month's interest on it − the planned payment: the cash projection's own step. */
function expectedBalance(start: number, plan: RebalancePlan | null | undefined): number | null {
  if (!plan || plan.planned <= 0) return null;
  const interest = plan.apr != null && plan.apr > 0 && start > 0 ? (start * plan.apr) / 100 / 12 : 0;
  return round2(Math.max(0, start + interest - plan.planned));
}

/** The bank's balance, or — when it says 0 but the ledger says the card is in credit — the ledger's. */
function effectiveBalance(c: CardRebalanceInput & { start: number; balance: number }): { balance: number; bankBalance: number | null } {
  if (Math.abs(c.balance) >= 0.005 || c.postedSince == null) return { balance: c.balance, bankBalance: null };
  const ledger = round2(c.start + c.postedSince);
  return ledger <= -0.005 ? { balance: ledger, bankBalance: c.balance } : { balance: c.balance, bankBalance: null };
}

export interface CardRebalance {
  rows: CardRebalanceRow[];
  owe: number;
  /** Cards left out because a starting or current balance was never recorded. */
  missing: string[];
}

export function cardRebalance(cards: CardRebalanceInput[]): CardRebalance {
  const rows: CardRebalanceRow[] = [];
  const missing: string[] = [];
  for (const c of cards) {
    if (c.start == null || c.balance == null) {
      missing.push(c.label);
      continue;
    }
    const pendingPayments = c.pendingPayments ?? 0;
    const { balance, bankBalance } = effectiveBalance({ ...c, start: c.start, balance: c.balance });
    const now = round2(balance + c.pending - pendingPayments);
    const change = round2(now - c.start);
    const expected = expectedBalance(c.start, c.plan);
    const planPaid = expected != null && c.plan!.paid >= c.plan!.planned;
    const target = Math.max(0, planPaid ? expected! : c.start);
    const owe = round2(Math.max(0, now - target));
    rows.push({ ...c, start: c.start, balance, bankBalance, pendingPayments, now, change, expected, planPaid, target, owe });
  }
  // Biggest payment first; cards at or under their starting balance fall to the bottom.
  rows.sort((a, b) => b.owe - a.owe || b.now - a.now);
  return { rows, owe: round2(rows.reduce((t, r) => t + r.owe, 0)), missing };
}

/** The slice of a liability row the rebalance needs (see getLiabilityAccounts). */
export interface RebalanceCard {
  id: number;
  label: string | null;
  institution: string | null;
  accountNumber: string;
  accountType: string;
  active: boolean;
  balance: string | number | null;
  asOf: string | null;
  /** The card's bill: pending payments linked to it from other accounts are on their way. */
  billId?: number | null;
}

/** The slice of a pending transaction the rebalance needs (see getPendingTransactions). */
export interface RebalancePending {
  id?: number;
  accountId: number | null;
  amount: string | number;
  direction: string;
  billId?: number | null;
  transferPartnerId?: number | null;
}

/**
 * Builds the rebalance from raw rows: active credit cards, their start-of-month balances, and every
 * pending transaction (netted per card — Debit adds, Credit subtracts). A pending Debit on another
 * account linked to a card's bill is a payment on its way to that card and comes off its balance —
 * unless its transfer twin is already pending on the card, which counts it once already. Shared by
 * the dashboard widget, the budget page and the MCP tool so all report the same figure.
 */
export function cardRebalanceFrom(
  liabilities: RebalanceCard[],
  start: Map<number, { balance: number; asOf: string; postedSince?: number | null }>,
  pendingTxns: RebalancePending[],
  plans: Map<number, RebalancePlan> = new Map(),
): CardRebalance {
  const pendingByAccount = new Map<number, number>();
  for (const t of pendingTxns) {
    if (t.accountId == null) continue;
    const amt = (toNum(t.amount) ?? 0) * (t.direction === "Credit" ? -1 : 1);
    pendingByAccount.set(t.accountId, (pendingByAccount.get(t.accountId) ?? 0) + amt);
  }
  const cardByBill = new Map<number, number>();
  for (const a of liabilities) if (a.billId != null) cardByBill.set(a.billId, a.id);
  const pendingById = new Map(pendingTxns.filter((t) => t.id != null).map((t) => [t.id!, t]));
  const paymentsByCard = new Map<number, number>();
  for (const t of pendingTxns) {
    if (t.billId == null || t.direction !== "Debit") continue;
    const cardId = cardByBill.get(t.billId);
    if (cardId == null || t.accountId === cardId) continue; // the card's own linked rows are charges
    const twin = t.transferPartnerId != null ? pendingById.get(t.transferPartnerId) : undefined;
    if (twin?.accountId === cardId) continue; // already netted into the card's own pending
    paymentsByCard.set(cardId, (paymentsByCard.get(cardId) ?? 0) + (toNum(t.amount) ?? 0));
  }
  return cardRebalance(
    liabilities
      .filter((a) => a.accountType === "Credit" && a.active)
      .map((a) => ({
        accountId: a.id,
        label: a.label || a.institution || `··${a.accountNumber.slice(-4)}`,
        start: start.get(a.id)?.balance ?? null,
        startAsOf: start.get(a.id)?.asOf ?? null,
        balance: toNum(a.balance),
        nowAsOf: a.asOf,
        postedSince: start.get(a.id)?.postedSince ?? null,
        pending: round2(pendingByAccount.get(a.id) ?? 0),
        pendingPayments: round2(paymentsByCard.get(a.id) ?? 0),
        plan: plans.get(a.id) ?? null,
      })),
  );
}

/** Per-card plans from a budget's debt lines (BudgetLineRow carries planned, paid and apr). */
export function rebalancePlans(
  lines: { kind: string; accountId: number | null; planned: number; paid: number; apr: number | null }[],
): Map<number, RebalancePlan> {
  const out = new Map<number, RebalancePlan>();
  for (const l of lines) {
    if (l.kind !== "debt" || l.accountId == null) continue;
    out.set(l.accountId, { planned: l.planned, apr: l.apr, paid: l.paid });
  }
  return out;
}

// ---- Behind on a card ----------------------------------------------------------------------
// The budget's debt cards reuse the rebalance row above — same balance + pending vs. target —
// so the card and the dashboard widget can never disagree about whether spending outpaced
// payments. On top of it, the plan: by month end the plan expects the card at `expected`.
//
//   toCover = row.owe                         back to the row's target (dashboard rule)
//   toPlan  = max(0, now − expected) − toCover   the plan's paydown still to go on top of that
//
// Before the payoff is made toPlan is just "the payment you haven't made yet"; once it's made the
// target IS expected, so toPlan is 0 and toCover is everything charged since.

export interface CardStanding {
  /** Pay this much to bring the card back to its month-start balance (the dashboard's `owe`). */
  toCover: number;
  /** Then this much more to reach the balance the plan expects at month end. */
  toPlan: number;
  /** toCover + toPlan. */
  total: number;
  /** Net pending on the card, already inside `now` (and so inside toCover / toPlan). */
  pending: number;
  /** Payments pending on another account toward this card, already taken off `now`. */
  pendingPayments: number;
  /** Balance the plan expects by month end; null when there's no plan payment. */
  expected: number | null;
}

export function cardStanding(row: CardRebalanceRow): CardStanding {
  const toCover = row.owe;
  const expected = row.expected;
  const toPlan = expected != null ? round2(Math.max(0, Math.max(0, row.now - expected) - toCover)) : 0;
  return { toCover, toPlan, total: round2(toCover + toPlan), pending: row.pending, pendingPayments: row.pendingPayments, expected };
}

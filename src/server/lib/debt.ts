// Pure debt math — shared by the /debts page, debt cards, and the dashboard.
// Inputs are already-parsed numbers (use toNum on DECIMAL strings first).

import { toNum } from "@/server/lib/money";

// Simple monthly interest cost at today's balance and rate: balance * (apr% / 12).
// This is a motivational estimate ("what this debt costs you each month"), NOT an
// amortization schedule. Returns null when balance or APR is unknown.
export function monthlyInterest(
  balance: number | null | undefined,
  apr: number | null | undefined,
): number | null {
  if (balance == null || apr == null) return null;
  if (balance <= 0 || apr <= 0) return 0;
  return (balance * (apr / 100)) / 12;
}

export function annualInterest(
  balance: number | null | undefined,
  apr: number | null | undefined,
): number | null {
  const m = monthlyInterest(balance, apr);
  return m == null ? null : m * 12;
}

// How much of the original principal has been paid down. `pct` is 0–100 (clamped).
// Returns null when we can't compute it (no original principal or no current balance).
export function payoffProgress(
  original: number | null | undefined,
  balance: number | null | undefined,
): { paid: number; pct: number } | null {
  if (original == null || balance == null || original <= 0) return null;
  const paid = Math.max(0, original - balance);
  const pct = Math.min(100, Math.max(0, (paid / original) * 100));
  return { paid, pct };
}

// Convenience: accept the raw DECIMAL strings drizzle returns.
export function monthlyInterestStr(
  balance: string | number | null | undefined,
  apr: string | number | null | undefined,
): number | null {
  return monthlyInterest(toNum(balance), toNum(apr));
}

// How much of a month's payments to a card actually paid the debt down. Paying back what you
// charged to the card that same month only rebalances it — the money already counted as spending
// in the categories the purchases landed in — so only payments beyond the new charges are payoff.
// Refunds net against the charges. Interest is NOT a charge here: the plan's payment already
// covers it and the payoff projection models it separately.
//
//   rebalance = min(paid, charged)     payoff = max(0, paid − charged)
export function splitCardPayments(
  paid: number,
  charged: number,
): { rebalance: number; payoff: number } {
  const c = Math.max(0, charged);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { rebalance: round2(Math.min(paid, c)), payoff: round2(Math.max(0, paid - c)) };
}

// How much of a month's "Debt Repayment" spending only paid back that month's own card charges —
// the part to take OFF the category so the same dollars aren't counted twice (once in the
// categories the purchases landed in, and again when checking paid the card back). Per card,
// payments linked to its bill rebalance up to its new charges (splitCardPayments). Debt Repayment
// that isn't linked to any bill is assumed to be a card payment too, and rebalances whatever new
// charges the linked payments left uncovered. Payments linked to a loan's (or other) bill aren't
// passed in — a loan takes no new charges, so all of that is real paydown.
//
//   rebalance = Σ min(paid_i, charged_i) + min(unlinked, Σ max(0, charged_i − paid_i))
export function repaymentRebalance(cards: { paid: number; charged: number }[], unlinked: number): number {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  let linked = 0;
  let headroom = 0;
  for (const c of cards) {
    const charged = Math.max(0, c.charged);
    const paid = Math.max(0, c.paid);
    linked += Math.min(paid, charged);
    headroom += Math.max(0, charged - paid);
  }
  return round2(linked + Math.min(Math.max(0, unlinked), headroom));
}

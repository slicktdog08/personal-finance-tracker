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

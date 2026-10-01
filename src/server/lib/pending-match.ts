// Fuzzy matching between a transaction entered by hand (usually marked pending) and the
// posted version of the same charge that later arrives in a bank import.
//
// Exact dedup (src/server/lib/dedup.ts) can't catch these: the description the user typed
// ("Dinner at Joe's") rarely matches the bank's ("SQ *JOES GRILL 8842"), the bank posts a
// day or several later, and a restaurant hold grows by the tip. What does line up is the
// account and the direction, a date within a few days, and an amount within a tip's reach —
// so those are the gates, and the description only breaks ties.
//
// Pure — no DB — so the import preview, the reconcile panel and a quick script all share it.

import { normalizeMerchant } from "@/server/lib/merchant";

export interface MatchSide {
  id: number;
  /** Account last-4 / number; both sides must name the same one. */
  accountNumber: string | null;
  txnDate: string; // ISO YYYY-MM-DD
  amount: number; // magnitude
  direction: string; // Debit | Credit
  description: string;
}

/** The posted row may land this many days before the hand-entered date (a typo'd date)… */
export const DAYS_BEFORE = 3;
/** …or this many after it (holds routinely take a few business days to settle). */
export const DAYS_AFTER = 10;
/** Amount tolerance: the larger of this share of the pending amount… */
export const AMOUNT_PCT = 0.3;
/** …or this many dollars — so a $4 coffee with a $1 tip still matches. */
export const AMOUNT_MIN = 2;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Days from the hand-entered date to the posted date (positive = posted later). */
export function dayGap(entered: string, posted: string): number {
  return dayNumber(posted) - dayNumber(entered);
}

export function amountTolerance(enteredAmount: number): number {
  return Math.max(AMOUNT_MIN, Math.abs(enteredAmount) * AMOUNT_PCT);
}

// Share of the shorter merchant key's words that appear in the other — "JOES GRILL" vs
// "SQ JOES GRILL" is 1.0, unrelated names 0. Only a tie-breaker, never a gate.
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeMerchant(a).split(" ").filter((w) => w.length >= 3));
  const tb = new Set(normalizeMerchant(b).split(" ").filter((w) => w.length >= 3));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/**
 * How confident we are that `posted` is the settled version of `entered`, 0–1, or null when
 * it fails a hard gate (different account or direction, date or amount out of range).
 */
export function matchScore(entered: MatchSide, posted: MatchSide): number | null {
  const acctA = (entered.accountNumber ?? "").trim();
  const acctB = (posted.accountNumber ?? "").trim();
  if (!acctA || acctA !== acctB) return null;
  if (entered.direction !== posted.direction) return null;
  const gap = dayGap(entered.txnDate, posted.txnDate);
  if (gap < -DAYS_BEFORE || gap > DAYS_AFTER) return null;
  const diff = Math.abs(Math.abs(posted.amount) - Math.abs(entered.amount));
  const tol = amountTolerance(entered.amount);
  if (diff > tol + 0.005) return null;

  const amountScore = diff < 0.005 ? 1 : 0.8 * (1 - diff / tol);
  // Same day or the next couple of days is the norm; far ends of the window score low.
  const dateScore = 1 - Math.abs(gap) / (gap < 0 ? DAYS_BEFORE + 1 : DAYS_AFTER + 1);
  const nameScore = nameSimilarity(entered.description, posted.description);
  return Math.round((0.5 * amountScore + 0.3 * dateScore + 0.2 * nameScore) * 1000) / 1000;
}

export interface PendingPair {
  enteredId: number;
  postedId: number;
  score: number;
  /** Amounts equal to the cent — the strongest evidence short of the same name. */
  exactAmount: boolean;
}

/**
 * Pair each hand-entered row with at most one posted row (and vice versa), best-scoring
 * pairs first, so two $12 lunches on the same card don't both claim the same bank row.
 */
export function pairPending(entered: MatchSide[], posted: MatchSide[]): PendingPair[] {
  const all: PendingPair[] = [];
  for (const e of entered) {
    for (const p of posted) {
      if (e.id === p.id) continue;
      const score = matchScore(e, p);
      if (score == null) continue;
      all.push({
        enteredId: e.id,
        postedId: p.id,
        score,
        exactAmount: Math.abs(Math.abs(e.amount) - Math.abs(p.amount)) < 0.005,
      });
    }
  }
  all.sort((a, b) => b.score - a.score || a.enteredId - b.enteredId || a.postedId - b.postedId);
  const usedE = new Set<number>();
  const usedP = new Set<number>();
  const out: PendingPair[] = [];
  for (const pr of all) {
    if (usedE.has(pr.enteredId) || usedP.has(pr.postedId)) continue;
    usedE.add(pr.enteredId);
    usedP.add(pr.postedId);
    out.push(pr);
  }
  return out;
}

/** The date range of posted rows worth loading to match a set of hand-entered dates. */
export function postedWindow(enteredDates: string[]): { from: string; to: string } | null {
  if (!enteredDates.length) return null;
  const sorted = [...enteredDates].sort();
  return { from: shiftIso(sorted[0], -DAYS_BEFORE), to: shiftIso(sorted[sorted.length - 1], DAYS_AFTER) };
}

/** The date range of hand-entered rows that could match a set of posted dates. */
export function enteredWindow(postedDates: string[]): { from: string; to: string } | null {
  if (!postedDates.length) return null;
  const sorted = [...postedDates].sort();
  return { from: shiftIso(sorted[0], -DAYS_AFTER), to: shiftIso(sorted[sorted.length - 1], DAYS_BEFORE) };
}

function shiftIso(iso: string, days: number): string {
  const d = new Date((dayNumber(iso) + days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

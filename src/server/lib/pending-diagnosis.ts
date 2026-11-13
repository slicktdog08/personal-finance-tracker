// Why a pending transaction is still pending, and what the evidence says it really was.
//
// A pending row normally resolves itself: a synced one is promoted or expired by the feed that
// wrote it, a hand-entered one is merged when its posted twin arrives. It gets STUCK when that
// can't happen any more, and then only the user can settle it. There are two ways it ends:
//
//   1. It posted, and we missed the posted row — the feed changed (SimpleFIN → Plaid), the new
//      feed's history starts after the charge posted, or the posted row carries a different
//      name and amount (a tip) than the authorization did.
//   2. It never posted — an authorization hold (a card check, a gas-pump or hotel pre-auth)
//      that the bank dropped, but no feed is left to notice it was dropped.
//
// This module doesn't decide; it lays out the evidence for each reading and says which way it
// leans, so the tray (and the advisor) can put the likeliest action first.
//
// Pure — no DB. src/server/pending.ts gathers the inputs.

import { DAYS_AFTER, DAYS_BEFORE, dayGap, matchScore, nameSimilarity, type MatchSide } from "@/server/lib/pending-match";
import { sourceLabel } from "@/constants/sync";

/** What feeds the pending row's account today (from sync_accounts + sync_enrollments). */
export interface AccountFeed {
  provider: string;
  /** Mapped, switched on, enrollment active. */
  active: boolean;
  /** enrollment status when not active: "paused", "disconnected", or "disabled" for the account switch. */
  inactiveReason: string | null;
  /** The feed's history for this account starts here (sync_accounts.sync_from). */
  coverageFrom: string | null;
}

export interface PendingSubject {
  id: number;
  txnDate: string;
  amount: number;
  direction: string;
  description: string;
  accountNumber: string | null;
  /** transactions.source — a provider id for synced rows. */
  source: string;
  /** Has a provider external id. */
  synced: boolean;
}

export type StuckReason =
  /** Synced by a provider that no longer feeds this account: nothing will ever update it. */
  | "orphaned"
  /** Its own feed is paused, disconnected or switched off, and it's past the expiry window. */
  | "feed-off"
  /** Its feed still runs (or it was typed by hand) but it has been pending far longer than normal. */
  | "overdue";

export type Lean = "posted" | "hold" | "unsure";

export interface Signal {
  /** Which reading this supports; "info" is context that supports neither. */
  points: "posted" | "hold" | "info";
  /** 2 = close to decisive on its own, 1 = suggestive. */
  weight: 1 | 2;
  text: string;
}

export interface Candidate {
  id: number;
  txnDate: string;
  description: string;
  amount: number;
  score: number;
  /** Days from the pending date to the posted date (positive = posted later). */
  dayGap: number;
  /** posted − pending, in dollars. */
  amountDiff: number;
  /** 0–1 share of merchant words in common. */
  nameMatch: number;
  /** One line a person can check against their statement. */
  evidence: string;
  /** Close on both amount and name (or the exact amount) — good enough to lead with. */
  strong: boolean;
}

export interface PendingDiagnosis {
  ageDays: number;
  stuck: boolean;
  reason: StuckReason | null;
  /** Why nothing will settle it on its own — one sentence. Null when it isn't stuck. */
  why: string | null;
  lean: Lean | null;
  signals: Signal[];
  /** Posted rows that could be this charge, best first (at most MAX_CANDIDATES). */
  candidates: Candidate[];
}

export const MAX_CANDIDATES = 3;
/** A hand-entered row with no twin after this many days has outlived the match window. */
export const HAND_OVERDUE_DAYS = DAYS_AFTER;
/** A synced row still reported pending this long past the expiry setting is unusual. */
export const SYNCED_OVERDUE_GRACE = 7;
/** At or below this, a charge looks like a card check / sign-up verification. */
export const VERIFICATION_MAX = 2;
/** Score at which a single candidate is a strong enough twin to lean "posted". */
export const STRONG_MATCH = 0.6;

// Merchants that authorize one amount and settle another (or nothing): fuel pumps, lodging,
// rentals, and descriptors that say outright they're a pre-authorization.
const HOLD_MERCHANT =
  /\b(FUEL|GAS|PETRO|SHELL|EXXON|MOBIL|CHEVRON|VALERO|CITGO|SUNOCO|MARATHON|PHILLIPS|CONOCO|MURPHY|CIRCLE ?K|CIRCLEK|WAWA|QT|QUIKTRIP|SPEEDWAY|BUC-?EE'?S|HOTEL|MOTEL|INN|RESORT|LODGE|MARRIOTT|HILTON|HYATT|AIRBNB|HERTZ|AVIS|BUDGET RENT|ENTERPRISE RENT|NATIONAL CAR|RENTAL|PRE-?AUTH|AUTH ?HOLD|VERIFY|VERIFICATION|DEPOSIT)\b/i;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function money(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function label(source: string): string {
  // "Bank sync (SimpleFIN)" → "SimpleFIN"
  const l = sourceLabel(source);
  const m = /\(([^)]+)\)/.exec(l);
  return m ? m[1] : l || source;
}

export function looksLikeHoldMerchant(description: string): boolean {
  return HOLD_MERCHANT.test(description);
}

/**
 * Is this pending row stuck — will nothing settle it without the user? And why.
 * `pendingExpiryDays` is the sync setting: a synced row the bank stops returning is dropped
 * after that many days, so a live feed should never hold a pending row much longer.
 */
export function stuckReason(
  p: PendingSubject,
  feed: AccountFeed | null,
  ageDays: number,
  pendingExpiryDays: number,
  hasMatch: boolean,
): { reason: StuckReason; why: string } | null {
  if (p.synced) {
    if (!feed || feed.provider !== p.source) {
      const now = feed ? ` ${label(feed.provider)} feeds it now, and only settles its own rows.` : " No bank feed covers this account now.";
      return {
        reason: "orphaned",
        why: `${label(p.source)} synced this as pending, but no longer feeds this account.${now} Nothing will update it on its own.`,
      };
    }
    if (!feed.active && ageDays > pendingExpiryDays) {
      return {
        reason: "feed-off",
        why: `${label(feed.provider)} sync for this account is ${feed.inactiveReason ?? "off"}, so it can't see whether this posted or was dropped.`,
      };
    }
    if (feed.active && ageDays > pendingExpiryDays + SYNCED_OVERDUE_GRACE) {
      return {
        reason: "overdue",
        why: `The bank has reported this as pending for ${days(ageDays)}; holds normally settle or drop within a week.`,
      };
    }
    return null;
  }
  if (!hasMatch && ageDays > HAND_OVERDUE_DAYS) {
    return {
      reason: "overdue",
      why: `Entered by hand ${days(ageDays)} ago, and no posted charge on this account has matched it.`,
    };
  }
  return null;
}

/**
 * Score every posted row against a stuck pending one. Deliberately looser than the tray's
 * automatic pairing (which demands a shared merchant name for synced rows): across providers
 * the same charge is often named differently ("TACO BELL 1234" vs "Taco Bell"), so here a
 * synced row is scored like a hand-typed one — amount and date gates, name as evidence — and
 * the user is the one who decides.
 */
export function findCandidates(p: PendingSubject, posted: MatchSide[], dismissed: ReadonlySet<string> = new Set()): Candidate[] {
  const subject: MatchSide = {
    id: p.id,
    accountNumber: p.accountNumber,
    txnDate: p.txnDate,
    amount: p.amount,
    direction: p.direction,
    description: p.description,
    handEntered: true,
  };
  const out: Candidate[] = [];
  for (const c of posted) {
    if (c.id === p.id || dismissed.has(`${p.id}:${c.id}`)) continue;
    const score = matchScore(subject, c);
    if (score == null) continue;
    const gap = dayGap(p.txnDate, c.txnDate);
    const diff = Math.round((Math.abs(c.amount) - Math.abs(p.amount)) * 100) / 100;
    const name = nameSimilarity(p.description, c.description);
    out.push({
      id: c.id,
      txnDate: c.txnDate,
      description: c.description,
      amount: Math.abs(c.amount),
      score,
      dayGap: gap,
      amountDiff: diff,
      nameMatch: name,
      evidence: candidateEvidence(gap, diff, p.amount, name, p.direction),
      strong: score >= STRONG_MATCH || Math.abs(diff) < 0.005,
    });
  }
  out.sort((a, b) => b.score - a.score || a.id - b.id);
  return out.slice(0, MAX_CANDIDATES);
}

function candidateEvidence(gap: number, diff: number, pendingAmount: number, name: number, direction: string): string {
  const parts: string[] = [];
  parts.push(gap === 0 ? "same day" : gap > 0 ? `${days(gap)} later` : `${days(-gap)} earlier`);
  if (Math.abs(diff) < 0.005) parts.push("exact amount");
  else {
    const pct = Math.round((Math.abs(diff) / Math.max(Math.abs(pendingAmount), 0.01)) * 100);
    const tip = diff > 0 && direction === "Debit" ? " — a tip?" : "";
    parts.push(`${diff > 0 ? "+" : "−"}${money(diff)} (${pct}%)${tip}`);
  }
  parts.push(name >= 0.999 ? "same merchant" : name > 0 ? "similar name" : "different name");
  return parts.join(" · ");
}

/** The full read on one pending row. `today` is ISO. */
export function diagnosePending(input: {
  pending: PendingSubject;
  today: string;
  feed: AccountFeed | null;
  pendingExpiryDays: number;
  /** Posted rows on the same account around the pending date. */
  posted: MatchSide[];
  /** The tray already paired this row with a posted twin. */
  hasMatch: boolean;
  dismissed?: ReadonlySet<string>;
}): PendingDiagnosis {
  const { pending: p, feed, today } = input;
  const ageDays = Math.max(0, dayNumber(today) - dayNumber(p.txnDate));
  const stuck = stuckReason(p, feed, ageDays, input.pendingExpiryDays, input.hasMatch);
  if (!stuck) return { ageDays, stuck: false, reason: null, why: null, lean: null, signals: [], candidates: [] };

  const candidates = findCandidates(p, input.posted, input.dismissed);
  const signals: Signal[] = [];
  const best = candidates[0];

  // --- evidence it posted -------------------------------------------------------------
  if (best) {
    const strong = best.strong;
    signals.push({
      points: "posted",
      weight: strong ? 2 : 1,
      text: `${candidates.length === 1 ? "A posted charge" : `${candidates.length} posted charges`} on this account could be it — the closest is ${best.description}, ${best.evidence}.`,
    });
    if (!strong) signals.push({ points: "info", weight: 1, text: "None of them is a close match on both amount and name; check your statement before merging." });
  }

  // The feed's history doesn't reach back to when this would have posted: a posted twin
  // could exist at the bank and simply never have been fetched.
  const postBy = shiftIso(p.txnDate, DAYS_AFTER);
  const coverageGap = feed?.coverageFrom != null && feed.coverageFrom > shiftIso(p.txnDate, -DAYS_BEFORE);
  if (coverageGap && feed) {
    const whole = feed.coverageFrom! > postBy;
    signals.push({
      points: "posted",
      weight: 1,
      text: `${label(feed.provider)}'s history for this account starts ${feed.coverageFrom}${whole ? "" : `, partway through the days this would normally post (by ${postBy})`}. If it posted before then, no sync will ever bring it in — so finding no match here proves nothing. Check your statement.`,
    });
  }

  // --- evidence it was only a hold ----------------------------------------------------
  if (p.direction === "Debit" && p.amount <= VERIFICATION_MAX) {
    signals.push({
      points: "hold",
      weight: 2,
      text: `${money(p.amount)} is the size of a card check or sign-up verification, which is usually reversed rather than posted.`,
    });
  }
  if (p.direction === "Debit" && looksLikeHoldMerchant(p.description)) {
    signals.push({
      points: "hold",
      weight: 1,
      text: "Gas pumps, hotels and rentals usually place a hold that is dropped and replaced by a separate charge for the real amount.",
    });
  }
  const windowClosed = dayNumber(today) > dayNumber(postBy);
  if (!best && windowClosed && !coverageGap) {
    signals.push({
      points: "hold",
      weight: 2,
      text: `Nothing on this account posted for a similar amount within ${DAYS_AFTER} days of it, and the feed covered that whole stretch.`,
    });
  }
  if (!best && !windowClosed) {
    signals.push({ points: "info", weight: 1, text: `Charges can take up to ${DAYS_AFTER} days to post; it's still inside that window (until ${postBy}).` });
  }

  return { ageDays, stuck: true, reason: stuck.reason, why: stuck.why, lean: leanFrom(signals), signals, candidates };
}

// Weigh the two readings. A strong twin settles it; otherwise the side with more weight wins,
// and a tie (or no evidence at all) is honestly "unsure" — the statement decides.
function leanFrom(signals: Signal[]): Lean {
  const sum = (k: Signal["points"]) => signals.filter((s) => s.points === k).reduce((n, s) => n + s.weight, 0);
  const posted = sum("posted");
  const hold = sum("hold");
  if (posted > hold) return "posted";
  if (hold > posted) return "hold";
  return "unsure";
}

function shiftIso(iso: string, d: number): string {
  return new Date((dayNumber(iso) + d) * 86_400_000).toISOString().slice(0, 10);
}

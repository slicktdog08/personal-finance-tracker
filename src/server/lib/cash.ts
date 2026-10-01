// Cash-offset matching (pure, no DB). Cash withdrawn from the bank and cash spent out of
// the wallet are the same money; these helpers decide which withdrawal funded which
// purchase. See planning/features/cash-offsets.md for the accounting rules.

export interface OpenWithdrawal {
  id: number;
  txnDate: string; // ISO YYYY-MM-DD
  description: string;
  amount: number; // the cash in it (cashPortion) — the face value for a plain ATM withdrawal
  allocated: number; // already tied to purchases
  remaining: number; // amount - allocated — still unaccounted for
  accountLabel: string | null;
}

export interface OpenSpend {
  id: number;
  txnDate: string;
  description: string;
  category: string | null;
  amount: number;
  covered: number; // already drawn from withdrawals
  uncovered: number; // amount - covered
}

/**
 * How much of a transaction is cash you took out: its parts split off as `Cash`, plus its own
 * share when its own category is `Cash`. An ATM withdrawal is all cash; a $40 grocery run with
 * $20 cash back split off as Cash has $20. Mirrors `cashPortion` in src/server/queries.ts.
 * Amounts in dollars; the result is rounded to cents.
 */
export function cashPortionOf(
  txn: { category: string | null; amount: number },
  splits: { category: string; amount: number }[],
  cashCategory = "Cash",
): number {
  const split = splits.reduce((s, p) => s + p.amount, 0);
  const cashSplit = splits.reduce((s, p) => s + (p.category === cashCategory ? p.amount : 0), 0);
  const own = txn.category === cashCategory ? txn.amount - split : 0;
  return Math.round((own + cashSplit) * 100) / 100;
}

export interface AllocationProposal {
  withdrawalId: number;
  spendId: number;
  amount: number;
}

// How far back a withdrawal can be and still be OFFERED as the source of a purchase. Cash
// lingers, and you know where yours came from — so the manual picker is generous.
export const DEFAULT_LOOKBACK_DAYS = 45;

// Automatic suggestions get a much tighter leash. A link moves spending between months, so a
// guess that reaches back six weeks doesn't say "this June cash finally got explained" — it
// quietly drops June's spending for a purchase you made in August. Anything outside this
// window is left for you to link deliberately.
export const SUGGEST_WINDOW_DAYS = 14;

// Cash can be spent the moment it's withdrawn, but bank rows post late — a purchase dated
// the day BEFORE its ATM row is normal, so allow a little slack in that direction.
const POST_LAG_DAYS = 3;

export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86400000);
}

// Money is compared in whole cents — 0.1 + 0.2 must not decide whether $0.00 is left.
const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

// Can this withdrawal plausibly have funded this purchase? The withdrawal must come first
// (modulo posting lag) and be recent enough to still be in your pocket.
export function canFund(
  w: { txnDate: string },
  s: { txnDate: string },
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): boolean {
  const gap = daysBetween(w.txnDate, s.txnDate); // >0 = purchase after withdrawal
  return gap >= -POST_LAG_DAYS && gap <= lookbackDays;
}

/**
 * Rank withdrawals by how likely they are to be the cash in your hand for a given purchase:
 * the most recent one dated ON OR BEFORE it wins, and a withdrawal dated slightly AFTER only
 * gets a look once nothing earlier qualifies — otherwise the posting-lag slack would let a
 * withdrawal that hadn't happened yet outrank the one you actually spent from.
 */
function fundingRank(w: { txnDate: string }, s: { txnDate: string }): [number, number] {
  const gap = daysBetween(w.txnDate, s.txnDate); // >= 0 = withdrawal came first
  return gap >= 0 ? [0, gap] : [1, -gap];
}

function byFundingRank<T extends { txnDate: string; id: number }>(s: { txnDate: string }) {
  return (a: T, b: T) => {
    const [ga, da] = fundingRank(a, s);
    const [gb, dbb] = fundingRank(b, s);
    return ga - gb || da - dbb || b.id - a.id;
  };
}

// The withdrawal to pre-select when entering a new cash purchase: the most RECENT one that
// could have funded it and still has money left. That's how it feels from the wallet — the
// cash in your pocket is the cash you took out last — and it's only a default; the entry
// form lets you pick another.
export function defaultWithdrawalFor(
  spend: { txnDate: string; amount: number },
  withdrawals: OpenWithdrawal[],
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): OpenWithdrawal | null {
  const usable = withdrawals
    .filter((w) => w.remaining > 0 && canFund(w, spend, lookbackDays))
    .sort(byFundingRank(spend));
  if (!usable.length) return null;
  // Prefer one that covers the whole purchase; otherwise the closest with anything left.
  return usable.find((w) => cents(w.remaining) >= cents(spend.amount)) ?? usable[0];
}

export interface OffsetPlanPart {
  withdrawalId: number;
  amount: number;
}

/**
 * Plan how a new cash purchase should draw on the open withdrawals. A single withdrawal wins
 * when any can cover the whole price (fewest links, and it matches `defaultWithdrawalFor`);
 * otherwise the purchase splits most-recent-first until it's funded — a $470 purchase against
 * a $300 and a $200 withdrawal drains one entirely and takes the rest from the other. If the
 * pool runs dry the plan simply comes up short, and the caller shows the shortfall as cash
 * from somewhere else.
 *
 * With no usable withdrawal the plan is empty. With no price yet (amount 0), it's the single
 * best pick offering everything it has — the entry form shows that while the user types.
 */
export function defaultOffsetsFor(
  spend: { txnDate: string; amount: number },
  withdrawals: OpenWithdrawal[],
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): OffsetPlanPart[] {
  const first = defaultWithdrawalFor(spend, withdrawals, lookbackDays);
  if (!first) return [];
  let need = cents(spend.amount);
  if (need <= 0) return [{ withdrawalId: first.id, amount: first.remaining }];
  const rest = withdrawals
    .filter((w) => w.id !== first.id && w.remaining > 0 && canFund(w, spend, lookbackDays))
    .sort(byFundingRank(spend));
  const parts: OffsetPlanPart[] = [];
  for (const w of [first, ...rest]) {
    if (need <= 0) break;
    const take = Math.min(cents(w.remaining), need);
    parts.push({ withdrawalId: w.id, amount: money(take) });
    need -= take;
  }
  return parts;
}

/**
 * Backfill matcher for history entered before offsets existed. Purchases are settled
 * oldest-first, each drawing on the most RECENT withdrawal that could have funded it —
 * the same assumption the entry form makes, because the cash in your pocket is the cash you
 * took out last — and splitting across withdrawals when one doesn't cover it.
 *
 * Deliberately conservative on both ends: the window is tight (see SUGGEST_WINDOW_DAYS), and
 * nothing at all is proposed for a purchase with no plausible funding withdrawal. Unfunded
 * cash spending is a real signal — you had cash from somewhere this app doesn't know about —
 * not an error to paper over.
 *
 * Pure: the caller shows the proposals for review and decides whether to apply them.
 */
export function proposeAllocations(
  withdrawals: OpenWithdrawal[],
  spends: OpenSpend[],
  lookbackDays = SUGGEST_WINDOW_DAYS,
): AllocationProposal[] {
  // Work in cents against a local copy of each pool so a withdrawal isn't over-drawn across
  // several proposals in the same run. Ordering is per-purchase (see byFundingRank), so it's
  // re-sorted inside the loop rather than once here.
  const pool = withdrawals
    .map((w) => ({ id: w.id, txnDate: w.txnDate, left: cents(w.remaining) }))
    .filter((w) => w.left > 0);

  const proposals: AllocationProposal[] = [];
  const ordered = [...spends].sort((a, b) =>
    a.txnDate < b.txnDate ? -1 : a.txnDate > b.txnDate ? 1 : a.id - b.id,
  );

  for (const s of ordered) {
    let need = cents(s.uncovered);
    if (need <= 0) continue;
    for (const w of [...pool].sort(byFundingRank(s))) {
      if (need <= 0) break;
      if (w.left <= 0) continue;
      if (!canFund(w, s, lookbackDays)) continue;
      const take = Math.min(w.left, need);
      w.left -= take;
      need -= take;
      proposals.push({ withdrawalId: w.id, spendId: s.id, amount: money(take) });
    }
  }
  return proposals;
}

/**
 * The pocket correction a month's rollups actually apply — signed, and subtracted from the
 * month's cash spending. Reconciles the THREE things that can explain a withdrawal, which are
 * measured against different denominators and so cannot simply be added up:
 *
 *   • `unaccounted` — what this month's withdrawals left over after allocations. Allocations
 *     come off the WITHDRAWAL's month no matter when the purchase happened, because month
 *     attribution follows the cash (see planning/features/cash-offsets.md).
 *   • `delta` — `closing − opening` pocket, strictly within this month.
 *   • `carryInFunded` — wallet purchases THIS month paid for by an EARLIER month's withdrawal.
 *
 * Capped ABOVE at `unaccounted`: a pocket that grew from cash the app never saw (a gift, a side
 * job) must not quietly erase unrelated spending.
 *
 * A drawdown (`delta < 0`) is only spending when NOTHING on the books already explains it. Cash
 * carried in and then spent on a logged wallet purchase is explained twice over — it sits in its
 * own category here, and the allocation already took it off the withdrawing month's Cash slice —
 * so `carryInFunded` cancels the drawdown rather than stacking with it. It can only cancel:
 * carry-in never turns a drawdown into held cash, which is why the netting floors at 0.
 */
export function effectiveHeld(delta: number, unaccounted: number, carryInFunded: number): number {
  const netted = delta < 0 ? Math.min(cents(delta) + cents(carryInFunded), 0) : cents(delta);
  return Math.min(money(netted), unaccounted);
}

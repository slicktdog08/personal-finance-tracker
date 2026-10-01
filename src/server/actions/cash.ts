"use server";

import { db } from "@/server/db";
import { transactions, accounts, cashAllocations, transactionSplits } from "@/server/db/schema";
import { and, eq, ne, or, inArray, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { CASH_SOURCE_CATEGORY, WALLET_ACCOUNT_TYPES } from "@/constants/enums";
import { toNum } from "@/server/lib/money";
import { monthBounds, parsePeriodLabel } from "@/server/lib/period";
import {
  DEFAULT_LOOKBACK_DAYS,
  cashPortionOf,
  proposeAllocations,
  type AllocationProposal,
  type OpenWithdrawal,
  type OpenSpend,
} from "@/server/lib/cash";
import {
  getCashWithdrawals,
  getWalletSpends,
  getWithdrawalDetail,
  type CashSpendRow,
  type CashWithdrawalRow,
} from "@/server/queries";
import { requireSession } from "@/server/auth/session";

// Offsets move money between months and categories in every rollup, so refresh broadly.
function refresh() {
  revalidatePath("/cash");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/months", "layout");
}

export type AllocateResult = { ok: true; amount: number } | { ok: false; error: string };

const cents = (n: number) => Math.round(n * 100);

/**
 * The cash in a transaction (see `cashPortionOf`) — what a withdrawal can hand out to the
 * purchases it paid for. Exported for the split actions, which must keep it covering the
 * offsets already made.
 */
export async function cashPortionFor(txnId: number): Promise<number> {
  await requireSession();
  const [[txn], parts] = await Promise.all([
    db
      .select({ category: transactions.category, amount: transactions.amount })
      .from(transactions)
      .where(eq(transactions.id, txnId))
      .limit(1),
    db
      .select({ category: transactionSplits.category, amount: transactionSplits.amount })
      .from(transactionSplits)
      .where(eq(transactionSplits.txnId, txnId)),
  ]);
  if (!txn) return 0;
  return cashPortionOf(
    { category: txn.category, amount: toNum(txn.amount) ?? 0 },
    parts.map((p) => ({ category: p.category, amount: toNum(p.amount) ?? 0 })),
    CASH_SOURCE_CATEGORY,
  );
}

async function walletAccountIds(): Promise<number[]> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.accountType, [...WALLET_ACCOUNT_TYPES]));
  return rows.map((r) => r.id);
}

// Everything already drawn from a withdrawal (or already funding a purchase), EXCLUDING the
// pair being edited — re-linking the same pair replaces its amount rather than stacking on it.
async function allocatedElsewhere(
  side: "withdrawal" | "spend",
  txnId: number,
  otherId: number,
): Promise<number> {
  const col = side === "withdrawal" ? cashAllocations.withdrawalTxnId : cashAllocations.spendTxnId;
  const otherCol =
    side === "withdrawal" ? cashAllocations.spendTxnId : cashAllocations.withdrawalTxnId;
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${cashAllocations.amount}), 0)` })
    .from(cashAllocations)
    .where(and(eq(col, txnId), ne(otherCol, otherId)));
  return toNum(row?.total) ?? 0;
}

/**
 * Record that some of a cash withdrawal paid for a wallet purchase. Pass `amount` to split a
 * withdrawal across several purchases; omit it to allocate as much as both sides allow.
 *
 * The amount is CLAMPED rather than rejected: a withdrawal can never give more than it holds
 * and a purchase can never be funded beyond its price, which is what guarantees the rollups
 * can't double-count no matter what the UI sends.
 */
export async function allocateCash(
  withdrawalId: number,
  spendId: number,
  amount?: number | null,
): Promise<AllocateResult> {
  await requireSession();
  if (withdrawalId === spendId) return { ok: false, error: "A transaction can't offset itself." };

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      direction: transactions.direction,
      category: transactions.category,
      amount: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .where(inArray(transactions.id, [withdrawalId, spendId]));
  const w = rows.find((r) => r.id === withdrawalId);
  const s = rows.find((r) => r.id === spendId);
  if (!w) return { ok: false, error: "That withdrawal no longer exists." };
  if (!s) return { ok: false, error: "That cash purchase no longer exists." };

  const wallets = await walletAccountIds();
  if (!wallets.length)
    return {
      ok: false,
      error: "No cash wallet account yet — set an account's type to Cash first.",
    };
  if (s.accountId == null || !wallets.includes(s.accountId))
    return { ok: false, error: "Only purchases on a cash wallet account can offset a withdrawal." };
  if (w.accountId != null && wallets.includes(w.accountId))
    return { ok: false, error: "The withdrawal has to come from a bank account, not the wallet." };
  if (w.direction !== "Debit" || s.direction !== "Debit")
    return { ok: false, error: "Both sides have to be money going out." };
  // A withdrawal can only give out the cash in it: all of an ATM row, or just the part split
  // off as Cash (cash back on a grocery run) — never the groceries.
  const wAmount = await cashPortionFor(withdrawalId);
  if (wAmount <= 0)
    return {
      ok: false,
      error: `Categorize "${w.description.slice(0, 40)}" as ${CASH_SOURCE_CATEGORY} (or split its cash back off as ${CASH_SOURCE_CATEGORY}) first — that's what marks it as cash you took out.`,
    };
  const sAmount = toNum(s.amount) ?? 0;
  const [wUsed, sUsed] = await Promise.all([
    allocatedElsewhere("withdrawal", withdrawalId, spendId),
    allocatedElsewhere("spend", spendId, withdrawalId),
  ]);
  const maxCents = Math.min(cents(wAmount) - cents(wUsed), cents(sAmount) - cents(sUsed));
  if (maxCents <= 0)
    return {
      ok: false,
      error:
        cents(wAmount) - cents(wUsed) <= 0
          ? "That withdrawal is already fully accounted for."
          : "That purchase is already fully funded by other withdrawals.",
    };

  const wantCents = amount == null ? maxCents : cents(amount);
  if (wantCents <= 0) return { ok: false, error: "Enter an amount above zero." };
  const finalCents = Math.min(wantCents, maxCents);
  const value = (finalCents / 100).toFixed(2);

  await db
    .insert(cashAllocations)
    .values({ withdrawalTxnId: withdrawalId, spendTxnId: spendId, amount: value })
    .onDuplicateKeyUpdate({ set: { amount: value } });
  refresh();
  return { ok: true, amount: finalCents / 100 };
}

// Break one link. The purchase and the withdrawal both stay — only the claim that they're the
// same money goes away, so the withdrawal goes back to counting as unaccounted spending.
export async function unallocateCash(withdrawalId: number, spendId: number): Promise<void> {
  await requireSession();
  await db
    .delete(cashAllocations)
    .where(
      and(
        eq(cashAllocations.withdrawalTxnId, withdrawalId),
        eq(cashAllocations.spendTxnId, spendId),
      ),
    );
  refresh();
}

// Drop every link on a withdrawal — the "start over on this one" escape hatch.
export async function clearWithdrawalAllocations(withdrawalId: number): Promise<void> {
  await requireSession();
  await db.delete(cashAllocations).where(eq(cashAllocations.withdrawalTxnId, withdrawalId));
  refresh();
}

export interface ProposalPreview extends AllocationProposal {
  withdrawalDate: string;
  withdrawalDescription: string;
  withdrawalRemaining: number;
  spendDate: string;
  spendDescription: string;
  spendCategory: string | null;
  spendUncovered: number;
}

/**
 * Suggest links for wallet purchases that aren't funded yet (the backfill for history entered
 * before offsets existed). Read-only — nothing is written until the proposals come back
 * through `applyProposals`, so the whole set can be reviewed first.
 */
export async function suggestCashAllocations(
  periodLabel?: string,
): Promise<ProposalPreview[]> {
  await requireSession();
  const parsed = periodLabel ? parsePeriodLabel(periodLabel) : null;
  const opts = parsed ? monthBounds(parsed.year, parsed.month) : { start: undefined, end: undefined };
  const { start: from, end: to } = opts;
  // Withdrawals reach back before the window — cash taken out in late July is what funds the
  // first days of August, and the matcher itself enforces the plausible-funding rule.
  const carryFrom = from
    ? new Date(Date.parse(from + "T00:00:00Z") - DEFAULT_LOOKBACK_DAYS * 86400000)
        .toISOString()
        .slice(0, 10)
    : undefined;
  const [withdrawals, spends] = await Promise.all([
    getCashWithdrawals({ from: carryFrom, to, onlyOpen: true, limit: 500 }),
    getWalletSpends({ from, to, onlyUnfunded: true, limit: 500 }),
  ]);
  const wById = new Map(withdrawals.map((w) => [w.id, w]));
  const sById = new Map(spends.map((s) => [s.id, s]));

  return proposeAllocations(withdrawals as OpenWithdrawal[], spends as OpenSpend[]).map((p) => {
    const w = wById.get(p.withdrawalId)!;
    const s = sById.get(p.spendId)!;
    return {
      ...p,
      withdrawalDate: w.txnDate,
      withdrawalDescription: w.description,
      withdrawalRemaining: w.remaining,
      spendDate: s.txnDate,
      spendDescription: s.description,
      spendCategory: s.category,
      spendUncovered: s.uncovered,
    };
  });
}

// Apply reviewed proposals one at a time, re-validating each (they were computed against a
// snapshot). Returns what actually stuck, so the UI can report honestly.
export async function applyProposals(
  proposals: AllocationProposal[],
): Promise<{ applied: number; skipped: number; errors: string[] }> {
  await requireSession();
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const p of proposals) {
    const res = await allocateCash(p.withdrawalId, p.spendId, p.amount);
    if (res.ok) applied++;
    else {
      skipped++;
      if (errors.length < 5) errors.push(res.error);
    }
  }
  refresh();
  return { applied, skipped, errors };
}

export interface WithdrawalDetail {
  withdrawal: CashWithdrawalRow;
  /** Purchases already paid out of it, with how much of each was drawn. */
  spends: (CashSpendRow & { allocatedAmount: number })[];
  /** Wallet purchases nearby that still need funding — the pick-list for linking more. */
  linkable: CashSpendRow[];
}

/**
 * Everything the expanded withdrawal row shows. Fetched on demand rather than joined into the
 * transactions page: only a handful of rows are ever expanded, and cash detail on 500 rows of
 * ordinary spending would be dead weight.
 */
export async function loadWithdrawalDetail(
  withdrawalId: number,
): Promise<WithdrawalDetail | null> {
  await requireSession();
  const detail = await getWithdrawalDetail(withdrawalId);
  if (!detail) return null;
  const day = 86400000;
  const at = Date.parse(detail.withdrawal.txnDate + "T00:00:00Z");
  const linkable = await getWalletSpends({
    // Bank rows post late, so a purchase dated just before the withdrawal can still be its cash.
    from: new Date(at - 3 * day).toISOString().slice(0, 10),
    to: new Date(at + DEFAULT_LOOKBACK_DAYS * day).toISOString().slice(0, 10),
    onlyUnfunded: true,
    limit: 100,
  });
  const already = new Set(detail.spends.map((s) => s.id));
  return { ...detail, linkable: linkable.filter((s) => !already.has(s.id)) };
}

/**
 * Keep the cash ledger honest after a transaction is edited. Editing can invalidate links
 * that were valid when they were made — shrinking a $300 withdrawal to $50 would leave more
 * allocated than exists, and moving a purchase off the wallet (or flipping it to a Credit)
 * means it isn't cash spending any more.
 *
 * Called from updateTransaction; a no-op for the overwhelming majority of edits, which touch
 * rows that have no allocations at all.
 */
export async function reconcileAllocationsAfterEdit(txnId: number): Promise<void> {
  await requireSession();
  const links = await db
    .select({
      id: cashAllocations.id,
      withdrawalTxnId: cashAllocations.withdrawalTxnId,
      spendTxnId: cashAllocations.spendTxnId,
      amount: cashAllocations.amount,
    })
    .from(cashAllocations)
    .where(
      or(eq(cashAllocations.withdrawalTxnId, txnId), eq(cashAllocations.spendTxnId, txnId)) as SQL,
    );
  if (!links.length) return;

  const [txn] = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      direction: transactions.direction,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .limit(1);
  if (!txn) return;

  const wallets = await walletAccountIds();
  const onWallet = txn.accountId != null && wallets.includes(txn.accountId);
  const isSpendSide = links.some((l) => l.spendTxnId === txnId);

  // A purchase that left the wallet, or stopped being money going out, isn't cash spending.
  if (txn.direction !== "Debit" || (isSpendSide && !onWallet)) {
    await db
      .delete(cashAllocations)
      .where(inArray(cashAllocations.id, links.map((l) => l.id)));
    refresh();
    return;
  }

  // Otherwise trim: never let more be allocated against a row than the row is worth — for a
  // withdrawal, the cash in it (a split can shrink that below its face value). A row with no
  // cash left keeps the old face-value limit rather than losing every link to a recategorize.
  // Newest links give way first, so the oldest, most deliberate ones survive.
  const side = isSpendSide ? "spend" : "withdrawal";
  const mine = links
    .filter((l) => (side === "spend" ? l.spendTxnId === txnId : l.withdrawalTxnId === txnId))
    .sort((a, b) => b.id - a.id);
  const cash = side === "withdrawal" ? await cashPortionFor(txnId) : 0;
  let budget = cents(cash > 0 ? cash : (toNum(txn.amount) ?? 0));
  for (const l of [...mine].reverse()) {
    const have = cents(toNum(l.amount) ?? 0);
    if (budget <= 0) {
      await db.delete(cashAllocations).where(eq(cashAllocations.id, l.id));
      continue;
    }
    if (have > budget) {
      await db
        .update(cashAllocations)
        .set({ amount: (budget / 100).toFixed(2) })
        .where(eq(cashAllocations.id, l.id));
      budget = 0;
      continue;
    }
    budget -= have;
  }
  refresh();
}

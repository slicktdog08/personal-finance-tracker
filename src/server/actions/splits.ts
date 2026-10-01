"use server";

import { db } from "@/server/db";
import { transactions, accounts, cashAllocations, transactionSplits } from "@/server/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { CASH_SOURCE_CATEGORY, WALLET_ACCOUNT_TYPES } from "@/constants/enums";
import { formatMoney, toNum } from "@/server/lib/money";
import { cashPortionOf } from "@/server/lib/cash";
import { requireSession } from "@/server/auth/session";

// Splits move money between categories in every category rollup, so refresh broadly.
function refresh(path?: string) {
  if (path) revalidatePath(path);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/budget");
  revalidatePath("/months", "layout");
}

const cents = (n: number) => Math.round(n * 100);

export interface SplitInput {
  category: string;
  amount: number;
}

export type SplitResult = { ok: true } | { ok: false; error: string };

/**
 * Split a transaction across categories. `pieces` are the parts carved OFF into other
 * categories; the transaction's own category keeps whatever is left, so the parts always add
 * up to the whole — there's no way to save a split that doesn't. Replaces any earlier split;
 * an empty list removes it. Pass `category` to also change the category the remainder stays
 * in (undefined leaves it as it is).
 */
export async function setTransactionSplits(
  txnId: number,
  pieces: SplitInput[],
  opts: { category?: string | null; path?: string } = {},
): Promise<SplitResult> {
  await requireSession();
  const [txn] = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      direction: transactions.direction,
      category: transactions.category,
      accountType: accounts.accountType,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(eq(transactions.id, txnId))
    .limit(1);
  if (!txn) return { ok: false, error: "Transaction not found." };

  const clean: { category: string; cents: number }[] = [];
  for (const p of pieces) {
    const category = (p.category ?? "").trim().slice(0, 48);
    const c = cents(Math.abs(Number(p.amount)));
    if (!Number.isFinite(c) || c <= 0) {
      if (!category) continue; // a blank row the form left behind
      return { ok: false, error: `Enter an amount for the ${category} part.` };
    }
    if (!category) return { ok: false, error: "Every part needs a category." };
    clean.push({ category, cents: c });
  }

  const totalCents = cents(toNum(txn.amount) ?? 0);
  const splitCents = clean.reduce((s, p) => s + p.cents, 0);
  if (splitCents >= totalCents && clean.length)
    return {
      ok: false,
      error:
        splitCents === totalCents
          ? "The parts take the whole amount — leave some for the original category, or just recategorize it."
          : "The parts add up to more than the transaction.",
    };

  // Cash already offset against wallet purchases has to stay cash: a split can carve Gifts out
  // of an ATM withdrawal, or cash back out of a grocery run, but not take away cash that
  // logged purchases were paid with.
  const nextCategory = opts.category !== undefined ? opts.category || null : txn.category;
  if (txn.direction === "Debit" && !WALLET_ACCOUNT_TYPES.includes(txn.accountType ?? "")) {
    const [row] = await db
      .select({ total: sql<string>`COALESCE(SUM(${cashAllocations.amount}), 0)` })
      .from(cashAllocations)
      .where(eq(cashAllocations.withdrawalTxnId, txnId));
    const allocated = toNum(row?.total) ?? 0;
    const cash = cashPortionOf(
      { category: nextCategory, amount: totalCents / 100 },
      clean.map((p) => ({ category: p.category, amount: p.cents / 100 })),
      CASH_SOURCE_CATEGORY,
    );
    if (allocated > 0 && cents(cash) < cents(allocated))
      return {
        ok: false,
        error: `${formatMoney(allocated)} of this cash already paid for purchases you logged, but the split leaves only ${formatMoney(cash)} as ${CASH_SOURCE_CATEGORY}. Unlink some on /cash first.`,
      };
  }

  await db.transaction(async (tx) => {
    if (opts.category !== undefined && (opts.category || null) !== txn.category) {
      // Picked by hand, so it's no longer "set by rule X".
      await tx
        .update(transactions)
        .set({ category: opts.category || null, categoryRuleId: null })
        .where(eq(transactions.id, txnId));
    }
    await tx.delete(transactionSplits).where(eq(transactionSplits.txnId, txnId));
    if (clean.length) {
      await tx.insert(transactionSplits).values(
        clean.map((p) => ({ txnId, category: p.category, amount: (p.cents / 100).toFixed(2) })),
      );
    }
  });
  refresh(opts.path);
  return { ok: true };
}

/**
 * Keep a split valid after its transaction is edited or merged. Shrinking a $100 row to $30
 * would leave $40 of pieces claiming more than exists, so the newest pieces give way first
 * (trimmed, then dropped) until at least a cent is left for the row's own category. Run it
 * BEFORE reconcileAllocationsAfterEdit: trimming a Cash part shrinks the cash offsets can use.
 *
 * A no-op for the overwhelming majority of rows, which aren't split.
 */
export async function reconcileSplitsAfterEdit(txnId: number): Promise<void> {
  await requireSession();
  const pieces = await db
    .select({ id: transactionSplits.id, amount: transactionSplits.amount })
    .from(transactionSplits)
    .where(eq(transactionSplits.txnId, txnId))
    .orderBy(asc(transactionSplits.id));
  if (!pieces.length) return;

  const [txn] = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .limit(1);
  if (!txn) return;

  // Oldest pieces keep their amounts; the newest are trimmed first.
  let budget = cents(toNum(txn.amount) ?? 0) - 1;
  let changed = false;
  for (const p of pieces) {
    const have = cents(toNum(p.amount) ?? 0);
    if (budget <= 0) {
      await db.delete(transactionSplits).where(eq(transactionSplits.id, p.id));
      changed = true;
      continue;
    }
    if (have > budget) {
      await db
        .update(transactionSplits)
        .set({ amount: (budget / 100).toFixed(2) })
        .where(eq(transactionSplits.id, p.id));
      budget = 0;
      changed = true;
      continue;
    }
    budget -= have;
  }
  if (changed) refresh();
}

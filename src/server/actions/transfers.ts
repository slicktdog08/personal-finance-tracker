"use server";

import { db } from "@/server/db";
import { transactions, transferDismissals } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";

function refresh() {
  revalidatePath("/transfers");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

async function partnerOf(id: number): Promise<number | null> {
  const r = await db
    .select({ p: transactions.transferPartnerId })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  return r[0]?.p ?? null;
}

// Link two transactions as the two sides of an internal transfer.
export async function linkTransfer(aId: number, bId: number): Promise<void> {
  await requireSession();
  if (aId === bId) return;
  const [oldA, oldB] = await Promise.all([partnerOf(aId), partnerOf(bId)]);
  await db.transaction(async (tx) => {
    // Break any pre-existing links so we don't leave dangling partners.
    if (oldA && oldA !== bId)
      await tx.update(transactions).set({ transferPartnerId: null }).where(eq(transactions.id, oldA));
    if (oldB && oldB !== aId)
      await tx.update(transactions).set({ transferPartnerId: null }).where(eq(transactions.id, oldB));
    await tx
      .update(transactions)
      .set({ transferPartnerId: bId, category: "Transfer", categoryRuleId: null })
      .where(eq(transactions.id, aId));
    await tx
      .update(transactions)
      .set({ transferPartnerId: aId, category: "Transfer", categoryRuleId: null })
      .where(eq(transactions.id, bId));
  });
  refresh();
}

export async function unlinkTransfer(id: number): Promise<void> {
  await requireSession();
  const p = await partnerOf(id);
  await db.transaction(async (tx) => {
    await tx.update(transactions).set({ transferPartnerId: null }).where(eq(transactions.id, id));
    if (p) await tx.update(transactions).set({ transferPartnerId: null }).where(eq(transactions.id, p));
  });
  refresh();
}

// Dismiss a suggested pair so it won't be suggested again.
export async function dismissSuggestion(aId: number, bId: number): Promise<void> {
  await requireSession();
  const lowId = Math.min(aId, bId);
  const highId = Math.max(aId, bId);
  await db
    .insert(transferDismissals)
    .values({ lowId, highId })
    .onDuplicateKeyUpdate({ set: { lowId: sql`low_id` } });
  revalidatePath("/transfers");
}

export async function markAsTransfer(id: number): Promise<void> {
  await requireSession();
  await db.update(transactions).set({ category: "Transfer", categoryRuleId: null }).where(eq(transactions.id, id));
  refresh();
}

// Remove the transfer flag (and any link) — back to a normal, uncategorized transaction.
export async function unmarkTransfer(id: number): Promise<void> {
  await requireSession();
  const p = await partnerOf(id);
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ transferPartnerId: null, category: null, categoryRuleId: null })
      .where(eq(transactions.id, id));
    if (p) await tx.update(transactions).set({ transferPartnerId: null }).where(eq(transactions.id, p));
  });
  refresh();
}

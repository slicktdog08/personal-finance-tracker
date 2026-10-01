"use server";

import { db } from "@/server/db";
import {
  billStatuses,
  paymentTypes,
  categories,
  transactions,
  transactionSplits,
  categoryMappings,
} from "@/server/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";

function refreshAll() {
  // Colors/emoji/order appear across the whole app; refresh everything.
  revalidatePath("/", "layout");
}

export async function updateStatusColor(id: number, color: string): Promise<void> {
  await requireSession();
  await db.update(billStatuses).set({ color }).where(eq(billStatuses.id, id));
  refreshAll();
}

export async function updateStatusEmoji(id: number, emoji: string | null): Promise<void> {
  await requireSession();
  await db.update(billStatuses).set({ emoji }).where(eq(billStatuses.id, id));
  refreshAll();
}

export async function updateStatusSettled(id: number, isSettled: boolean): Promise<void> {
  await requireSession();
  await db.update(billStatuses).set({ isSettled }).where(eq(billStatuses.id, id));
  refreshAll();
}

export async function addStatus(
  name: string,
  color: string,
  isSettled: boolean,
  emoji: string | null = null,
): Promise<void> {
  await requireSession();
  const max = await db
    .select({ m: sql<number>`COALESCE(MAX(${billStatuses.sortOrder}), -1)` })
    .from(billStatuses);
  await db
    .insert(billStatuses)
    .values({ name: name.trim(), color, emoji, isSettled, sortOrder: (max[0]?.m ?? -1) + 1 })
    .onDuplicateKeyUpdate({ set: { color, emoji, isSettled } });
  refreshAll();
}

export async function updatePaymentTypeColor(id: number, color: string): Promise<void> {
  await requireSession();
  await db.update(paymentTypes).set({ color }).where(eq(paymentTypes.id, id));
  refreshAll();
}

export async function updatePaymentTypeEmoji(id: number, emoji: string | null): Promise<void> {
  await requireSession();
  await db.update(paymentTypes).set({ emoji }).where(eq(paymentTypes.id, id));
  refreshAll();
}

export async function addPaymentType(
  name: string,
  color: string,
  emoji: string | null = null,
): Promise<void> {
  await requireSession();
  const max = await db
    .select({ m: sql<number>`COALESCE(MAX(${paymentTypes.sortOrder}), -1)` })
    .from(paymentTypes);
  await db
    .insert(paymentTypes)
    .values({ name: name.trim(), color, emoji, sortOrder: (max[0]?.m ?? -1) + 1 })
    .onDuplicateKeyUpdate({ set: { color, emoji } });
  refreshAll();
}

// ---- Categories ----
export async function addCategory(
  name: string,
  color: string,
  emoji: string | null = null,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const nn = name.trim();
  if (!nn) return { ok: false, error: "Name required" };
  const clash = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, nn))
    .limit(1);
  if (clash.length) return { ok: false, error: `"${nn}" already exists` };
  const max = await db
    .select({ m: sql<number>`COALESCE(MAX(${categories.sortOrder}), -1)` })
    .from(categories);
  await db.insert(categories).values({ name: nn, color, emoji, sortOrder: (max[0]?.m ?? -1) + 1 });
  refreshAll();
  return { ok: true };
}

export async function updateCategoryColor(id: number, color: string): Promise<void> {
  await requireSession();
  await db.update(categories).set({ color }).where(eq(categories.id, id));
  refreshAll();
}

export async function updateCategoryEmoji(id: number, emoji: string | null): Promise<void> {
  await requireSession();
  await db.update(categories).set({ emoji }).where(eq(categories.id, id));
  refreshAll();
}

// Enable/disable a category. Disabled ones no longer appear when picking a category for
// new/edited transactions, but existing transactions keep the mapping.
export async function setCategoryActive(id: number, active: boolean): Promise<void> {
  await requireSession();
  await db.update(categories).set({ active }).where(eq(categories.id, id));
  refreshAll();
}

// ---- Reordering (drag-and-drop persists sortOrder; drives select + badge order) ----
async function reorder(
  table: typeof billStatuses | typeof paymentTypes | typeof categories,
  orderedIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(table).set({ sortOrder: i }).where(eq(table.id, orderedIds[i]));
    }
  });
  refreshAll();
}

export async function reorderStatuses(orderedIds: number[]): Promise<void> {
  await requireSession();
  await reorder(billStatuses, orderedIds);
}
export async function reorderPaymentTypes(orderedIds: number[]): Promise<void> {
  await requireSession();
  await reorder(paymentTypes, orderedIds);
}
export async function reorderCategories(orderedIds: number[]): Promise<void> {
  await requireSession();
  await reorder(categories, orderedIds);
}

// Rename a category and carry the change to existing transactions + rules (atomically).
export async function renameCategory(
  id: number,
  newName: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const nn = newName.trim();
  if (!nn) return { ok: false, error: "Name required" };
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!rows.length) return { ok: false, error: "Category not found" };
  const oldName = rows[0].name;
  if (nn === oldName) return { ok: true };
  const clash = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, nn))
    .limit(1);
  if (clash.length) return { ok: false, error: `"${nn}" already exists — delete & reassign to merge.` };

  await db.transaction(async (tx) => {
    await tx.update(categories).set({ name: nn }).where(eq(categories.id, id));
    await tx.update(transactions).set({ category: nn }).where(eq(transactions.category, oldName));
    await tx
      .update(transactionSplits)
      .set({ category: nn })
      .where(eq(transactionSplits.category, oldName));
    await tx
      .update(categoryMappings)
      .set({ category: nn })
      .where(eq(categoryMappings.category, oldName));
    // Keep equals-on-raw_category rules whose pattern is the old name pointing at the new name.
    await tx
      .update(categoryMappings)
      .set({ pattern: nn })
      .where(and(eq(categoryMappings.field, "raw_category"), eq(categoryMappings.pattern, oldName)));
  });
  refreshAll();
  return { ok: true };
}

// Delete a category. If any transactions are still mapped to it, a valid reassignment
// target (another existing category) is REQUIRED — there is no fall-through to
// uncategorized, so records can never be silently orphaned. Runs atomically.
export async function deleteCategory(
  id: number,
  reassignTo: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!rows.length) return { ok: false, error: "Category not found" };
  const oldName = rows[0].name;

  // Split pieces filed under it count too — they'd be orphaned the same way.
  const [[{ c: rowCount }], [{ c: pieceCount }]] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(transactions)
      .where(eq(transactions.category, oldName)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(transactionSplits)
      .where(eq(transactionSplits.category, oldName)),
  ]);
  const txnCount = Number(rowCount) + Number(pieceCount);

  let target: string | null = null;
  if (Number(txnCount) > 0) {
    // Mapped transactions exist — force a remap to a real category.
    if (!reassignTo || reassignTo === oldName) {
      return {
        ok: false,
        error: `${txnCount} transaction${Number(txnCount) === 1 ? " is" : "s are"} still mapped to "${oldName}" — pick a category to reassign them to.`,
      };
    }
    const exists = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, reassignTo))
      .limit(1);
    if (!exists.length) return { ok: false, error: `Category "${reassignTo}" does not exist` };
    target = reassignTo;
  }

  await db.transaction(async (tx) => {
    if (target) {
      await tx
        .update(transactions)
        .set({ category: target })
        .where(eq(transactions.category, oldName));
      await tx
        .update(transactionSplits)
        .set({ category: target })
        .where(eq(transactionSplits.category, oldName));
      await tx
        .update(categoryMappings)
        .set({ category: target })
        .where(eq(categoryMappings.category, oldName));
    } else {
      // No transactions reference it; drop any auto-categorize rules that point at it.
      await tx.delete(categoryMappings).where(eq(categoryMappings.category, oldName));
    }
    await tx.delete(categories).where(eq(categories.id, id));
  });
  refreshAll();
  return { ok: true };
}

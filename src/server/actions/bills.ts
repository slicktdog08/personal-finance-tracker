"use server";

import { db } from "@/server/db";
import { billInstances, periods, bills, categoryMappings, transactions } from "@/server/db/schema";
import { and, eq, or, gt, sql, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { InstancePatch } from "@/server/lib/bill-types";
import { DEFAULT_NEW_MONTH_STATUS } from "@/constants/enums";
import { requireSession } from "@/server/auth/session";

function applyPatch(patch: InstancePatch) {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.amount !== undefined) set.amount = patch.amount == null ? null : String(patch.amount);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.dueDay !== undefined) set.dueDay = patch.dueDay;
  if (patch.paymentType !== undefined) set.paymentType = patch.paymentType || null;
  if (patch.isDebt !== undefined) set.isDebt = patch.isDebt;
  if (patch.isCancel !== undefined) set.isCancel = patch.isCancel;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  return set;
}

export async function updateInstance(
  id: number,
  patch: InstancePatch,
  path: string,
): Promise<void> {
  await requireSession();
  const set = applyPatch(patch);
  if (Object.keys(set).length) {
    await db.update(billInstances).set(set).where(eq(billInstances.id, id));
  }
  revalidatePath(path);
}

export async function addInstance(periodId: number, path: string): Promise<number> {
  await requireSession();
  const max = await db
    .select({ m: sql<number>`COALESCE(MAX(${billInstances.sortOrder}), -1)` })
    .from(billInstances)
    .where(eq(billInstances.periodId, periodId));
  const sortOrder = (max[0]?.m ?? -1) + 1;
  await db.insert(billInstances).values({
    periodId,
    name: "New bill",
    status: DEFAULT_NEW_MONTH_STATUS,
    sortOrder,
  });
  revalidatePath(path);
  const created = await db
    .select({ id: billInstances.id })
    .from(billInstances)
    .where(eq(billInstances.periodId, periodId))
    .orderBy(sql`${billInstances.id} DESC`)
    .limit(1);
  return created[0]?.id ?? 0;
}

export async function deleteInstance(id: number, path: string): Promise<void> {
  await requireSession();
  await db.delete(billInstances).where(eq(billInstances.id, id));
  revalidatePath(path);
}

// Set the same status on many instances at once (months-sheet bulk action).
export async function bulkSetStatus(
  ids: number[],
  status: string,
  path: string,
): Promise<number> {
  await requireSession();
  if (!ids.length || !status) return 0;
  await db.update(billInstances).set({ status }).where(inArray(billInstances.id, ids));
  revalidatePath(path);
  return ids.length;
}

// Add a bill to a month, reusing an existing recurring bill definition when the name
// matches (so dropping & re-adding a bill keeps it as ONE bill entity over time).
export async function addInstanceNamed(
  periodId: number,
  name: string,
  path: string,
): Promise<number> {
  await requireSession();
  const trimmed = name.trim() || "New bill";

  // Name match is case-insensitive (default MySQL collation).
  const existing = await db.select().from(bills).where(eq(bills.name, trimmed)).limit(1);
  let billId: number;
  let defaults = {
    amount: null as string | null,
    dueDay: null as number | null,
    paymentType: null as string | null,
    isDebt: false,
  };
  if (existing.length) {
    billId = existing[0].id;
    defaults = {
      amount: existing[0].defaultAmount,
      dueDay: existing[0].defaultDueDay,
      paymentType: existing[0].defaultPaymentType,
      isDebt: existing[0].isDebt,
    };
  } else {
    await db.insert(bills).values({ name: trimmed });
    const created = await db
      .select({ id: bills.id })
      .from(bills)
      .where(eq(bills.name, trimmed))
      .limit(1);
    billId = created[0].id;
  }

  const max = await db
    .select({ m: sql<number>`COALESCE(MAX(${billInstances.sortOrder}), -1)` })
    .from(billInstances)
    .where(eq(billInstances.periodId, periodId));

  await db.insert(billInstances).values({
    periodId,
    billId,
    name: trimmed,
    amount: defaults.amount,
    status: DEFAULT_NEW_MONTH_STATUS,
    dueDay: defaults.dueDay,
    paymentType: defaults.paymentType,
    isDebt: defaults.isDebt,
    sortOrder: (max[0]?.m ?? -1) + 1,
  });

  revalidatePath(path);
  revalidatePath("/settings/bills");
  const created = await db
    .select({ id: billInstances.id })
    .from(billInstances)
    .where(eq(billInstances.periodId, periodId))
    .orderBy(sql`${billInstances.id} DESC`)
    .limit(1);
  return created[0]?.id ?? 0;
}

// Merge a duplicate/diverged bill definition into another: reassign all references,
// then delete the now-empty source definition.
export async function mergeBills(
  sourceId: number,
  targetId: number,
  path: string,
): Promise<void> {
  await requireSession();
  if (sourceId === targetId) return;
  await db.update(billInstances).set({ billId: targetId }).where(eq(billInstances.billId, sourceId));
  await db
    .update(categoryMappings)
    .set({ billId: targetId })
    .where(eq(categoryMappings.billId, sourceId));
  // Transactions also carry a direct bill_id link — move those to the target so the
  // merged bill keeps its attributed transactions (and so deleting the source
  // below doesn't hit the FK).
  await db.update(transactions).set({ billId: targetId }).where(eq(transactions.billId, sourceId));
  await db.delete(bills).where(eq(bills.id, sourceId));
  revalidatePath("/settings/bills");
  revalidatePath(`/settings/bills/${targetId}`);
  revalidatePath(path);
}

// Update the recurring bill definition's defaults / debt flag.
export async function updateBill(
  id: number,
  patch: { name?: string; isDebt?: boolean; active?: boolean; notes?: string | null },
): Promise<void> {
  await requireSession();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.isDebt !== undefined) set.isDebt = patch.isDebt;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (Object.keys(set).length) await db.update(bills).set(set).where(eq(bills.id, id));
  revalidatePath(`/settings/bills/${id}`);
  revalidatePath("/settings/bills");
}

// Apply this instance's due day to all later months' instances of the same bill.
export async function applyDueDayForward(instanceId: number, path: string): Promise<number> {
  await requireSession();
  const rows = await db
    .select({
      billId: billInstances.billId,
      name: billInstances.name,
      dueDay: billInstances.dueDay,
      year: periods.year,
      month: periods.month,
    })
    .from(billInstances)
    .innerJoin(periods, eq(periods.id, billInstances.periodId))
    .where(eq(billInstances.id, instanceId))
    .limit(1);
  if (!rows.length || rows[0].dueDay == null) return 0;
  const { billId, name, dueDay, year, month } = rows[0];

  // Later periods: year > Y OR (year = Y AND month > M)
  const laterPeriods = await db
    .select({ id: periods.id })
    .from(periods)
    .where(or(gt(periods.year, year), and(eq(periods.year, year), gt(periods.month, month))));
  const laterIds = laterPeriods.map((p) => p.id);
  if (!laterIds.length) return 0;

  // Match by bill_id when available, else by name.
  const match = billId != null ? eq(billInstances.billId, billId) : eq(billInstances.name, name);
  const inLater = sql`${billInstances.periodId} IN (${sql.join(laterIds, sql`, `)})`;

  const matched = await db
    .select({ id: billInstances.id })
    .from(billInstances)
    .where(and(match, inLater));

  if (matched.length) {
    await db.update(billInstances).set({ dueDay }).where(and(match, inLater));
  }
  revalidatePath(path);
  revalidatePath("/months");
  return matched.length;
}

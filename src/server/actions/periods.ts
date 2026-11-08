"use server";

import { db } from "@/server/db";
import { billInstances, budgets, periods, transactions } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { dateToYearMonth, periodLabel } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { requireSession } from "@/server/auth/session";
import { ensurePeriod, cloneInstances } from "@/server/periods";

export async function createPeriod(year: number, month: number): Promise<string> {
  await requireSession();
  await ensurePeriod(year, month);
  const label = periodLabel(year, month);
  revalidatePath(`/months/${label}`);
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  return label;
}

// Clone the bill structure of `fromPeriodId` into (year, month). Kept for the MCP/advisor path;
// pages create months automatically via ensureCurrentPeriods().
export async function cloneMonth(fromPeriodId: number, year: number, month: number): Promise<string> {
  await requireSession();
  await cloneInstances(fromPeriodId, year, month);
  const label = periodLabel(year, month);
  revalidatePath(`/months/${label}`);
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  return label;
}

export async function updatePeriodNotes(periodId: number, notes: string): Promise<void> {
  await requireSession();
  await db.update(periods).set({ notes }).where(eq(periods.id, periodId));
}

/**
 * Delete a month: its bill instances and budget go with it (transactions linked to one of those
 * instances from another month just lose the link — FK SET NULL; budget lines and projection
 * snapshots cascade). Refused while the month still holds transactions — those are real money and
 * need moving or deleting first — and for this month and next, which ensureCurrentPeriods would
 * simply recreate on the next page load.
 */
export async function deletePeriod(periodId: number): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  await requireSession();
  const [p] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
  if (!p) return { ok: false, error: "That month no longer exists." };

  const ym = dateToYearMonth(todayIso());
  if (ym) {
    const nowIdx = ym.year * 12 + ym.month - 1;
    const idx = p.year * 12 + p.month - 1;
    if (idx === nowIdx || idx === nowIdx + 1)
      return { ok: false, error: "This month and next are created automatically — deleting them would just bring them back." };
  }

  const [{ n }] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(eq(transactions.periodId, periodId));
  if (Number(n) > 0)
    return { ok: false, error: `${p.label} still has ${n} transaction${Number(n) === 1 ? "" : "s"}. Move or delete them first.` };

  await db.transaction(async (tx) => {
    await tx.delete(budgets).where(eq(budgets.periodId, periodId));
    await tx.delete(billInstances).where(eq(billInstances.periodId, periodId));
    await tx.delete(periods).where(eq(periods.id, periodId));
  });
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath(`/months/${p.label}`);
  return { ok: true, label: p.label };
}

"use server";

import { db } from "@/server/db";
import { savingsGoals, goalContributions } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { GOAL_TYPE_META, type GoalType } from "@/constants/enums";
import { requireSession } from "@/server/auth/session";

// Goals surface on their own page and on the dashboard — refresh both on every write.
function revalidateGoals() {
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

export async function createGoal(input: {
  name: string;
  goalType: string;
  targetAmount: number;
  targetDate?: string | null;
  fundingAccountId?: number | null;
  color?: string | null;
  emoji?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a name" };
  if (!(input.targetAmount > 0)) return { ok: false, error: "Enter a target amount greater than 0" };

  const goalType = input.goalType || "savings";
  const meta = GOAL_TYPE_META[goalType as GoalType];

  // Append at the end of the priority order (sort_order drives the shortfall fill).
  const [nextRow] = await db
    .select({ next: sql<number>`COALESCE(MAX(${savingsGoals.sortOrder}), -1) + 1` })
    .from(savingsGoals);

  await db.insert(savingsGoals).values({
    name,
    goalType,
    targetAmount: String(input.targetAmount),
    targetDate: input.targetDate || null,
    fundingAccountId: input.fundingAccountId ?? null,
    color: input.color || meta?.color || "#3b82f6",
    emoji: input.emoji || meta?.emoji || null,
    notes: input.notes || null,
    sortOrder: Number(nextRow?.next ?? 0),
  });
  revalidateGoals();
  return { ok: true };
}

export async function updateGoal(
  id: number,
  patch: {
    name?: string;
    goalType?: string;
    targetAmount?: number;
    targetDate?: string | null;
    fundingAccountId?: number | null;
    color?: string;
    emoji?: string | null;
    status?: string;
    notes?: string | null;
  },
): Promise<void> {
  await requireSession();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.goalType !== undefined) set.goalType = patch.goalType;
  if (patch.targetAmount !== undefined) set.targetAmount = String(patch.targetAmount);
  if (patch.targetDate !== undefined) set.targetDate = patch.targetDate || null;
  if (patch.fundingAccountId !== undefined) set.fundingAccountId = patch.fundingAccountId;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.emoji !== undefined) set.emoji = patch.emoji || null;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes || null;
  if (Object.keys(set).length) await db.update(savingsGoals).set(set).where(eq(savingsGoals.id, id));
  revalidateGoals();
}

export async function setGoalStatus(id: number, status: string): Promise<void> {
  await requireSession();
  await db.update(savingsGoals).set({ status }).where(eq(savingsGoals.id, id));
  revalidateGoals();
}

export async function deleteGoal(id: number): Promise<void> {
  await requireSession();
  // Remove the goal's funding ledger first (no ON DELETE cascade), then the goal itself.
  await db.transaction(async (tx) => {
    await tx.delete(goalContributions).where(eq(goalContributions.goalId, id));
    await tx.delete(savingsGoals).where(eq(savingsGoals.id, id));
  });
  revalidateGoals();
}

// Record a funding event. Positive amount = money toward the goal, negative = withdrawn.
export async function addContribution(
  goalId: number,
  amount: number,
  occurredOn: string,
  note: string | null,
): Promise<void> {
  await requireSession();
  if (!amount || Number.isNaN(amount) || !occurredOn) return;
  await db.insert(goalContributions).values({
    goalId,
    amount: String(amount),
    occurredOn,
    note: note || null,
  });
  revalidateGoals();
}

export async function deleteContribution(id: number): Promise<void> {
  await requireSession();
  await db.delete(goalContributions).where(eq(goalContributions.id, id));
  revalidateGoals();
}

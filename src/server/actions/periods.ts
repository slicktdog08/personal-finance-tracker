"use server";

import { db } from "@/server/db";
import { periods } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { periodLabel } from "@/server/lib/period";
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

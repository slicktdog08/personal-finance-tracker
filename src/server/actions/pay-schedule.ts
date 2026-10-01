"use server";

import { db } from "@/server/db";
import { paySchedule } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { PAY_FREQUENCIES, PAY_FREQUENCY_META, type PayFrequency } from "@/constants/enums";
import { requireSession } from "@/server/auth/session";

// The schedule drives the dashboard countdown and its own settings page — refresh both.
function revalidatePaySchedule() {
  revalidatePath("/settings/pay-schedule");
  revalidatePath("/dashboard");
}

export interface PayScheduleForm {
  frequency: string;
  dayOne: number | null;
  dayTwo: number | null;
  anchorDate: string | null;
  takeHome: number | null;
  /** ± days a real deposit may drift from its nominal payday (payday-reconcile.ts). */
  depositWindowDays?: number | null;
  /** Case-insensitive regex picking payroll out of all credits; blank = the built-in default. */
  depositMatch?: string | null;
}

/**
 * Upsert the single schedule row. Fields the chosen cadence doesn't use are nulled rather than
 * kept, so a stale anchor date from a previous cadence can never leak into the projection.
 */
export async function savePaySchedule(
  input: PayScheduleForm,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  if (!PAY_FREQUENCIES.includes(input.frequency as PayFrequency)) {
    return { ok: false, error: "Pick how often you get paid." };
  }
  const frequency = input.frequency as PayFrequency;
  const usesDays = PAY_FREQUENCY_META[frequency].usesDays;

  const validDay = (d: number | null) =>
    d != null && Number.isInteger(d) && d >= 1 && d <= 31 ? d : null;

  let dayOne: number | null = null;
  let dayTwo: number | null = null;
  let anchorDate: string | null = null;

  if (usesDays) {
    dayOne = validDay(input.dayOne);
    if (dayOne == null) return { ok: false, error: "Enter a payday date between 1 and 31." };
    if (frequency === "semimonthly") {
      dayTwo = validDay(input.dayTwo);
      if (dayTwo == null) return { ok: false, error: "Enter both paydays (1–31)." };
      if (dayTwo === dayOne) return { ok: false, error: "The two paydays must be different." };
      // Store ascending so the projection window and the settings form always agree on order.
      if (dayTwo < dayOne) [dayOne, dayTwo] = [dayTwo, dayOne];
    }
  } else {
    anchorDate = input.anchorDate?.trim() || null;
    if (!anchorDate || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      return { ok: false, error: "Pick a recent payday so the cadence has something to count from." };
    }
  }

  if (input.takeHome != null && (Number.isNaN(input.takeHome) || input.takeHome < 0)) {
    return { ok: false, error: "Take-home can't be negative." };
  }

  // The window has to stay well under half a pay cycle, or one payday's deposits could be
  // credited to the next one. 14 days is generous even for a monthly schedule.
  const win = input.depositWindowDays;
  if (win != null && (!Number.isInteger(win) || win < 0 || win > 14)) {
    return { ok: false, error: "The deposit window must be a whole number of days from 0 to 14." };
  }
  // Reject a pattern that won't compile here rather than letting it silently match nothing at
  // projection time.
  const match = input.depositMatch?.trim() || null;
  if (match) {
    try {
      new RegExp(match, "i");
    } catch {
      return { ok: false, error: "That payroll pattern isn't a valid regular expression." };
    }
  }

  const values = {
    frequency,
    dayOne,
    dayTwo,
    anchorDate,
    takeHome: input.takeHome == null ? null : String(input.takeHome),
    ...(win == null ? {} : { depositWindowDays: win }),
    depositMatch: match,
    active: true,
  };

  const [existing] = await db.select({ id: paySchedule.id }).from(paySchedule).limit(1);
  if (existing) {
    await db.update(paySchedule).set(values).where(eq(paySchedule.id, existing.id));
  } else {
    await db.insert(paySchedule).values(values);
  }

  revalidatePaySchedule();
  return { ok: true };
}

/** Clear the schedule — the dashboard falls back to the setup prompt. */
export async function clearPaySchedule(): Promise<void> {
  await requireSession();
  await db.delete(paySchedule);
  revalidatePaySchedule();
}

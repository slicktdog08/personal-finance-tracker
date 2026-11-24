"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { paceOneOffs, transactions } from "@/server/db/schema";
import { requireSession } from "@/server/auth/session";
import { savePaceConfig } from "@/server/pace";
import type { OneOffMode, PaceConfig } from "@/server/lib/spending-pace";

// Spending Pace writes. Tagging a one-off is ALWAYS the user's own action — the monitor never
// tags anything itself. See planning/features/spending-pace.md.

function refresh() {
  revalidatePath("/pace");
  revalidatePath("/dashboard");
  revalidatePath("/settings/pace");
}

export async function tagOneOff(txnId: number, mode: OneOffMode, note: string | null = null): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  if (!Number.isInteger(txnId) || txnId <= 0) return { ok: false, error: "Unknown transaction." };
  if (mode !== "exclude" && mode !== "spread") return { ok: false, error: "Mode must be exclude or spread." };
  const [t] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, txnId)).limit(1);
  if (!t) return { ok: false, error: `No transaction #${txnId}.` };
  const clean = note?.trim().slice(0, 255) || null;
  await db.insert(paceOneOffs).values({ txnId, mode, note: clean }).onDuplicateKeyUpdate({ set: { mode, note: clean } });
  refresh();
  return { ok: true };
}

export async function removeOneOff(txnId: number): Promise<void> {
  await requireSession();
  await db.delete(paceOneOffs).where(eq(paceOneOffs.txnId, txnId));
  refresh();
}

export async function savePaceSettings(cfg: Partial<PaceConfig>): Promise<PaceConfig> {
  await requireSession();
  const saved = await savePaceConfig(cfg);
  refresh();
  return saved;
}

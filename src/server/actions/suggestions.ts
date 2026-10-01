"use server";

import { db } from "@/server/db";
import { suggestionDismissals } from "@/server/db/schema";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";

// Hide a recurring-bill suggestion (by its normalized merchant key) so it stops
// being surfaced on the Bills screen. Idempotent.
export async function dismissSuggestion(merchantKey: string): Promise<void> {
  await requireSession();
  const key = merchantKey.trim().slice(0, 191);
  if (!key) return;
  await db
    .insert(suggestionDismissals)
    .values({ merchantKey: key })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  revalidatePath("/settings/bills");
}

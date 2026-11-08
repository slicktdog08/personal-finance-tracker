"use server";

import { db } from "@/server/db";
import { transactions, uiLayouts } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireSession } from "@/server/auth/session";
import { TXN_SEEN_KEY } from "@/lib/transactions-seen";

// No revalidatePath: the caller clears the nav badge client-side, and re-rendering the
// Transactions page (every query on it) just to zero a badge would be pure cost.

/**
 * Mark every transaction up to `upToId` as seen. `upToId` is the newest id the Transactions page
 * rendered — not "now" — so a sync that lands while the page is open still counts as new.
 * The watermark only moves forward (two open tabs can't rewind it) and never past a real row.
 */
export async function markTransactionsSeen(upToId: unknown): Promise<{ ok: boolean }> {
  await requireSession();
  const wanted = Number(upToId);
  if (!Number.isInteger(wanted) || wanted < 0) return { ok: false };
  try {
    const [[latest], [row]] = await Promise.all([
      db.select({ m: sql<number | null>`MAX(${transactions.id})` }).from(transactions),
      db.select({ layout: uiLayouts.layout }).from(uiLayouts).where(eq(uiLayouts.layoutKey, TXN_SEEN_KEY)),
    ]);
    const prev = Number((row?.layout as { lastSeenId?: unknown } | null)?.lastSeenId) || 0;
    const next = Math.min(wanted, Number(latest?.m ?? 0));
    if (next <= prev) return { ok: true };
    const layout = { lastSeenId: next };
    await db.insert(uiLayouts).values({ layoutKey: TXN_SEEN_KEY, layout }).onDuplicateKeyUpdate({ set: { layout } });
    return { ok: true };
  } catch (e) {
    console.error("markTransactionsSeen", e);
    return { ok: false };
  }
}

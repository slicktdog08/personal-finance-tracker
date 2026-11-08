import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { syncAccounts, syncEnrollments } from "@/server/db/schema";
import { requireSession } from "@/server/auth/session";

/**
 * Bank-sync state for the app shell's "Synced 4h ago" line and its Sync button: whether any
 * enabled account is fed by sync, and the latest time one of them synced. Lives apart from
 * queries.ts so the shell's small needs don't grow that file.
 */
export async function getShellSyncState(): Promise<{ enabled: boolean; lastSyncedAt: string | null }> {
  await requireSession();
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)`, last: sql<Date | string | null>`MAX(${syncAccounts.lastSyncedAt})` })
    .from(syncAccounts)
    .innerJoin(syncEnrollments, eq(syncEnrollments.id, syncAccounts.enrollmentId))
    .where(and(eq(syncAccounts.enabled, true), eq(syncEnrollments.status, "active")));
  const last = row?.last ? new Date(row.last) : null;
  return { enabled: Number(row?.n ?? 0) > 0, lastSyncedAt: last && !Number.isNaN(last.getTime()) ? last.toISOString() : null };
}

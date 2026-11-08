import Link from "next/link";
import { Notice } from "@/components/ds";
import { db } from "@/server/db";
import { syncEnrollments, syncRuns } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { SYNC_NOTICE_COOKIE } from "@/lib/sync-notice";
import { SyncNoticeDismiss } from "@/components/SyncNoticeDismiss";

// Slim notice above the page content when bank sync needs a human: a disconnected enrollment
// (bank wants a fresh login/MFA) or the latest run failed outright. Silent otherwise, and
// silent on any DB error — the pages have their own SetupNotice for that. Dismissible: the ✕
// remembers this particular problem (see SyncNoticeDismiss), so it returns for a new one.
export async function SyncNotice() {
  let disconnected: { id: number; name: string | null }[] = [];
  let lastFailed = false;
  let lastRunId = 0;
  try {
    disconnected = await db
      .select({ id: syncEnrollments.id, name: syncEnrollments.institutionName })
      .from(syncEnrollments)
      .where(eq(syncEnrollments.status, "disconnected"));
    const [last] = await db.select({ id: syncRuns.id, status: syncRuns.status }).from(syncRuns).orderBy(desc(syncRuns.id)).limit(1);
    lastFailed = last?.status === "failed";
    lastRunId = last?.id ?? 0;
  } catch {
    return null;
  }
  if (!disconnected.length && !lastFailed) return null;
  const names = disconnected.map((d) => d.name ?? "a bank").join(", ");
  const dismissKey = disconnected.length
    ? `disconnected:${disconnected.map((d) => d.id).sort((a, b) => a - b).join(",")}`
    : `run:${lastRunId}`;
  let dismissed: string | undefined;
  try {
    dismissed = (await cookies()).get(SYNC_NOTICE_COOKIE)?.value;
  } catch {
    // Rendered outside a request (tests): nothing can have been dismissed.
  }
  if (dismissed === dismissKey) return null;
  return (
    <SyncNoticeDismiss dismissKey={dismissKey}>
      <Notice
        tone="warn"
        title={disconnected.length ? `${names} needs reconnecting.` : "The last bank sync failed."}
        action={
          <Link href="/settings/sync" className="shrink-0 self-center text-sm font-medium text-accent-text hover:underline">
            Open Bank Sync →
          </Link>
        }
        className="pr-11"
      />
    </SyncNoticeDismiss>
  );
}

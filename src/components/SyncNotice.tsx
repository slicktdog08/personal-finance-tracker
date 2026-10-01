import Link from "next/link";
import { db } from "@/server/db";
import { syncEnrollments, syncRuns } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";

// Slim banner under the nav when bank sync needs a human: a disconnected enrollment
// (bank wants a fresh login/MFA) or the latest run failed outright. Silent otherwise, and
// silent on any DB error — the pages have their own SetupNotice for that.
export async function SyncNotice() {
  let disconnected: { name: string | null }[] = [];
  let lastFailed = false;
  try {
    disconnected = await db
      .select({ name: syncEnrollments.institutionName })
      .from(syncEnrollments)
      .where(eq(syncEnrollments.status, "disconnected"));
    const [last] = await db.select({ status: syncRuns.status }).from(syncRuns).orderBy(desc(syncRuns.id)).limit(1);
    lastFailed = last?.status === "failed";
  } catch {
    return null;
  }
  if (!disconnected.length && !lastFailed) return null;
  const names = disconnected.map((d) => d.name ?? "a bank").join(", ");
  return (
    <div className="w-full bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {disconnected.length ? `${names} needs reconnecting.` : "The last bank sync failed."}
        </span>
        <Link href="/settings/sync" className="font-medium underline underline-offset-2 hover:text-amber-700">
          Open Bank Sync →
        </Link>
      </div>
    </div>
  );
}

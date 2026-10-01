import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { SetupNotice } from "@/components/SetupNotice";
import { SyncStatusCard } from "@/components/settings/sync/SyncStatusCard";
import { EnrollmentList } from "@/components/settings/sync/EnrollmentList";
import { SyncRunHistory } from "@/components/settings/sync/SyncRunHistory";
import { AdvancedSyncSettings } from "@/components/settings/sync/AdvancedSyncSettings";
import { getConnectConfig } from "@/server/actions/sync";
import { getSyncSettings } from "@/server/lib/sync/settings";
import { listEnrollmentsWithAccounts, listRecentRuns, pendingSummary } from "@/server/lib/sync/sync";
import { getAccounts } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function SyncSettingsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  let data;
  try {
    const [settings, enrollments, runs, accounts, connect, pending] = await Promise.all([
      getSyncSettings(),
      listEnrollmentsWithAccounts(),
      listRecentRuns(all === "1" ? 200 : 20),
      getAccounts(),
      getConnectConfig(),
      pendingSummary(),
    ]);
    data = { settings, enrollments, runs, accounts, connect, pending };
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  const { settings, enrollments, runs, accounts, connect, pending } = data;
  const lastRun = runs[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-blue-600">
          <ArrowLeftIcon /> Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Bank Sync 🏦</h1>
        <p className="text-sm text-neutral-500">
          Link a bank once and transactions and balances pull themselves on a schedule. Pending
          card charges show up the same day and settle in place when they post.
        </p>
      </div>

      <SyncStatusCard
        settings={{
          enabled: settings.enabled,
          intervalMinutes: settings.intervalMinutes,
          nextRunAt: settings.nextRunAt?.toISOString() ?? null,
          lastWebhookAt: settings.lastWebhookAt?.toISOString() ?? null,
          running: settings.lockUntil != null && settings.lockUntil > new Date(),
        }}
        lastRun={
          lastRun && {
            id: lastRun.id,
            status: lastRun.status,
            trigger: lastRun.trigger,
            startedAt: lastRun.startedAt?.toISOString() ?? null,
            inserted: lastRun.inserted,
            updated: lastRun.updated,
            promoted: lastRun.promoted,
            expired: lastRun.expired,
            error: lastRun.error,
          }
        }
        pending={pending}
        schedulerEnv={process.env.SYNC_SCHEDULER === "1"}
        activeEnrollments={enrollments.filter((e) => e.status === "active").length}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-lg">Linked banks</h2>
            <p className="text-sm text-neutral-500">
              One entry per bank login. Map each account the bank exposes to the account it feeds here.
            </p>
          </div>
        </div>
        {!connect.ready && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
            <div className="font-medium">Linking a bank isn&apos;t available:</div>
            <ul className="list-disc list-inside mt-1">
              {connect.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="mt-1 text-xs">
              See <code className="font-mono">planning/features/bank-sync.md</code> for how a provider plugs in.
            </div>
          </div>
        )}
        <EnrollmentList
          enrollments={enrollments.map((e) => ({
            id: e.id,
            provider: e.provider,
            enrollmentId: e.enrollmentId,
            institutionName: e.institutionName,
            status: e.status,
            disconnectReason: e.disconnectReason,
            lastSyncedAt: e.lastSyncedAt?.toISOString() ?? null,
            lastError: e.lastError,
            accounts: e.accounts.map((a) => ({
              id: a.id,
              externalAccountId: a.externalAccountId,
              name: a.name,
              type: a.type,
              subtype: a.subtype,
              lastFour: a.lastFour,
              accountId: a.accountId,
              enabled: a.enabled,
              syncBalances: a.syncBalances,
              syncFrom: a.syncFrom,
              externalStatus: a.externalStatus,
              lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
              lastError: a.lastError,
            })),
          }))}
          localAccounts={accounts.map((a) => ({
            id: a.id,
            label: a.label ?? a.accountNumber,
            accountNumber: a.accountNumber,
            institution: a.institution,
            accountType: a.accountType,
          }))}
          connect={connect}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Run history</h2>
        <SyncRunHistory
          runs={runs.map((r) => ({
            id: r.id,
            trigger: r.trigger,
            status: r.status,
            dryRun: r.dryRun,
            startedAt: r.startedAt?.toISOString() ?? null,
            finishedAt: r.finishedAt?.toISOString() ?? null,
            inserted: r.inserted,
            updated: r.updated,
            promoted: r.promoted,
            expired: r.expired,
            skippedDupes: r.skippedDupes,
            balancesRecorded: r.balancesRecorded,
            error: r.error,
            details: r.details as unknown,
          }))}
          showingAll={all === "1"}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Advanced</h2>
        <AdvancedSyncSettings
          settings={{
            syncWindowDays: settings.syncWindowDays,
            pendingExpiryDays: settings.pendingExpiryDays,
            recordBalances: settings.recordBalances,
            autoCategorize: settings.autoCategorize,
            webhookEnabled: settings.webhookEnabled,
          }}
        />
      </section>
    </div>
  );
}

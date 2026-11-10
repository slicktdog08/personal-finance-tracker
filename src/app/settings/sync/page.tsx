import { Badge, Card, Notice } from "@/components/ds";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { SyncStatusCard } from "@/components/settings/sync/SyncStatusCard";
import { EnrollmentList } from "@/components/settings/sync/EnrollmentList";
import { SyncRunHistory } from "@/components/settings/sync/SyncRunHistory";
import { AdvancedSyncSettings } from "@/components/settings/sync/AdvancedSyncSettings";
import { LinkSimplefin } from "@/components/settings/sync/LinkSimplefin";
import { PlaidLinkButton } from "@/components/settings/sync/PlaidLink";
import { getConnectConfig } from "@/server/actions/sync";
import { schedulerAllowed } from "@/server/sync/scheduler-gate";
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
    return <SetupNotice error={e} />;
  }
  const { settings, enrollments, runs, accounts, connect, pending } = data;
  const lastRun = runs[0] ?? null;

  return (
    <div className="space-y-6">
      <SettingsHeader
        reorder={false}
        title="Bank sync"
        description="Link your banks once and transactions and balances pull themselves on a schedule. Pending card charges show up when the bank reports them and settle in place when they post."
      />

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
        schedulerEnv={schedulerAllowed()}
        activeEnrollments={enrollments.filter((e) => e.status === "active").length}
      />

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Linked banks</h2>
          <p className="text-sm text-fg-2">
            One entry per bank login. Map each account the bank exposes to the account it feeds here.
          </p>
        </div>
        {connect.demo && (
          <Notice tone="info" title="Demo Bank">
            Bank linking is disabled in the demo — Demo Bank is already connected. It&apos;s a made-up bank that
            runs through the same sync engine a real one would, so <strong>Sync now</strong> brings in new
            pretend transactions and balances.
          </Notice>
        )}
        {connect.ready && connect.providers.includes("simplefin") && (
          <Card title="Link with SimpleFIN" meta="paste a Setup Token">
            <LinkSimplefin envToken={connect.simplefinEnvToken} />
          </Card>
        )}
        {connect.ready && connect.plaid && (
          <Card
            title="Link with Plaid"
            meta="sign in to your bank"
            action={<Badge label={connect.plaid.env} color={connect.plaid.env === "sandbox" ? "#f59e0b" : "#10b981"} size="sm" />}
          >
            <div className="space-y-2">
              <p className="text-sm text-fg-2">
                Sign in to your bank in Plaid&apos;s window; the accounts you share appear below for mapping. Plaid refreshes
                several times a day and tells this app when there&apos;s something new.
              </p>
              {connect.plaid.env === "sandbox" ? (
                <Notice tone="warn">
                  Sandbox: fake banks only (sign in as <code className="font-mono">user_good</code> /{" "}
                  <code className="font-mono">pass_good</code>). Don&apos;t map sandbox accounts to real ones.
                </Notice>
              ) : (
                <p className="text-xs text-fg-3">Each bank you link uses one of the plan&apos;s Items; removing it doesn&apos;t give the slot back.</p>
              )}
              <PlaidLinkButton />
            </div>
          </Card>
        )}
        {!connect.ready && !connect.demo && (
          <Notice tone="warn" title="Linking a bank isn't available">
            <ul className="mt-1 list-inside list-disc">
              {connect.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {!connect.providers.length && (
              <div className="mt-1 text-xs">
                See <code className="font-mono">planning/features/bank-sync.md</code> for how a provider plugs in.
              </div>
            )}
          </Notice>
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
        <h2 className="font-display text-lg font-semibold">Run history</h2>
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

      <section>
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

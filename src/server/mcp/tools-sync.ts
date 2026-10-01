import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fail, money0, ok } from "./result";
import { getSyncSettings } from "@/server/lib/sync/settings";
import { listEnrollmentsWithAccounts, listRecentRuns, pendingSummary, runSync } from "@/server/lib/sync/sync";
import { getTransactionsPage } from "@/server/queries";

// Bank-sync tools. Every read here comes from OUR tables — never from the provider
// (bank-sync.md D11): the advisor sees exactly the ledger the UI shows, and the tools work
// even when the provider is down. `run_bank_sync` is the single tool that reaches the
// provider, and only through the same sync writer the scheduler uses.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export function registerSyncTools(server: McpServer) {
  server.registerTool(
    "get_sync_status",
    {
      title: "Bank sync status",
      description:
        "How automatic bank sync is doing: whether it's enabled and how often it runs, each linked bank (institution, active/paused/disconnected, last synced) with the accounts it feeds, the last few runs with counts and errors, and how many transactions are currently pending at the bank. Read-only, from stored state.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const [settings, enrollments, runs, pending] = await Promise.all([
        getSyncSettings(),
        listEnrollmentsWithAccounts(),
        listRecentRuns(5),
        pendingSummary(),
      ]);
      return ok({
        enabled: settings.enabled,
        intervalMinutes: settings.intervalMinutes,
        nextRunAt: settings.nextRunAt?.toISOString() ?? null,
        lastWebhookAt: settings.lastWebhookAt?.toISOString() ?? null,
        pending: { count: pending.count, debits: money0(pending.debits), credits: money0(pending.credits) },
        banks: enrollments.map((e) => ({
          enrollmentDbId: e.id,
          provider: e.provider,
          institution: e.institutionName,
          status: e.status,
          disconnectReason: e.disconnectReason,
          lastSyncedAt: e.lastSyncedAt?.toISOString() ?? null,
          lastError: e.lastError,
          accounts: e.accounts.map((a) => ({
            name: a.name,
            lastFour: a.lastFour,
            type: a.type,
            subtype: a.subtype,
            feedsAccountId: a.accountId,
            enabled: a.enabled,
            syncBalances: a.syncBalances,
            syncFrom: a.syncFrom,
            lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
            lastError: a.lastError,
          })),
        })),
        recentRuns: runs.map((r) => ({
          runId: r.id,
          trigger: r.trigger,
          status: r.status,
          dryRun: r.dryRun,
          startedAt: r.startedAt?.toISOString() ?? null,
          inserted: r.inserted,
          updated: r.updated,
          promoted: r.promoted,
          expired: r.expired,
          skippedDupes: r.skippedDupes,
          balancesRecorded: r.balancesRecorded,
          error: r.error,
        })),
      });
    },
  );

  server.registerTool(
    "list_pending_transactions",
    {
      title: "Pending transactions",
      description:
        "Transactions the bank has authorized but not settled (status = pending), as stored by the last sync — not a live bank call. They already count as spend in period summaries. Optionally restrict to a month or account.",
      inputSchema: z.object({
        period: z.string().regex(/^\d{4}-\d{1,2}$/).optional().describe("YYYY-MM; omit for all months."),
        accountIds: z.array(z.number().int()).optional(),
        pageSize: z.number().int().min(1).max(200).default(50),
        page: z.number().int().min(1).default(1),
      }),
      annotations: READ_ONLY,
    },
    async ({ period, accountIds, pageSize, page }) => {
      const res = await getTransactionsPage({
        pending: true,
        periodLabels: period ? [period] : undefined,
        accountIds,
        sort: "date",
        dir: "desc",
        page,
        pageSize,
      });
      return ok({
        total: res.total,
        page: res.page,
        pages: res.pages,
        totals: { debits: money0(res.sumDebit), credits: money0(res.sumCredit) },
        transactions: res.rows.map((t) => ({
          transactionId: t.id,
          date: t.txnDate,
          description: t.description,
          amount: money0(t.amount),
          direction: t.direction,
          category: t.category,
          account: t.accountLabel ?? t.accountNumber,
          accountId: t.accountId,
          period: t.periodLabel,
          source: t.source,
        })),
      });
    },
  );

  server.registerTool(
    "run_bank_sync",
    {
      title: "Run bank sync now",
      description:
        "Pull the latest transactions and balances from every linked bank right now (or a dry run that reports what would change without writing). Takes a few seconds per bank. Ask the user before calling; returns per-bank counts and any errors.",
      inputSchema: z.object({
        dryRun: z.boolean().default(false),
      }),
      annotations: WRITE,
    },
    async ({ dryRun }) => {
      const summary = await runSync({ trigger: "manual", dryRun });
      if (summary.status === "locked") return fail("A sync is already running; try again in a minute.");
      return ok({
        runId: summary.runId,
        status: summary.status,
        dryRun,
        inserted: summary.inserted,
        updated: summary.updated,
        promoted: summary.promoted,
        expired: summary.expired,
        skippedDupes: summary.skippedDupes,
        balancesRecorded: summary.balancesRecorded,
        error: summary.error,
        banks: summary.enrollments.map((e) => ({
          institution: e.institution,
          status: e.status,
          error: e.error,
          accounts: e.accounts.map((a) => ({
            name: a.name,
            skipped: a.skipped,
            fetched: a.fetched,
            inserted: a.inserted,
            updated: a.updated,
            promoted: a.promoted,
            expired: a.expired,
            softDupes: a.softDupes.length,
            error: a.error,
          })),
        })),
      });
    },
  );
}

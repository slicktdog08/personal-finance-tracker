/**
 * Bank-sync management CLI (planning/features/bank-sync.md).
 *
 *   npm run sync -- <command> [options]
 *
 * Runs the real server modules against the DB in .env.local, with the Next-only imports
 * stubbed (tests/stubs.cjs). Commands that reach the provider say so; everything else is
 * DB-only, like the app (D11).
 *
 *   status                                  settings, banks, last run, pending count
 *   enrollments                             linked banks + their accounts + mappings
 *   enroll --provider <id> --token T --enrollment ENR [--institution NAME]
 *                                           store an access token (headless / sandbox)
 *   map <syncAccountId> <accountId|none> [--from YYYY-MM-DD]
 *   account <syncAccountId> [--enabled 0|1] [--balances 0|1] [--from YYYY-MM-DD]
 *   pause <enrollmentDbId> | resume <enrollmentDbId> | remove <enrollmentDbId> [--keep-remote]
 *   sync [--enrollment <dbId>] [--dry-run]  run the sync writer (provider call)
 *   runs [--last N] | run <id>              run history / one run's details
 *   settings [key=value ...]                show or change sync_settings
 *   ignored [--clear <source> <externalId>] tombstones for deleted synced rows
 *   probe [--enrollment <dbId>]             live accounts + balances from the provider
 *   check                                   env + registered providers + token round-trip
 */
import { readFileSync } from "fs";

type Args = { _: string[]; [k: string]: string | boolean | string[] };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const str = (v: string | boolean | string[] | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 19) : "never");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function table(rows: Record<string, unknown>[]): void {
  if (!rows.length) {
    console.log("  (none)");
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  console.log("  " + cols.map((c, i) => c.padEnd(widths[i])).join("  "));
  for (const r of rows) console.log("  " + cols.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join("  "));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(readFileSync(__filename, "utf8").split("*/")[0].split("\n").slice(1).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
    return;
  }

  // Lazy imports so `help` works without a DB.
  const S = async () => import("@/server/lib/sync/settings");
  const Y = async () => import("@/server/lib/sync/sync");

  switch (cmd) {
    case "status": {
      const { getSyncSettings } = await S();
      const { listEnrollmentsWithAccounts, listRecentRuns, pendingSummary } = await Y();
      const [s, enr, runs, pending] = await Promise.all([getSyncSettings(), listEnrollmentsWithAccounts(), listRecentRuns(1), pendingSummary()]);
      console.log(`enabled: ${s.enabled}   every ${s.intervalMinutes} min   next: ${fmtDate(s.nextRunAt)}   window ${s.syncWindowDays}d   expiry ${s.pendingExpiryDays}d`);
      console.log(`balances: ${s.recordBalances}   categorize: ${s.autoCategorize}   webhooks: ${s.webhookEnabled}   last webhook: ${fmtDate(s.lastWebhookAt)}   lock: ${fmtDate(s.lockUntil)}`);
      console.log(`scheduler env: SYNC_SCHEDULER=${process.env.SYNC_SCHEDULER ?? "(unset)"}`);
      console.log(`pending: ${pending.count} (${money(pending.debits)} out, ${money(pending.credits)} in)`);
      console.log("banks:");
      table(
        enr.map((e) => ({
          id: e.id,
          provider: e.provider,
          institution: e.institutionName,
          status: e.status,
          accounts: `${e.accounts.filter((a) => a.accountId != null).length}/${e.accounts.length} mapped`,
          lastSynced: fmtDate(e.lastSyncedAt),
          error: e.lastError ? e.lastError.slice(0, 60) : "",
        })),
      );
      const r = runs[0];
      console.log(r ? `last run #${r.id}: ${r.status} via ${r.trigger} at ${fmtDate(r.startedAt)} +${r.inserted} ~${r.updated} ↑${r.promoted} −${r.expired} dupes ${r.skippedDupes}` : "last run: none");
      break;
    }
    case "enrollments": {
      const { listEnrollmentsWithAccounts } = await Y();
      for (const e of await listEnrollmentsWithAccounts()) {
        console.log(`#${e.id} ${e.provider} ${e.institutionName ?? ""} (${e.enrollmentId}) — ${e.status}${e.disconnectReason ? ` (${e.disconnectReason})` : ""}`);
        table(
          e.accounts.map((a) => ({
            syncAccountId: a.id,
            external: a.externalAccountId,
            name: a.name,
            type: `${a.type}/${a.subtype}`,
            last4: a.lastFour,
            feeds: a.accountId ?? "—",
            enabled: a.enabled,
            balances: a.syncBalances,
            from: a.syncFrom ?? "",
            status: a.externalStatus,
            synced: fmtDate(a.lastSyncedAt),
          })),
        );
      }
      break;
    }
    case "enroll": {
      const provider = str(args.provider);
      const token = str(args.token);
      const enrollmentId = str(args.enrollment);
      if (!provider || !token || !enrollmentId) throw new Error("enroll needs --provider, --token and --enrollment");
      const { completeEnrollment } = await Y();
      const res = await completeEnrollment({ provider, accessToken: token, enrollmentId, institutionName: str(args.institution) ?? null });
      console.log(`enrollment #${res.enrollmentDbId} stored; ${res.accounts.length} accounts (${res.accounts.filter((a) => a.accountId != null).length} auto-mapped)`);
      table(res.accounts.map((a) => ({ syncAccountId: a.id, name: a.name, type: a.type, last4: a.lastFour, feeds: a.accountId ?? "—", from: a.syncFrom ?? "" })));
      break;
    }
    case "map": {
      const [saId, target] = rest;
      if (!saId || !target) throw new Error("map <syncAccountId> <accountId|none> [--from date]");
      const { mapExternalAccount } = await Y();
      await mapExternalAccount(Number(saId), target === "none" ? null : Number(target), str(args.from) ?? null);
      console.log("mapped");
      break;
    }
    case "account": {
      const [saId] = rest;
      if (!saId) throw new Error("account <syncAccountId> [--enabled 0|1] [--balances 0|1] [--from date]");
      const { db } = await import("@/server/db");
      const { syncAccounts } = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      const set: Record<string, unknown> = {};
      if (args.enabled != null) set.enabled = str(args.enabled) === "1";
      if (args.balances != null) set.syncBalances = str(args.balances) === "1";
      if (args.from != null) {
        set.syncFrom = str(args.from) || null;
        set.lastSyncedAt = null;
      }
      await db.update(syncAccounts).set(set).where(eq(syncAccounts.id, Number(saId)));
      console.log("updated", set);
      break;
    }
    case "pause":
    case "resume": {
      const [id] = rest;
      const { db } = await import("@/server/db");
      const { syncEnrollments } = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(syncEnrollments).set({ status: cmd === "pause" ? "paused" : "active" }).where(eq(syncEnrollments.id, Number(id)));
      console.log(cmd === "pause" ? "paused" : "active");
      break;
    }
    case "remove": {
      const [id] = rest;
      const { removeEnrollment } = await Y();
      await removeEnrollment(Number(id), { revokeRemote: !args["keep-remote"] });
      console.log("removed");
      break;
    }
    case "sync": {
      const { runSync } = await Y();
      const summary = await runSync({
        trigger: "cli",
        enrollmentDbId: args.enrollment ? Number(str(args.enrollment)) : undefined,
        dryRun: Boolean(args["dry-run"]),
        log: (l) => console.log(l),
      });
      console.log(
        `run #${summary.runId ?? "-"}: ${summary.status}${summary.dryRun ? " (dry run)" : ""} — +${summary.inserted} new, ~${summary.updated} changed (${summary.promoted} posted), −${summary.expired} expired, ${summary.skippedDupes} soft-dupes, ${summary.balancesRecorded} balances${summary.error ? ` — ${summary.error}` : ""}`,
      );
      for (const e of summary.enrollments) {
        for (const a of e.accounts) {
          for (const d of a.softDupes) console.log(`  dupe skipped: ${d.date} ${d.direction} ${money(d.amount)} "${d.description}" ≈ #${d.existingId} "${d.existingDescription}"`);
        }
      }
      if (summary.status === "failed") process.exitCode = 1;
      break;
    }
    case "runs": {
      const { listRecentRuns } = await Y();
      const runs = await listRecentRuns(args.last ? Number(str(args.last)) : 20);
      table(
        runs.map((r) => ({
          id: r.id,
          status: r.status,
          via: r.trigger,
          dry: r.dryRun ? "y" : "",
          started: fmtDate(r.startedAt),
          new: r.inserted,
          changed: r.updated,
          posted: r.promoted,
          expired: r.expired,
          dupes: r.skippedDupes,
          bal: r.balancesRecorded,
          error: r.error ? r.error.slice(0, 50) : "",
        })),
      );
      break;
    }
    case "run": {
      const { getRun } = await Y();
      const r = await getRun(Number(rest[0]));
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "settings": {
      const { getSyncSettings, updateSyncSettings } = await S();
      if (rest.length) {
        const patch: Record<string, unknown> = {};
        for (const kv of rest) {
          const [k, v] = kv.split("=");
          if (v == null) throw new Error(`settings key=value, got "${kv}"`);
          patch[k] = v === "true" ? true : v === "false" ? false : Number(v);
        }
        await updateSyncSettings(patch);
      }
      const s = await getSyncSettings();
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    case "ignored": {
      const { listIgnored, clearIgnored } = await Y();
      if (args.clear) {
        // parseArgs treats the token after --clear as its value, so accept both
        // `ignored --clear plaid txn_1` and `ignored plaid txn_1 --clear`.
        const [source, externalId] = typeof args.clear === "string" ? [args.clear, rest[0]] : rest;
        if (!source || !externalId) throw new Error("ignored --clear <source> <externalId>");
        console.log((await clearIgnored(source, externalId)) ? "cleared — the next run may re-insert it" : "no such tombstone");
      }
      table((await listIgnored()).map((r) => ({ source: r.source, externalId: r.externalId, deleted: fmtDate(r.createdAt) })));
      break;
    }
    case "probe": {
      const { db } = await import("@/server/db");
      const { syncEnrollments } = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      const { getProvider } = await import("@/server/lib/sync/provider");
      const { decryptToken } = await import("@/server/lib/sync/crypto");
      const rows = await db
        .select()
        .from(syncEnrollments)
        .where(args.enrollment ? eq(syncEnrollments.id, Number(str(args.enrollment))) : undefined);
      for (const e of rows) {
        const provider = await getProvider(e.provider);
        const token = decryptToken(e.accessTokenEnc);
        console.log(`#${e.id} ${e.institutionName ?? e.enrollmentId} (${e.status})`);
        const accounts = await provider.listAccounts(token);
        for (const a of accounts) {
          const b = await provider.getBalances(token, a.externalId);
          console.log(`  ${a.externalId} ${a.name} ${a.type}/${a.subtype} ····${a.lastFour} ${a.status}  ledger=${b.ledger ?? "?"} available=${b.available ?? "?"}`);
        }
      }
      break;
    }
    case "check": {
      const { hasTokenKey } = await import("@/server/lib/sync/crypto");
      const { registeredProviderIds, getProvider } = await import("@/server/lib/sync/provider");
      const ids = registeredProviderIds();
      console.log(`registered providers: ${ids.length ? ids.join(", ") : "(none — see src/server/lib/sync/provider.ts)"}`);
      console.log(`SYNC_TOKEN_ENCRYPTION_KEY: ${hasTokenKey() ? "ok" : "MISSING / not 32-byte hex"}`);
      console.log(`SYNC_SCHEDULER: ${process.env.SYNC_SCHEDULER ?? "(unset)"}`);
      console.log(`SYNC_CRON_SECRET: ${process.env.SYNC_CRON_SECRET ? "set" : "not set (/api/sync/run needs a session)"}`);
      const { listEnrollmentsWithAccounts } = await Y();
      const { decryptToken } = await import("@/server/lib/sync/crypto");
      const { db } = await import("@/server/db");
      const { syncEnrollments } = await import("@/server/db/schema");
      const enr = await listEnrollmentsWithAccounts();
      const full = await db.select().from(syncEnrollments);
      for (const e of enr) {
        const row = full.find((f) => f.id === e.id)!;
        try {
          const token = decryptToken(row.accessTokenEnc);
          const p = await getProvider(e.provider);
          const accounts = await p.listAccounts(token);
          console.log(`  #${e.id} ${e.institutionName}: token ok, ${accounts.length} accounts at provider`);
        } catch (err) {
          console.log(`  #${e.id} ${e.institutionName}: FAIL ${(err as Error).message}`);
        }
      }
      break;
    }
    default:
      throw new Error(`unknown command "${cmd}" — try: npm run sync -- help`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  });

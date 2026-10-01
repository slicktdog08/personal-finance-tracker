import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  accountBalances,
  accounts,
  categoryMappings,
  periods,
  syncAccounts,
  syncEnrollments,
  syncIgnored,
  syncRuns,
  transactions,
  type SyncAccount,
  type SyncEnrollment,
} from "@/server/db/schema";
import { categorize, type CategoryRule } from "@/server/lib/categorize";
import { dateToYearMonth } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { LOCAL_SOURCES } from "@/constants/sync";
import { decryptToken, encryptToken } from "./crypto";
import { getProvider, SyncProviderError, type ProviderAccount, type ProviderTransaction, type SyncProvider } from "./provider";
import {
  addDaysIso,
  defaultSyncFrom,
  queryRange,
  reconcile,
  snapshotOf,
  type ExistingOtherRow,
  type ExistingSyncedRow,
  type ReconcilePlan,
  type SeenSnapshot,
} from "./reconcile";
import { acquireRunLock, getSyncSettings, releaseRunLock } from "./settings";

// The sync writer — the ONE place that calls a SyncProvider (bank-sync.md D11). Everything
// here is provider-agnostic: rows carry `source = provider.id` and the provider's
// `externalId`, and the dedup hash is derived from those (D3) so pending → posted changes
// never collide with the UNIQUE index.

export type SyncTrigger = "scheduled" | "webhook" | "manual" | "cli";

export interface AccountRunDetail {
  syncAccountId: number;
  externalAccountId: string;
  name: string | null;
  accountId: number | null;
  range: { startDate: string; endDate: string } | null;
  fetched: number;
  inserted: number;
  updated: number;
  promoted: number;
  expired: number;
  softDupes: { date: string; amount: number; direction: string; description: string; existingId: number; existingDescription: string }[];
  balance: { recorded: boolean; value: number | null; field: "available" | "ledger" | null } | null;
  error: string | null;
  skipped: string | null;
}

export interface EnrollmentRunDetail {
  enrollmentId: number;
  provider: string;
  institution: string | null;
  status: "ok" | "error" | "skipped";
  error: string | null;
  accounts: AccountRunDetail[];
}

export interface SyncRunSummary {
  runId: number | null;
  status: "ok" | "partial" | "failed" | "locked";
  dryRun: boolean;
  inserted: number;
  updated: number;
  promoted: number;
  expired: number;
  skippedDupes: number;
  balancesRecorded: number;
  enrollments: EnrollmentRunDetail[];
  error: string | null;
}

export interface RunOptions {
  trigger: SyncTrigger;
  // Limit to one enrollment (webhooks are per-enrollment).
  enrollmentDbId?: number;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export function syncedDedupHash(provider: string, externalId: string): string {
  return createHash("sha256").update(`${provider}|${externalId}`).digest("hex");
}

// transactions.raw for synced rows: the provider's object plus the normalized snapshot the
// reconciler diffs against (D12). Older rows may hold the bare provider object.
export interface SyncedRaw {
  provider: unknown;
  seen: SeenSnapshot;
}
export function packRaw(t: ProviderTransaction): SyncedRaw {
  return { provider: t.raw, seen: snapshotOf(t) };
}
export function seenFromRaw(raw: unknown): SeenSnapshot | null {
  if (raw && typeof raw === "object" && "seen" in raw) {
    const seen = (raw as { seen?: Partial<SeenSnapshot> }).seen;
    if (seen && typeof seen.txnDate === "string" && typeof seen.amount === "number") return seen as SeenSnapshot;
  }
  return null;
}

const CASH_TYPES = new Set(["Checking", "Savings", "Cash"]);
const RUNS_TO_KEEP = 200;

// ---------------------------------------------------------------------------
// Enrollment lifecycle
// ---------------------------------------------------------------------------

export interface NewEnrollment {
  provider: string;
  accessToken: string;
  enrollmentId: string;
  institutionId?: string | null;
  institutionName?: string | null;
  providerUserId?: string | null;
}

// Called from Connect's onSuccess (or the CLI). Stores the token encrypted, pulls the
// account list, and pre-maps each external account to a local one by institution +
// last-four so the user only has to confirm. Re-running for an existing enrollment (a repair)
// refreshes the token and account list without touching mappings.
export async function completeEnrollment(input: NewEnrollment): Promise<{ enrollmentDbId: number; accounts: SyncAccount[] }> {
  const provider = await getProvider(input.provider);
  const external = await provider.listAccounts(input.accessToken);
  const first = external[0];
  const values = {
    provider: input.provider,
    enrollmentId: input.enrollmentId,
    institutionId: input.institutionId ?? first?.institutionId ?? null,
    institutionName: input.institutionName ?? first?.institutionName ?? null,
    providerUserId: input.providerUserId ?? null,
    accessTokenEnc: encryptToken(input.accessToken),
    status: "active" as const,
    disconnectReason: null,
    lastError: null,
  };
  await db
    .insert(syncEnrollments)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        accessTokenEnc: values.accessTokenEnc,
        status: "active",
        disconnectReason: null,
        lastError: null,
        institutionId: values.institutionId,
        institutionName: values.institutionName,
        providerUserId: values.providerUserId,
      },
    });
  const [row] = await db
    .select()
    .from(syncEnrollments)
    .where(and(eq(syncEnrollments.provider, input.provider), eq(syncEnrollments.enrollmentId, input.enrollmentId)))
    .limit(1);
  await upsertExternalAccounts(row, external);
  const list = await db.select().from(syncAccounts).where(eq(syncAccounts.enrollmentId, row.id));
  return { enrollmentDbId: row.id, accounts: list };
}

async function upsertExternalAccounts(enrollment: SyncEnrollment, external: ProviderAccount[]): Promise<void> {
  const existing = await db.select().from(syncAccounts).where(eq(syncAccounts.enrollmentId, enrollment.id));
  const byExt = new Map(existing.map((a) => [a.externalAccountId, a]));
  const locals = await db.select().from(accounts);
  const today = todayIso();
  // Local accounts already fed by some external account (any enrollment) — never
  // auto-mapped again (uq_sync_account_local).
  const takenLocalIds = new Set(
    (await db.select({ id: syncAccounts.accountId }).from(syncAccounts)).map((r) => r.id).filter((id): id is number => id != null),
  );

  for (const a of external) {
    const cur = byExt.get(a.externalId);
    if (cur) {
      await db
        .update(syncAccounts)
        .set({
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          lastFour: a.lastFour,
          currency: a.currency,
          externalStatus: a.status,
        })
        .where(eq(syncAccounts.id, cur.id));
      continue;
    }
    // Auto-map: same last-four AND institution names that overlap (both known), and the
    // local account is not already fed by another external account. A guess is stored
    // DISABLED — the user confirms it in /settings/sync by turning it on — so a wrong match
    // never writes into the ledger.
    const inst = (a.institutionName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = locals.find((l) => {
      if (!a.lastFour || l.accountNumber !== a.lastFour || takenLocalIds.has(l.id)) return false;
      const li = (l.institution ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return Boolean(li && inst && (li.includes(inst) || inst.includes(li)));
    });
    if (match) takenLocalIds.add(match.id);
    const syncFrom = match ? await defaultSyncFromFor(match.id, today) : null;
    await db.insert(syncAccounts).values({
      enrollmentId: enrollment.id,
      externalAccountId: a.externalId,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      lastFour: a.lastFour,
      currency: a.currency,
      accountId: match?.id ?? null,
      enabled: false,
      syncFrom,
      externalStatus: a.status,
    });
  }
  // Accounts the provider no longer lists are marked closed (never deleted: their
  // transactions stay).
  const seen = new Set(external.map((a) => a.externalId));
  for (const cur of existing) {
    if (!seen.has(cur.externalAccountId) && cur.externalStatus !== "closed") {
      await db.update(syncAccounts).set({ externalStatus: "closed", enabled: false }).where(eq(syncAccounts.id, cur.id));
    }
  }
}

export async function defaultSyncFromFor(accountId: number, today = todayIso()): Promise<string> {
  const [last] = await db
    .select({ d: sql<string | null>`MAX(${transactions.txnDate})` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));
  return defaultSyncFrom(last?.d ?? null, today);
}

// Map (or unmap) an external account. Mapping resets sync_from to the local account's
// default unless one is given, and clears last_synced_at so the next run backfills.
export async function mapExternalAccount(syncAccountId: number, accountId: number | null, syncFrom?: string | null): Promise<void> {
  if (accountId != null) {
    const [taken] = await db
      .select({ id: syncAccounts.id, name: syncAccounts.name })
      .from(syncAccounts)
      .where(and(eq(syncAccounts.accountId, accountId), ne(syncAccounts.id, syncAccountId)))
      .limit(1);
    if (taken) {
      throw new Error(`That account is already fed by "${taken.name ?? taken.id}". Unmap it there first — one bank account per ledger account.`);
    }
  }
  const from = accountId == null ? null : (syncFrom ?? (await defaultSyncFromFor(accountId)));
  // An explicit mapping is a confirmation: the account is switched on (unmapping switches
  // it off, since there is nothing to feed).
  await db
    .update(syncAccounts)
    .set({ accountId, syncFrom: from, lastSyncedAt: null, lastError: null, enabled: accountId != null })
    .where(eq(syncAccounts.id, syncAccountId));
}

export async function removeEnrollment(enrollmentDbId: number, opts: { revokeRemote: boolean }): Promise<void> {
  const [row] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId)).limit(1);
  if (!row) return;
  if (opts.revokeRemote) {
    const provider = await getProvider(row.provider);
    try {
      await provider.deleteEnrollment(decryptToken(row.accessTokenEnc), row.enrollmentId);
    } catch (e) {
      if (!(e instanceof SyncProviderError && e.disconnected)) throw e;
    }
  }
  // sync_accounts cascade; synced transactions keep source/external_id and stay.
  await db.delete(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId));
}

export async function markEnrollmentDisconnected(provider: string, providerEnrollmentId: string, reason: string | null): Promise<boolean> {
  const [res] = await db
    .update(syncEnrollments)
    .set({ status: "disconnected", disconnectReason: reason })
    .where(and(eq(syncEnrollments.provider, provider), eq(syncEnrollments.enrollmentId, providerEnrollmentId)));
  return (res as { affectedRows?: number }).affectedRows === 1;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runSync(opts: RunOptions): Promise<SyncRunSummary> {
  const log = opts.log ?? (() => {});
  const dryRun = opts.dryRun ?? false;
  const summary: SyncRunSummary = {
    runId: null,
    status: "ok",
    dryRun,
    inserted: 0,
    updated: 0,
    promoted: 0,
    expired: 0,
    skippedDupes: 0,
    balancesRecorded: 0,
    enrollments: [],
    error: null,
  };

  if (!(await acquireRunLock())) {
    log("another sync is running; skipped");
    return { ...summary, status: "locked" };
  }

  let runId: number | null = null;
  try {
    const settings = await getSyncSettings();
    await db.insert(syncRuns).values({ trigger: opts.trigger, enrollmentId: opts.enrollmentDbId ?? null, dryRun });
    const [r] = await db.select({ id: syncRuns.id }).from(syncRuns).orderBy(desc(syncRuns.id)).limit(1);
    runId = r.id;
    summary.runId = runId;

    const enrollmentRows = await db
      .select()
      .from(syncEnrollments)
      .where(opts.enrollmentDbId != null ? eq(syncEnrollments.id, opts.enrollmentDbId) : sql`1=1`);

    const rules = settings.autoCategorize ? await loadRules() : [];
    const periodMap = await loadPeriodMap();
    const today = todayIso();

    for (const enr of enrollmentRows) {
      const detail: EnrollmentRunDetail = {
        enrollmentId: enr.id,
        provider: enr.provider,
        institution: enr.institutionName,
        status: "ok",
        error: null,
        accounts: [],
      };
      summary.enrollments.push(detail);
      if (enr.status !== "active") {
        detail.status = "skipped";
        detail.error = `enrollment is ${enr.status}`;
        log(`${enr.institutionName ?? enr.enrollmentId}: skipped (${enr.status})`);
        continue;
      }
      try {
        const provider = await getProvider(enr.provider);
        const token = decryptToken(enr.accessTokenEnc);
        const ctx: RunContext = { provider, token, settings, rules, periodMap, today, dryRun, log };
        await syncEnrollment(enr, ctx, detail);
        if (!dryRun) {
          await db.update(syncEnrollments).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(syncEnrollments.id, enr.id));
        }
      } catch (e) {
        const err = e as Error;
        detail.status = "error";
        detail.error = err.message;
        summary.status = "partial";
        log(`${enr.institutionName ?? enr.enrollmentId}: ERROR ${err.message}`);
        if (!dryRun) {
          const set: Record<string, unknown> = { lastError: err.message };
          if (e instanceof SyncProviderError && e.disconnected) {
            set.status = "disconnected";
            set.disconnectReason = e.code;
          }
          await db.update(syncEnrollments).set(set).where(eq(syncEnrollments.id, enr.id));
        }
      }
      for (const a of detail.accounts) {
        summary.inserted += a.inserted;
        summary.updated += a.updated;
        summary.promoted += a.promoted;
        summary.expired += a.expired;
        summary.skippedDupes += a.softDupes.length;
        if (a.balance?.recorded) summary.balancesRecorded++;
      }
    }
    if (summary.enrollments.length && summary.enrollments.every((e) => e.status === "error")) summary.status = "failed";
  } catch (e) {
    summary.status = "failed";
    summary.error = (e as Error).message;
    log(`run failed: ${summary.error}`);
  } finally {
    if (runId != null) {
      await db
        .update(syncRuns)
        .set({
          status: summary.status === "locked" ? "failed" : summary.status,
          finishedAt: new Date(),
          inserted: summary.inserted,
          updated: summary.updated,
          promoted: summary.promoted,
          expired: summary.expired,
          skippedDupes: summary.skippedDupes,
          balancesRecorded: summary.balancesRecorded,
          error: summary.error,
          details: { enrollments: summary.enrollments },
        })
        .where(eq(syncRuns.id, runId));
      await pruneRuns();
    }
    await releaseRunLock(runId, opts.trigger === "scheduled");
  }
  return summary;
}

interface RunContext {
  provider: SyncProvider;
  token: string;
  settings: Awaited<ReturnType<typeof getSyncSettings>>;
  rules: CategoryRule[];
  periodMap: Map<string, number>;
  today: string;
  dryRun: boolean;
  log: (line: string) => void;
}

async function syncEnrollment(enr: SyncEnrollment, ctx: RunContext, detail: EnrollmentRunDetail): Promise<void> {
  // Refresh the account list first: catches renamed/closed accounts and newly shared ones.
  const external = await ctx.provider.listAccounts(ctx.token);
  if (!ctx.dryRun) await upsertExternalAccounts(enr, external);
  const extType = new Map(external.map((a) => [a.externalId, a.type]));

  const list = await db.select().from(syncAccounts).where(eq(syncAccounts.enrollmentId, enr.id));
  for (const sa of list) {
    const d: AccountRunDetail = {
      syncAccountId: sa.id,
      externalAccountId: sa.externalAccountId,
      name: sa.name,
      accountId: sa.accountId,
      range: null,
      fetched: 0,
      inserted: 0,
      updated: 0,
      promoted: 0,
      expired: 0,
      softDupes: [],
      balance: null,
      error: null,
      skipped: null,
    };
    detail.accounts.push(d);
    if (sa.accountId == null) {
      d.skipped = "unmapped";
      continue;
    }
    if (!sa.enabled) {
      d.skipped = "disabled";
      continue;
    }
    if (sa.externalStatus === "closed" || !extType.has(sa.externalAccountId)) {
      d.skipped = "closed at provider";
      continue;
    }
    try {
      await syncAccount(sa, sa.accountId, extType.get(sa.externalAccountId) ?? (sa.type as "depository" | "credit"), ctx, d);
      if (!ctx.dryRun) {
        await db.update(syncAccounts).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(syncAccounts.id, sa.id));
      }
    } catch (e) {
      const err = e as Error;
      d.error = err.message;
      ctx.log(`  ${sa.name ?? sa.externalAccountId}: ERROR ${err.message}`);
      if (e instanceof SyncProviderError && e.disconnected) throw e; // whole enrollment is broken
      if (!ctx.dryRun) {
        const set: Record<string, unknown> = { lastError: err.message };
        if (e instanceof SyncProviderError && e.accountClosed) {
          set.externalStatus = "closed";
          set.enabled = false;
        }
        await db.update(syncAccounts).set(set).where(eq(syncAccounts.id, sa.id));
      }
    }
  }
}

async function syncAccount(
  sa: SyncAccount,
  accountId: number,
  type: "depository" | "credit",
  ctx: RunContext,
  d: AccountRunDetail,
): Promise<void> {
  const providerId = ctx.provider.id;
  const [oldest] = await db
    .select({ d: sql<string | null>`MIN(${transactions.txnDate})` })
    .from(transactions)
    .where(and(eq(transactions.source, providerId), eq(transactions.accountId, accountId), eq(transactions.pending, true)));
  const range = queryRange({
    today: ctx.today,
    windowDays: ctx.settings.syncWindowDays,
    syncFrom: sa.syncFrom,
    lastSyncedAt: sa.lastSyncedAt,
    oldestPending: oldest?.d ?? null,
  });
  d.range = range;

  const fetched = await ctx.provider.listTransactions(ctx.token, { externalId: sa.externalAccountId, type }, range);
  d.fetched = fetched.length;

  // Synced rows to reconcile against: anything with a fetched external id (regardless of
  // account, in case the mapping moved) plus every pending row on this account.
  const fetchedIds = fetched.map((t) => t.externalId);
  const syncedRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.source, providerId),
        or(
          fetchedIds.length ? inArray(transactions.externalId, fetchedIds) : sql`0=1`,
          and(eq(transactions.accountId, accountId), eq(transactions.pending, true)),
        ),
      ),
    );
  const existingSynced: ExistingSyncedRow[] = syncedRows.map((r) => ({
    id: r.id,
    externalId: r.externalId!,
    txnDate: r.txnDate,
    description: r.description,
    amount: Number(r.amount),
    direction: r.direction as "Debit" | "Credit",
    status: r.pending ? "pending" : "posted",
    category: r.category,
    categoryRuleId: r.categoryRuleId,
    notes: r.notes,
    billId: r.billId,
    billInstanceId: r.billInstanceId,
    lastSeen: seenFromRaw(r.raw),
  }));

  const softDays = 2;
  // Settled rows from other sources inside the window (soft duplicates), plus every
  // hand-entered PENDING row on the account — those are placeholders the fetched rows settle.
  const otherRows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      direction: transactions.direction,
      description: transactions.description,
      pending: transactions.pending,
      source: transactions.source,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        ne(transactions.source, providerId),
        or(
          and(
            gte(transactions.txnDate, addDaysIso(range.startDate, -softDays)),
            lte(transactions.txnDate, addDaysIso(range.endDate, softDays)),
          ),
          and(eq(transactions.pending, true), inArray(transactions.source, [...LOCAL_SOURCES])),
        ),
      ),
    );
  const existingOther: ExistingOtherRow[] = otherRows.map((r) => ({
    id: r.id,
    txnDate: r.txnDate,
    amount: Number(r.amount),
    direction: r.direction as "Debit" | "Credit",
    description: r.description,
    status: r.pending && LOCAL_SOURCES.includes(r.source ?? "") ? "pending" : "posted",
  }));

  const plan = reconcile(fetched, existingSynced, existingOther, {
    today: ctx.today,
    pendingExpiryDays: ctx.settings.pendingExpiryDays,
    softMatchDays: softDays,
  });
  const settles = plan.softDupes.filter((s) => s.finalizesPending);
  d.softDupes = plan.softDupes
    .filter((s) => !s.finalizesPending)
    .map((s) => ({
      date: s.fetched.txnDate,
      amount: s.fetched.amount,
      direction: s.fetched.direction,
      description: s.fetched.description,
      existingId: s.existingId,
      existingDescription: s.existingDescription,
    }));
  d.inserted = plan.inserts.length;
  d.updated = plan.updates.length;
  d.promoted = plan.updates.filter((u) => u.promoted).length + settles.length;
  d.expired = plan.expirations.length;
  ctx.log(
    `  ${sa.name ?? sa.externalAccountId} [${range.startDate}..${range.endDate}]: fetched ${fetched.length}, +${d.inserted} new, ~${d.updated} changed (${d.promoted} posted), -${d.expired} expired, ${d.softDupes.length} soft-dupes` +
      (ctx.dryRun ? " (dry run)" : ""),
  );

  if (!ctx.dryRun) {
    d.inserted = await applyPlan(plan, providerId, accountId, ctx);
    // Hand-entered pending placeholders become the synced row: the bank's id, date,
    // description and status take over; category, notes and bill link stay.
    for (const s of settles) {
      const t = s.fetched;
      await db
        .update(transactions)
        .set({
          source: providerId,
          externalId: t.externalId,
          dedupHash: syncedDedupHash(providerId, t.externalId),
          pending: t.status === "pending",
          txnDate: t.txnDate,
          // Same lazy rule as inserts: null when the month has no sheet yet, adopted by
          // ensurePeriod when it is created.
          periodId: periodIdFor(t.txnDate, ctx.periodMap),
          description: t.description.slice(0, 512),
          amount: t.amount.toFixed(2),
          direction: t.direction,
          raw: packRaw(t),
        })
        .where(and(eq(transactions.id, s.existingId), eq(transactions.pending, true)));
    }
  }

  if (ctx.settings.recordBalances && sa.syncBalances) {
    d.balance = await recordBalance(sa, accountId, ctx);
  }
}

// Returns how many rows were actually inserted (tombstoned ids are skipped).
async function applyPlan(plan: ReconcilePlan, providerId: string, accountId: number, ctx: RunContext): Promise<number> {
  // Inserts — minus rows the user deleted by hand (tombstoned by deleteTransaction).
  let inserts = plan.inserts;
  if (inserts.length) {
    const ignored = await db
      .select({ externalId: syncIgnored.externalId })
      .from(syncIgnored)
      .where(and(eq(syncIgnored.source, providerId), inArray(syncIgnored.externalId, inserts.map((t) => t.externalId))));
    if (ignored.length) {
      const skip = new Set(ignored.map((r) => r.externalId));
      inserts = inserts.filter((t) => !skip.has(t.externalId));
    }
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    await db
      .insert(transactions)
      .values(
        chunk.map((t) => {
          const cat = ctx.rules.length ? categorize({ description: t.description, rawCategory: t.rawCategory }, ctx.rules) : null;
          return {
            accountId,
            periodId: periodIdFor(t.txnDate, ctx.periodMap),
            txnDate: t.txnDate,
            description: t.description.slice(0, 512),
            category: cat?.matchedRuleId != null ? cat.category : null,
            categoryRuleId: cat?.matchedRuleId ?? null,
            billId: cat?.matchedRuleId != null && t.status === "posted" ? cat.billId : null,
            amount: t.amount.toFixed(2),
            netAmount: null,
            direction: t.direction,
            dedupHash: syncedDedupHash(providerId, t.externalId),
            source: providerId,
            externalId: t.externalId,
            pending: t.status === "pending",
            raw: packRaw(t),
          };
        }),
      )
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }

  // Updates (content changes / promotion)
  for (const u of plan.updates) {
    const set: Record<string, unknown> = {};
    if (u.changes.txnDate) {
      set.txnDate = u.changes.txnDate;
      set.periodId = periodIdFor(u.changes.txnDate, ctx.periodMap);
    }
    if (u.changes.description) set.description = u.changes.description.slice(0, 512);
    if (u.changes.amount != null) set.amount = u.changes.amount.toFixed(2);
    if (u.changes.direction) set.direction = u.changes.direction;
    // `u.changes.status` is the PROVIDER's vocabulary; the column it lands in is the flag.
    if (u.changes.status) set.pending = u.changes.status === "pending";
    set.raw = packRaw(u.fetched);
    if ((u.redoCategory || u.promoted) && ctx.rules.length) {
      const cat = categorize({ description: u.fetched.description, rawCategory: u.fetched.rawCategory }, ctx.rules);
      if (cat.matchedRuleId != null) {
        if (u.redoCategory) {
          set.category = cat.category;
          set.categoryRuleId = cat.matchedRuleId;
        }
        // Bill attribution waits for posting (D2); attach it now if the rule names one and
        // nothing was linked by hand meanwhile.
        if (u.promoted && cat.billId != null && u.existingBillId == null) set.billId = cat.billId;
      }
    }
    await db.update(transactions).set(set).where(eq(transactions.id, u.id));
  }

  // Expirations: carry edits, then delete.
  if (plan.expirations.length) {
    const insertedIds = new Map<string, number>();
    const carryExt = plan.expirations.flatMap((e) => (e.carryTo?.kind === "insert" ? [e.carryTo.externalId] : []));
    if (carryExt.length) {
      const rows = await db
        .select({ id: transactions.id, externalId: transactions.externalId })
        .from(transactions)
        .where(and(eq(transactions.source, providerId), inArray(transactions.externalId, carryExt)));
      for (const r of rows) if (r.externalId) insertedIds.set(r.externalId, r.id);
    }
    for (const e of plan.expirations) {
      const targetId = e.carryTo?.kind === "existing" ? e.carryTo.id : e.carryTo?.kind === "insert" ? insertedIds.get(e.carryTo.externalId) : undefined;
      if (targetId != null) {
        const set: Record<string, unknown> = {};
        if (e.edits.notes) set.notes = e.edits.notes;
        if (e.edits.billId != null) set.billId = e.edits.billId;
        if (e.edits.billInstanceId != null) set.billInstanceId = e.edits.billInstanceId;
        if (e.edits.category != null) {
          set.category = e.edits.category;
          set.categoryRuleId = null; // it was hand-set (hasUserEdits) — keep it hand-set
        }
        if (Object.keys(set).length) await db.update(transactions).set(set).where(eq(transactions.id, targetId));
      }
      // transfer_partner_id is a RESTRICT self-reference: unlink the partner first.
      await db.update(transactions).set({ transferPartnerId: null }).where(eq(transactions.transferPartnerId, e.id));
      await db.delete(transactions).where(eq(transactions.id, e.id));
    }
  }
  return inserts.length;
}

async function recordBalance(sa: SyncAccount, accountId: number, ctx: RunContext): Promise<AccountRunDetail["balance"]> {
  const [local] = await db.select({ type: accounts.accountType }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  const b = await ctx.provider.getBalances(ctx.token, sa.externalAccountId);
  const isCash = CASH_TYPES.has(local?.type ?? "");
  // D7: cash → available (what can actually be spent); credit/loan → ledger (amount owed).
  const field: "available" | "ledger" = isCash ? (b.available != null ? "available" : "ledger") : b.ledger != null ? "ledger" : "available";
  const value = b[field];
  if (value == null) return { recorded: false, value: null, field: null };
  if (ctx.dryRun) return { recorded: false, value, field };

  const note = `Synced from ${ctx.provider.id} (${field})`;
  const [existing] = await db
    .select({ id: accountBalances.id, note: accountBalances.note })
    .from(accountBalances)
    .where(and(eq(accountBalances.accountId, accountId), eq(accountBalances.asOf, ctx.today)))
    .limit(1);
  if (existing) {
    // Same-day snapshot: refresh the figure, keep APR/min-payment/limit that may have been
    // entered by hand. Only overwrite the note if it was ours.
    await db
      .update(accountBalances)
      .set({ balance: value.toFixed(2), ...(existing.note?.startsWith("Synced from") ? { note } : {}) })
      .where(eq(accountBalances.id, existing.id));
  } else {
    await db.insert(accountBalances).values({ accountId, balance: value.toFixed(2), asOf: ctx.today, note });
  }
  return { recorded: true, value, field };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function loadRules(): Promise<CategoryRule[]> {
  const rows = await db.select().from(categoryMappings);
  return rows.map((r) => ({
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    category: r.category,
    billId: r.billId,
    priority: r.priority,
  }));
}

async function loadPeriodMap(): Promise<Map<string, number>> {
  const rows = await db.select({ id: periods.id, year: periods.year, month: periods.month }).from(periods);
  return new Map(rows.map((p) => [`${p.year}-${p.month}`, p.id]));
}

// Same rule as commitImport: a month with no period row yet gets null and is adopted when
// the month is created (ensurePeriod → adoptOrphanTransactions).
function periodIdFor(iso: string, periodMap: Map<string, number>): number | null {
  const ym = dateToYearMonth(iso);
  return ym ? (periodMap.get(`${ym.year}-${ym.month}`) ?? null) : null;
}

async function pruneRuns(): Promise<void> {
  const keep = await db.select({ id: syncRuns.id }).from(syncRuns).orderBy(desc(syncRuns.id)).limit(RUNS_TO_KEEP);
  if (keep.length < RUNS_TO_KEEP) return;
  const minId = keep[keep.length - 1].id;
  await db.delete(syncRuns).where(sql`${syncRuns.id} < ${minId}`);
}

// Small read helpers shared by the settings page, MCP and CLI — all DB-only (D11).
export async function listEnrollmentsWithAccounts() {
  const enr = await db.select().from(syncEnrollments).orderBy(syncEnrollments.id);
  const acc = await db.select().from(syncAccounts).orderBy(syncAccounts.id);
  return enr.map((e) => ({
    ...e,
    accessTokenEnc: undefined,
    accounts: acc.filter((a) => a.enrollmentId === e.id),
  }));
}

export async function listRecentRuns(limit = 20) {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(limit);
}

export async function getRun(id: number) {
  const [r] = await db.select().from(syncRuns).where(eq(syncRuns.id, id)).limit(1);
  return r ?? null;
}

export async function pendingSummary() {
  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      debits: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Debit' THEN ${transactions.amount} ELSE 0 END), 0)`,
      credits: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Credit' THEN ${transactions.amount} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.pending, true));
  return { count: Number(row?.count ?? 0), debits: Number(row?.debits ?? 0), credits: Number(row?.credits ?? 0) };
}

// Tombstone management (CLI). Clearing one lets the next run re-insert the row.
export async function listIgnored() {
  return db.select().from(syncIgnored).orderBy(desc(syncIgnored.id));
}

export async function clearIgnored(source: string, externalId: string): Promise<boolean> {
  const [res] = await db.delete(syncIgnored).where(and(eq(syncIgnored.source, source), eq(syncIgnored.externalId, externalId)));
  return (res as { affectedRows?: number }).affectedRows === 1;
}

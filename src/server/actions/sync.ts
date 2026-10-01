"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { syncAccounts, syncEnrollments } from "@/server/db/schema";
import { requireSession } from "@/server/auth/session";
import { hasTokenKey } from "@/server/lib/sync/crypto";
import { isKnownProvider, registeredProviderIds } from "@/server/lib/sync/provider";
import {
  getSyncSettings,
  updateSyncSettings,
  validateSettingsPatch,
  type SyncSettingsPatch,
} from "@/server/lib/sync/settings";
import {
  completeEnrollment,
  defaultSyncFromFor,
  mapExternalAccount,
  removeEnrollment,
  runSync,
  type SyncRunSummary,
} from "@/server/lib/sync/sync";

type Result<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

// Pages that show synced data. Called after any run and after mapping changes.
function revalidateSynced() {
  for (const p of ["/settings/sync", "/transactions", "/accounts", "/debts", "/dashboard", "/budget", "/cash"]) {
    revalidatePath(p);
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function saveSyncSettings(patch: SyncSettingsPatch): Promise<Result> {
  await requireSession();
  const err = validateSettingsPatch(patch);
  if (err) return { ok: false, error: err };
  try {
    await updateSyncSettings(patch);
    revalidatePath("/settings/sync");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

// What the settings page needs to know before offering to link a bank. With no provider
// registered (see lib/sync/provider.ts) linking is off and the page says why; the rest of
// the engine — mapping, runs, history — keeps working for anything already stored.
export interface ConnectConfig {
  providers: string[];
  ready: boolean;
  problems: string[];
}

export async function getConnectConfig(): Promise<ConnectConfig> {
  await requireSession();
  const providers = registeredProviderIds();
  const problems: string[] = [];
  if (!providers.length) problems.push("No bank provider is wired up yet (Teller shut down in July 2026). The sync engine is ready for the next one.");
  if (!hasTokenKey()) problems.push("SYNC_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes of hex.");
  return { providers, ready: problems.length === 0, problems };
}

export interface ConnectSuccess {
  provider: string;
  accessToken: string;
  enrollmentId: string;
  institutionName?: string | null;
  userId?: string | null;
}

// A provider's link-flow result (access token + enrollment id) → stored enrollment + account
// list (pre-mapped, disabled until confirmed).
export async function finishEnrollment(input: ConnectSuccess): Promise<Result<{ enrollmentDbId: number; mapped: number; unmapped: number }>> {
  await requireSession();
  if (!isKnownProvider(input.provider)) return { ok: false, error: "Unknown provider." };
  if (!input.accessToken?.trim() || !input.enrollmentId?.trim()) return { ok: false, error: "Missing token or enrollment id." };
  try {
    const { enrollmentDbId, accounts } = await completeEnrollment({
      provider: input.provider,
      accessToken: input.accessToken.trim(),
      enrollmentId: input.enrollmentId.trim(),
      institutionName: input.institutionName ?? null,
      providerUserId: input.userId ?? null,
    });
    revalidateSynced();
    return {
      ok: true,
      value: {
        enrollmentDbId,
        mapped: accounts.filter((a) => a.accountId != null).length,
        unmapped: accounts.filter((a) => a.accountId == null).length,
      },
    };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function setAccountMapping(syncAccountId: number, accountId: number | null, syncFrom?: string | null): Promise<Result> {
  await requireSession();
  if (syncFrom && !/^\d{4}-\d{2}-\d{2}$/.test(syncFrom)) return { ok: false, error: "Sync-from must be YYYY-MM-DD." };
  try {
    await mapExternalAccount(syncAccountId, accountId, syncFrom);
    revalidateSynced();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function updateSyncAccount(
  syncAccountId: number,
  patch: { enabled?: boolean; syncBalances?: boolean; syncFrom?: string | null },
): Promise<Result> {
  await requireSession();
  if (patch.syncFrom && !/^\d{4}-\d{2}-\d{2}$/.test(patch.syncFrom)) return { ok: false, error: "Sync-from must be YYYY-MM-DD." };
  const set: Record<string, unknown> = {};
  if (patch.enabled != null) set.enabled = patch.enabled;
  if (patch.syncBalances != null) set.syncBalances = patch.syncBalances;
  if ("syncFrom" in patch) {
    set.syncFrom = patch.syncFrom ?? null;
    // Moving the start date back should re-backfill from there.
    set.lastSyncedAt = null;
  }
  if (!Object.keys(set).length) return { ok: true };
  await db.update(syncAccounts).set(set).where(eq(syncAccounts.id, syncAccountId));
  revalidatePath("/settings/sync");
  return { ok: true };
}

export async function suggestSyncFrom(accountId: number): Promise<string> {
  await requireSession();
  return defaultSyncFromFor(accountId);
}

export async function setEnrollmentPaused(enrollmentDbId: number, paused: boolean): Promise<Result> {
  await requireSession();
  const [row] = await db.select({ status: syncEnrollments.status }).from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId)).limit(1);
  if (!row) return { ok: false, error: "Enrollment not found." };
  if (paused && row.status === "disconnected") return { ok: false, error: "Reconnect it first — a disconnected enrollment can't be paused." };
  await db
    .update(syncEnrollments)
    .set({ status: paused ? "paused" : "active", ...(paused ? {} : { lastError: null }) })
    .where(and(eq(syncEnrollments.id, enrollmentDbId)));
  revalidatePath("/settings/sync");
  return { ok: true };
}

// Remove = forget the enrollment here and (by default) revoke it at the provider. Synced
// transactions are kept.
export async function deleteEnrollment(enrollmentDbId: number, revokeRemote = true): Promise<Result> {
  await requireSession();
  try {
    await removeEnrollment(enrollmentDbId, { revokeRemote });
    revalidateSynced();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function syncNow(opts: { enrollmentDbId?: number; dryRun?: boolean } = {}): Promise<Result<SyncRunSummary>> {
  await requireSession();
  try {
    const summary = await runSync({ trigger: "manual", enrollmentDbId: opts.enrollmentDbId, dryRun: opts.dryRun });
    if (!opts.dryRun) revalidateSynced();
    else revalidatePath("/settings/sync");
    if (summary.status === "locked") return { ok: false, error: "A sync is already running. Try again in a minute." };
    return { ok: true, value: summary };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function getSyncSettingsAction() {
  await requireSession();
  return getSyncSettings();
}

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { syncAccounts, syncEnrollments } from "@/server/db/schema";
import { requireSession } from "@/server/auth/session";
import { hasTokenKey } from "@/server/lib/sync/crypto";
import { getProvider, isKnownProvider, registeredProviderIds } from "@/server/lib/sync/provider";
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
  // SIMPLE_FIN_SETUP_TOKEN is set, so linking can use it without pasting anything.
  simplefinEnvToken: boolean;
  // Plaid needs its own keys; null when PLAID_API_CLIENT_ID / PLAID_API_SECRET aren't set.
  plaid: { env: string } | null;
}

export async function getConnectConfig(): Promise<ConnectConfig> {
  await requireSession();
  const providers = registeredProviderIds();
  const problems: string[] = [];
  if (!providers.length) problems.push("No bank provider is registered (see src/server/lib/sync/provider.ts).");
  if (!hasTokenKey()) problems.push("SYNC_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes of hex.");
  const { plaidConfigured, plaidEnv } = await import("@/server/lib/plaid");
  let plaid: ConnectConfig["plaid"] = null;
  if (plaidConfigured()) {
    try {
      plaid = { env: plaidEnv() };
    } catch (e) {
      problems.push(message(e)); // bad PLAID_ENV
    }
  }
  return {
    providers,
    ready: problems.length === 0,
    problems,
    simplefinEnvToken: Boolean(process.env.SIMPLE_FIN_SETUP_TOKEN?.trim()),
    plaid,
  };
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

// SimpleFIN link flow: the user pastes a Setup Token from SimpleFIN Bridge (or, to recover, the
// Access URL it was exchanged for); with nothing pasted, SIMPLE_FIN_SETUP_TOKEN is used. The token is single-use, so everything that could fail
// for local reasons is checked BEFORE it is claimed, and if storing fails after the claim the
// Access URL is handed back so it can be pasted instead of burning another token.
// `reconnectEnrollmentDbId` swaps the credentials of an existing SimpleFIN enrollment
// (revoked access, rotated token) and keeps its mappings.
export async function linkSimplefin(input: {
  token: string;
  reconnectEnrollmentDbId?: number;
}): Promise<Result<{ enrollmentDbId: number; mapped: number; unmapped: number }>> {
  await requireSession();
  const token = input.token?.trim() || process.env.SIMPLE_FIN_SETUP_TOKEN?.trim() || "";
  if (!token) return { ok: false, error: "Paste the Setup Token from SimpleFIN Bridge (or set SIMPLE_FIN_SETUP_TOKEN)." };
  if (!hasTokenKey()) return { ok: false, error: "SYNC_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes of hex — set it before linking." };
  const { claimSetupToken, parseAccessUrl, simplefinEnrollmentId } = await import("@/server/lib/simplefin");

  let enrollmentId: string | null = null;
  if (input.reconnectEnrollmentDbId != null) {
    const [row] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, input.reconnectEnrollmentDbId)).limit(1);
    if (!row || row.provider !== "simplefin") return { ok: false, error: "That SimpleFIN connection no longer exists." };
    enrollmentId = row.enrollmentId;
  }

  let accessUrl: string;
  try {
    if (/^https?:\/\//i.test(token)) {
      parseAccessUrl(token);
      accessUrl = token;
    } else {
      accessUrl = await claimSetupToken(token);
    }
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  const claimed = accessUrl !== token;
  const recover = (why: string) =>
    claimed
      ? `${why} The Setup Token has been used up; to retry without a new one, paste this Access URL instead: ${accessUrl}`
      : why;

  try {
    // Accounts already fed by a different SimpleFIN enrollment mean this is the same
    // Bridge login again — that has to go through Reconnect on the existing entry.
    if (enrollmentId == null) {
      enrollmentId = simplefinEnrollmentId(accessUrl);
      const provider = await getProvider("simplefin");
      const ids = (await provider.listAccounts(accessUrl)).map((a) => a.externalId);
      if (ids.length) {
        const [clash] = await db
          .select({ enrollmentId: syncEnrollments.enrollmentId, name: syncEnrollments.institutionName })
          .from(syncAccounts)
          .innerJoin(syncEnrollments, eq(syncAccounts.enrollmentId, syncEnrollments.id))
          .where(inArray(syncAccounts.externalAccountId, ids))
          .limit(1);
        if (clash && clash.enrollmentId !== enrollmentId) {
          return { ok: false, error: recover(`These accounts already come in through "${clash.name ?? clash.enrollmentId}". Use Reconnect on that entry instead.`) };
        }
      }
    }
    const { enrollmentDbId, accounts } = await completeEnrollment({
      provider: "simplefin",
      accessToken: accessUrl,
      enrollmentId,
      institutionName: "SimpleFIN Bridge",
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
    return { ok: false, error: recover(message(e)) };
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

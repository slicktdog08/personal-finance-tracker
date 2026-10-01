import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { syncSettings, type SyncSettings } from "@/server/db/schema";
import { validateSettingsPatch, type SyncSettingsPatch } from "./validate";

export { validateSettingsPatch, type SyncSettingsPatch };

// The sync_settings singleton (id = 1). Created by the migration; `getSyncSettings` also
// self-heals if the row is ever missing.

export const SYNC_SETTINGS_ID = 1;
export const RUN_LOCK_MINUTES = 10;

export async function getSyncSettings(): Promise<SyncSettings> {
  const rows = await db.select().from(syncSettings).where(eq(syncSettings.id, SYNC_SETTINGS_ID)).limit(1);
  if (rows.length) return rows[0];
  await db.insert(syncSettings).values({ id: SYNC_SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const again = await db.select().from(syncSettings).where(eq(syncSettings.id, SYNC_SETTINGS_ID)).limit(1);
  return again[0];
}


// Enabling schedules a run right away; a new interval re-anchors the next run so the change
// takes effect immediately (otherwise a 24h → 1h change would wait out the old 24h).
export async function updateSyncSettings(patch: SyncSettingsPatch): Promise<SyncSettings> {
  const err = validateSettingsPatch(patch);
  if (err) throw new Error(err);
  await getSyncSettings();
  const set: Record<string, unknown> = { ...patch };
  const cur = await getSyncSettings();
  if (patch.enabled === true && !cur.enabled) {
    // Turning it on means "start now", not "start one interval from now".
    set.nextRunAt = new Date();
  } else if (patch.intervalMinutes != null && patch.intervalMinutes !== cur.intervalMinutes) {
    set.nextRunAt = new Date(Date.now() + patch.intervalMinutes * 60_000);
  }
  await db.update(syncSettings).set(set).where(eq(syncSettings.id, SYNC_SETTINGS_ID));
  return getSyncSettings();
}

// Run mutex. Conditional UPDATE so two callers can't both win; returns false when a run
// is already in progress (and its lock hasn't expired).
export async function acquireRunLock(): Promise<boolean> {
  await getSyncSettings();
  const until = new Date(Date.now() + RUN_LOCK_MINUTES * 60_000);
  const [res] = await db
    .update(syncSettings)
    .set({ lockUntil: until })
    .where(
      and(
        eq(syncSettings.id, SYNC_SETTINGS_ID),
        or(isNull(syncSettings.lockUntil), lt(syncSettings.lockUntil, new Date())),
      ),
    );
  return (res as { affectedRows?: number }).affectedRows === 1;
}

export async function releaseRunLock(lastRunId: number | null, scheduleNext: boolean): Promise<void> {
  const set: Record<string, unknown> = { lockUntil: null };
  if (lastRunId != null) set.lastRunId = lastRunId;
  if (scheduleNext) {
    const cur = await getSyncSettings();
    set.nextRunAt = new Date(Date.now() + cur.intervalMinutes * 60_000);
  }
  await db.update(syncSettings).set(set).where(eq(syncSettings.id, SYNC_SETTINGS_ID));
}

export async function stampWebhook(): Promise<void> {
  await db.update(syncSettings).set({ lastWebhookAt: new Date() }).where(eq(syncSettings.id, SYNC_SETTINGS_ID));
}

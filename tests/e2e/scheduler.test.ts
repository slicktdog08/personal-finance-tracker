import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { syncRuns, syncSettings } from "@/server/db/schema";
import { getSyncSettings, updateSyncSettings } from "@/server/lib/sync/settings";
import { completeEnrollment } from "@/server/lib/sync/sync";
import { startSyncScheduler, stopSyncScheduler, tick } from "@/server/sync/scheduler";
import { acct, closePool, FAKE, fake, setupFixtures, teardownFixtures, type Fixtures } from "./helpers";
import { enableAllFakeAccounts } from "./helpers";

let f: Fixtures;

before(async () => {
  f = await setupFixtures();
  fake.accounts = [acct({ externalId: "acc_chk", lastFour: "1111", type: "depository" })];
  fake.txns.set("acc_chk", []);
  await completeEnrollment({ provider: FAKE, accessToken: "tok", enrollmentId: "enr_e2e" });
  await enableAllFakeAccounts();
});
after(async () => {
  stopSyncScheduler();
  await teardownFixtures(f);
  await closePool();
});

describe("scheduler tick", () => {
  test("disabled → no run", async () => {
    await updateSyncSettings({ enabled: false });
    assert.equal(await tick(), "disabled");
  });

  test("enabling schedules a run right away", async () => {
    await updateSyncSettings({ enabled: true, intervalMinutes: 60 });
    const s = await getSyncSettings();
    assert.ok(s.nextRunAt && s.nextRunAt.getTime() <= Date.now() + 1000);
  });

  test("enabled but not due → no run", async () => {
    await db.update(syncSettings).set({ nextRunAt: new Date(Date.now() + 60 * 60_000) }).where(eq(syncSettings.id, 1));
    assert.equal(await tick(), "not-due");
  });

  test("enabled and due → runs as 'scheduled' and re-arms", async () => {
    await db.update(syncSettings).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(syncSettings.id, 1));
    const before = (await db.select().from(syncRuns).where(eq(syncRuns.trigger, "scheduled"))).length;
    assert.equal(await tick(), "ran");
    assert.equal((await db.select().from(syncRuns).where(eq(syncRuns.trigger, "scheduled"))).length, before + 1);
    const s = await getSyncSettings();
    assert.ok(s.nextRunAt!.getTime() > Date.now() + 50 * 60_000);
    assert.equal(s.lockUntil, null);
  });

  test("null next_run_at counts as due (first enable)", async () => {
    await db.update(syncSettings).set({ nextRunAt: null }).where(eq(syncSettings.id, 1));
    assert.equal(await tick(), "ran");
  });

  test("start is idempotent and the timer never pins the process", () => {
    startSyncScheduler();
    startSyncScheduler();
    const g = globalThis as unknown as { __syncScheduler?: NodeJS.Timeout };
    assert.ok(g.__syncScheduler);
    stopSyncScheduler();
    assert.equal(g.__syncScheduler, undefined);
  });
});

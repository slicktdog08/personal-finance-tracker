import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { syncEnrollments, syncRuns } from "@/server/db/schema";
import { getSyncSettings, updateSyncSettings } from "@/server/lib/sync/settings";
import { completeEnrollment } from "@/server/lib/sync/sync";
import { handleWebhook } from "@/server/lib/sync/webhook";
import { acct, closePool, FAKE, fake, fakeRows, setupFixtures, teardownFixtures, TODAY, txn, type Fixtures } from "./helpers";
import { enableAllFakeAccounts } from "./helpers";

let f: Fixtures;
let enrollmentDbId: number;
const CHK = "acc_chk";

before(async () => {
  f = await setupFixtures();
  fake.accounts = [acct({ externalId: CHK, lastFour: "1111", type: "depository" })];
  fake.txns.set(CHK, [txn({ externalId: "w1", externalAccountId: CHK, txnDate: TODAY, description: "WEBHOOK ROW", amount: 5 })]);
  enrollmentDbId = (await completeEnrollment({ provider: FAKE, accessToken: "tok", enrollmentId: "enr_e2e" })).enrollmentDbId;
  await enableAllFakeAccounts();
});
after(async () => {
  await teardownFixtures(f);
  await closePool();
});

const body = (o: unknown) => JSON.stringify(o);
const good = new Headers({ "x-e2e-sig": "ok" });
const bad = new Headers({ "x-e2e-sig": "nope" });

describe("handleWebhook", () => {
  test("unknown provider → 404, no work", async () => {
    const r = await handleWebhook("plaid", body({ type: "test" }), good);
    assert.equal(r.status, 404);
    assert.equal(r.work, null);
  });

  test("bad signature → 401 and nothing stamped", async () => {
    const before = (await getSyncSettings()).lastWebhookAt;
    const r = await handleWebhook(FAKE, body({ type: "transactions.processed", enrollmentId: "enr_e2e" }), bad);
    assert.equal(r.status, 401);
    assert.equal(r.work, null);
    assert.equal((await getSyncSettings()).lastWebhookAt?.getTime(), before?.getTime());
  });

  test("valid transactions.processed → 200, stamps last_webhook_at, work syncs that enrollment", async () => {
    const r = await handleWebhook(FAKE, body({ type: "transactions.processed", enrollmentId: "enr_e2e" }), good);
    assert.equal(r.status, 200);
    assert.ok((await getSyncSettings()).lastWebhookAt);
    assert.ok(r.work);
    await r.work!();
    const rows = await fakeRows(f.checkingId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].externalId, "w1");
    const runs = await db.select().from(syncRuns).where(eq(syncRuns.trigger, "webhook"));
    assert.ok(runs.some((x) => x.enrollmentId === enrollmentDbId));
  });

  test("unknown enrollment id in a valid event does nothing", async () => {
    const r = await handleWebhook(FAKE, body({ type: "transactions.processed", enrollmentId: "enr_other" }), good);
    assert.equal(r.status, 200);
    const before = (await db.select().from(syncRuns)).length;
    await r.work!();
    assert.equal((await db.select().from(syncRuns)).length, before);
  });

  test("enrollment.disconnected flips status with the reason", async () => {
    const r = await handleWebhook(FAKE, body({ type: "enrollment.disconnected", enrollmentId: "enr_e2e", reason: "disconnected.user_action.mfa_required" }), good);
    assert.equal(r.status, 200);
    await r.work!();
    const [row] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId));
    assert.equal(row.status, "disconnected");
    assert.equal(row.disconnectReason, "disconnected.user_action.mfa_required");
    // and a disconnected enrollment is not synced by a later transactions.processed
    const r2 = await handleWebhook(FAKE, body({ type: "transactions.processed", enrollmentId: "enr_e2e" }), good);
    const before = (await db.select().from(syncRuns)).length;
    await r2.work!();
    assert.equal((await db.select().from(syncRuns)).length, before);
    await db.update(syncEnrollments).set({ status: "active", disconnectReason: null }).where(eq(syncEnrollments.id, enrollmentDbId));
  });

  test("test and other events → 200 with no work", async () => {
    assert.equal((await handleWebhook(FAKE, body({ type: "test" }), good)).work, null);
    assert.equal((await handleWebhook(FAKE, body({ type: "something.else" }), good)).work, null);
  });

  test("webhooks disabled in settings → 200, acknowledged, no work", async () => {
    await updateSyncSettings({ webhookEnabled: false });
    const r = await handleWebhook(FAKE, body({ type: "transactions.processed", enrollmentId: "enr_e2e" }), good);
    assert.equal(r.status, 200);
    assert.equal(r.work, null);
    assert.equal(r.body.reason, "webhooks disabled");
    await updateSyncSettings({ webhookEnabled: true });
  });
});

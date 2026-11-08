import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/server/db";
import { accountBalances, accounts, syncEnrollments, transactions } from "@/server/db/schema";
import { completeEnrollment, mapExternalAccount, removeEnrollment, runSync, type SyncRunSummary } from "@/server/lib/sync/sync";
import { decryptToken } from "@/server/lib/sync/crypto";
import { clearPlaidCache, exchangePublicToken, plaidConfigured, plaidEnv, sandboxCreatePublicToken, sandboxResetLogin } from "@/server/lib/plaid";
import { closePool, daysAgo, setupFixtures, teardownFixtures, type Fixtures } from "./helpers";

// Live test against Plaid SANDBOX (fake banks, free, unlimited Items) through the real
// adapter and the real sync writer, in the TEST database. Network-bound, so opt-in:
//   PLAID_SANDBOX_E2E=1 npm run test:e2e
// Needs sandbox keys (PLAID_API_CLIENT_ID / PLAID_API_SECRET) and PLAID_ENV unset or sandbox.
const RUN = process.env.PLAID_SANDBOX_E2E === "1";

let f: Fixtures;
let enrollmentDbId: number | null = null;

before(async () => {
  if (!RUN) return;
  assert.ok(plaidConfigured(), "PLAID_API_CLIENT_ID / PLAID_API_SECRET are not set");
  assert.equal(plaidEnv(), "sandbox", "refusing to run against Plaid production");
  f = await setupFixtures();
});
after(async () => {
  if (RUN) {
    if (enrollmentDbId != null) await removeEnrollment(enrollmentDbId, { revokeRemote: true }).catch(() => {});
    const fixtureIds = (await db.select({ id: accounts.id }).from(accounts).where(like(accounts.label, "[e2e]%"))).map((a) => a.id);
    if (fixtureIds.length) {
      await db.delete(transactions).where(and(eq(transactions.source, "plaid"), inArray(transactions.accountId, fixtureIds)));
    }
    await teardownFixtures(f);
  }
  await closePool();
});

// Plaid needs a few seconds after linking before /transactions/get answers
// (PRODUCT_NOT_READY); retry the run until the accounts actually synced.
async function syncUntilReady(id: number): Promise<SyncRunSummary> {
  for (let i = 0; i < 12; i++) {
    const s = await runSync({ trigger: "cli", enrollmentDbId: id });
    const errs = s.enrollments.flatMap((e) => e.accounts.map((a) => a.error)).filter(Boolean);
    if (s.status === "ok" && !errs.length) return s;
    if (!errs.every((e) => /still pulling/.test(e!))) assert.fail(`sync failed: ${JSON.stringify(s.enrollments)}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  assert.fail("Plaid sandbox never became ready");
}

describe("Plaid sandbox (live)", { skip: !RUN && "set PLAID_SANDBOX_E2E=1 to run" }, () => {
  let accessToken = "";

  test("link + map + sync: rows land with Plaid's sign convention, balances recorded", { timeout: 120_000 }, async () => {
    const ex = await exchangePublicToken(await sandboxCreatePublicToken());
    accessToken = ex.accessToken;
    const res = await completeEnrollment({ provider: "plaid", accessToken, enrollmentId: ex.itemId });
    enrollmentDbId = res.enrollmentDbId;
    const [enr] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId)).limit(1);
    assert.equal(decryptToken(enr.accessTokenEnc), accessToken, "token stored encrypted and recoverable");
    assert.equal(enr.institutionName, "First Platypus Bank");

    const chk = res.accounts.find((a) => a.subtype === "checking")!;
    const card = res.accounts.find((a) => a.subtype === "credit card" && a.lastFour === "3333")!;
    assert.ok(chk && card, "sandbox exposes a checking account and a credit card");
    await mapExternalAccount(chk.id, f.checkingId, daysAgo(30));
    await mapExternalAccount(card.id, f.creditId, daysAgo(30));

    const s = await syncUntilReady(enrollmentDbId);
    assert.ok(s.inserted > 0, "inserted sandbox transactions");
    const rows = await db.select().from(transactions).where(and(eq(transactions.source, "plaid"), inArray(transactions.accountId, [f.checkingId, f.creditId])));
    assert.ok(rows.length === s.inserted);
    // Sandbox checking has a payroll-like deposit and card purchases.
    assert.ok(rows.some((r) => r.accountId === f.checkingId && r.direction === "Credit"));
    assert.ok(rows.some((r) => r.accountId === f.creditId && r.direction === "Debit"));
    assert.ok(rows.every((r) => r.externalId && Number(r.amount) >= 0));

    const bals = await db.select().from(accountBalances).where(inArray(accountBalances.accountId, [f.checkingId, f.creditId]));
    assert.equal(bals.length, 2);
    // Sandbox: checking available 100 (cash records available), card current 410 owed.
    assert.equal(Number(bals.find((b) => b.accountId === f.checkingId)!.balance), 100);
    assert.equal(Number(bals.find((b) => b.accountId === f.creditId)!.balance), 410);
  });

  test("a second run inserts nothing", { timeout: 60_000 }, async () => {
    const s = await runSync({ trigger: "cli", enrollmentDbId: enrollmentDbId! });
    assert.equal(s.status, "ok");
    assert.equal(s.inserted, 0);
  });

  test("login required → enrollment marked disconnected (Reconnect territory)", { timeout: 60_000 }, async () => {
    await sandboxResetLogin(accessToken);
    clearPlaidCache();
    await runSync({ trigger: "cli", enrollmentDbId: enrollmentDbId! });
    const [enr] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, enrollmentDbId!)).limit(1);
    assert.equal(enr.status, "disconnected");
    assert.equal(enr.disconnectReason, "plaid.ITEM_LOGIN_REQUIRED");
  });

  test("remove revokes the Item at Plaid", { timeout: 30_000 }, async () => {
    await removeEnrollment(enrollmentDbId!, { revokeRemote: true });
    enrollmentDbId = null;
    const { plaidProvider } = await import("@/server/lib/plaid");
    await assert.rejects(plaidProvider.listAccounts(accessToken), (e: { disconnected?: boolean }) => e.disconnected === true);
  });
});

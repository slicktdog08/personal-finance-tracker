import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  externalTxnId,
  inferAccountType,
  lastFourOf,
  localIsoToUnix,
  mapAccount,
  mapBalances,
  mapTransaction,
  transactionsInRange,
  unixToLocalIso,
} from "@/server/lib/simplefin/map";
import { claimSetupToken, decodeSetupToken, parseAccessUrl } from "@/server/lib/simplefin/client";
import { clearSimplefinCache, simplefinEnrollmentId, simplefinProvider } from "@/server/lib/simplefin";
import { SyncProviderError } from "@/server/lib/sync/provider";
import { todayIso } from "@/server/lib/pay-schedule";
import type { SfinAccount, SfinAccountSet } from "@/server/lib/simplefin/types";

const ACCESS = "https://user123:secret@beta-bridge.simplefin.org/simplefin";
const noon = (iso: string) => localIsoToUnix(iso) + 12 * 3600;

function account(over: Partial<SfinAccount> = {}): SfinAccount {
  return {
    id: "ACT-1",
    name: "Checking (1234)",
    conn_id: "CON-1",
    currency: "USD",
    balance: "500.25",
    "available-balance": "450.00",
    "balance-date": noon("2026-10-01"),
    transactions: [],
    ...over,
  };
}

describe("simplefin map", () => {
  test("sign: negative = Debit, positive = Credit, for every account type", () => {
    const a = account();
    const out = mapTransaction({ id: "t1", posted: noon("2026-10-01"), amount: "-45.50", description: "Fishing bait" }, a, "2026-10-08");
    assert.equal(out.direction, "Debit");
    assert.equal(out.amount, 45.5);
    const card = account({ name: "Visa Signature", balance: "-900" });
    const pay = mapTransaction({ id: "t2", posted: noon("2026-10-01"), amount: "300.00", description: "PAYMENT" }, card, "2026-10-08");
    assert.equal(pay.direction, "Credit");
  });

  test("dates: transacted_at wins, pending has posted=0, falls back to today", () => {
    const a = account();
    const posted = mapTransaction({ id: "t", posted: noon("2026-10-03"), transacted_at: noon("2026-10-01"), amount: "-1", description: "x" }, a, "2026-10-08");
    assert.equal(posted.txnDate, "2026-10-01");
    assert.equal(posted.status, "posted");
    const pending = mapTransaction({ id: "p", posted: 0, amount: "-1", description: "x", pending: true }, a, "2026-10-08");
    assert.equal(pending.status, "pending");
    assert.equal(pending.txnDate, "2026-10-08");
    assert.equal(unixToLocalIso(localIsoToUnix("2026-03-08")), "2026-03-08");
  });

  test("transaction ids are scoped to their account", () => {
    assert.notEqual(externalTxnId("Demo Savings", "1789002431"), externalTxnId("Demo Checking", "1789002431"));
    assert.ok(externalTxnId("a", "b").length <= 64);
  });

  test("range filter: posted by posted date, pending always kept", () => {
    const a = account({
      transactions: [
        { id: "old", posted: noon("2026-09-01"), amount: "-1", description: "old" },
        { id: "late", posted: noon("2026-10-02"), transacted_at: noon("2026-09-25"), amount: "-2", description: "made before, posted inside" },
        { id: "pend", posted: 0, transacted_at: noon("2026-09-10"), amount: "-3", description: "held", pending: true },
      ],
    });
    const out = transactionsInRange(a, { startDate: "2026-09-28", endDate: "2026-10-08" }, "2026-10-08");
    assert.deepEqual(out.map((t) => t.description).sort(), ["held", "made before, posted inside"]);
  });

  test("account: type inference, last four, connection name", () => {
    assert.equal(inferAccountType({ name: "Quicksilver", balance: "-12.00" }), "credit");
    assert.equal(inferAccountType({ name: "CREDIT CARD", balance: "0" }), "credit");
    assert.equal(inferAccountType({ name: "360 Checking", balance: "10" }), "depository");
    assert.equal(lastFourOf("Checking (1234)"), "1234");
    assert.equal(lastFourOf("CREDIT CARD ...5678"), "5678");
    assert.equal(lastFourOf("Savings"), null);
    const m = mapAccount(account(), new Map([["CON-1", { conn_id: "CON-1", name: "Capital One", org_id: "capitalone.com" }]]), "sf_x");
    assert.equal(m.institutionName, "Capital One");
    assert.equal(m.subtype, "Capital One");
    assert.equal(m.lastFour, "1234");
  });

  test("balances: credit records the owed amount (negated balance)", () => {
    assert.deepEqual(mapBalances(account({ balance: "-1250.40", "available-balance": "3749.60" }), "credit"), { ledger: 1250.4, available: 3749.6 });
    assert.deepEqual(mapBalances(account(), "depository"), { ledger: 500.25, available: 450 });
    // No available reported → null, and sync falls back to the balance (noting it).
    assert.deepEqual(mapBalances(account({ "available-balance": undefined }), "depository"), { ledger: 500.25, available: null });
    // A "0.00" available next to a real balance means "not reported" (Capital One 360).
    assert.deepEqual(mapBalances(account({ balance: "1386.30", "available-balance": "0.00" }), "depository"), { ledger: 1386.3, available: null });
    assert.deepEqual(mapBalances(account({ balance: "0.00", "available-balance": "0.00" }), "depository"), { ledger: 0, available: 0 });
  });
});

describe("simplefin client", () => {
  test("access URL credentials are split out of the URL", () => {
    assert.deepEqual(parseAccessUrl(ACCESS), { base: "https://beta-bridge.simplefin.org/simplefin", username: "user123", password: "secret" });
    assert.throws(() => parseAccessUrl("http://u:p@bridge.simplefin.org/simplefin"), /https/);
    assert.throws(() => parseAccessUrl("https://u:p@evil.example/simplefin"), /simplefin\.org/);
    assert.throws(() => parseAccessUrl("https://bridge.simplefin.org/simplefin"), /credentials/);
  });
  test("setup tokens decode to an https simplefin.org claim URL", () => {
    const tok = Buffer.from("https://bridge.simplefin.org/simplefin/claim/abc").toString("base64");
    assert.equal(decodeSetupToken(` ${tok}\n`).pathname, "/simplefin/claim/abc");
    assert.throws(() => decodeSetupToken(Buffer.from("https://evil.example/claim").toString("base64")), /simplefin\.org/);
    assert.throws(() => decodeSetupToken("not-a-token"), /Setup Token/);
  });
  test("enrollment id is stable per access username and hides it", () => {
    const id = simplefinEnrollmentId(ACCESS);
    assert.equal(id, simplefinEnrollmentId("https://user123:other@beta-bridge.simplefin.org/simplefin"));
    assert.ok(!id.includes("user123"));
  });
});

describe("simplefin provider (stubbed fetch)", () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];
  let respond: (url: string, init?: RequestInit) => Response;

  beforeEach(() => {
    clearSimplefinCache();
    calls = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      return respond(url, init);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const today = todayIso();
  const json = (body: SfinAccountSet, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const set = (over: Partial<SfinAccountSet> = {}): SfinAccountSet => ({
    errlist: [],
    connections: [
      { conn_id: "CON-1", name: "Capital One", org_id: "c1" },
      { conn_id: "CON-2", name: "Chase", org_id: "c2" },
    ],
    accounts: [
      account({ transactions: [{ id: "1", posted: noon(today), amount: "-10.00", description: "Coffee" }] }),
      account({ id: "ACT-2", name: "Sapphire ...9999", conn_id: "CON-2", balance: "-200", transactions: [{ id: "1", posted: 0, amount: "-5", description: "Held", pending: true }] }),
    ],
    ...over,
  });

  test("a whole run is one request, with basic auth and pending=1", async () => {
    let auth: string | null = null;
    respond = (_u, init) => {
      auth = new Headers(init?.headers).get("authorization");
      return json(set());
    };
    const accounts = await simplefinProvider.listAccounts(ACCESS);
    assert.equal(accounts.length, 2);
    const range = { startDate: today, endDate: today };
    const t1 = await simplefinProvider.listTransactions(ACCESS, { externalId: "ACT-1", type: "depository" }, range);
    const t2 = await simplefinProvider.listTransactions(ACCESS, { externalId: "ACT-2", type: "credit" }, range);
    const b2 = await simplefinProvider.getBalances(ACCESS, { externalId: "ACT-2", type: "credit" });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/beta-bridge\.simplefin\.org\/simplefin\/accounts\?/);
    assert.match(calls[0], /version=2/);
    assert.match(calls[0], /pending=1/);
    assert.equal(auth, `Basic ${Buffer.from("user123:secret").toString("base64")}`);
    assert.equal(t1[0].description, "Coffee");
    assert.equal(t2[0].status, "pending");
    assert.notEqual(t1[0].externalId, t2[0].externalId); // same SimpleFIN id "1"
    assert.equal(b2.ledger, 200);
  });

  test("debugResponse returns the cached response with every account field, transactions trimmed", async () => {
    assert.equal(simplefinProvider.debugResponse!(ACCESS), null);
    const many = Array.from({ length: 5 }, (_, i) => ({ id: String(i), posted: noon(today), amount: "-1", description: `t${i}` }));
    respond = () => json(set({ accounts: [account({ "available-balance": "0.00", extra: { "current-balance": "1386.30" }, transactions: many })] }));
    await simplefinProvider.listAccounts(ACCESS);
    const dbg = simplefinProvider.debugResponse!(ACCESS) as { accounts: Record<string, unknown>[]; connections: unknown[] };
    assert.equal(calls.length, 1); // served from the cache, no extra request
    assert.equal(dbg.connections.length, 2);
    const a = dbg.accounts[0];
    assert.equal(a["available-balance"], "0.00");
    assert.deepEqual(a.extra, { "current-balance": "1386.30" });
    assert.equal(a.transactionCount, 5);
    assert.equal((a.transactionSamples as unknown[]).length, 3);
    assert.equal("transactions" in a, false);
  });

  test("a range older than the cached window triggers one wider fetch", async () => {
    respond = () => json(set());
    await simplefinProvider.listAccounts(ACCESS);
    const start = new Date();
    start.setDate(start.getDate() - 60);
    const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    await simplefinProvider.listTransactions(ACCESS, { externalId: "ACT-1", type: "depository" }, { startDate: iso, endDate: today });
    await simplefinProvider.listTransactions(ACCESS, { externalId: "ACT-2", type: "credit" }, { startDate: iso, endDate: today });
    assert.equal(calls.length, 2);
  });

  test("connection errors block only that bank's accounts", async () => {
    respond = () => json(set({ errlist: [{ code: "con.auth", msg: "Chase needs you to log in again", conn_id: "CON-2" }] }));
    const range = { startDate: today, endDate: today };
    assert.equal((await simplefinProvider.listTransactions(ACCESS, { externalId: "ACT-1", type: "depository" }, range)).length, 1);
    await assert.rejects(
      simplefinProvider.listTransactions(ACCESS, { externalId: "ACT-2", type: "credit" }, range),
      (e: unknown) => e instanceof SyncProviderError && !e.disconnected && /Chase: Chase needs you to log in again.*Bridge/.test(e.message),
    );
  });

  test("403 and gen.auth disconnect the enrollment; 402 does not", async () => {
    respond = () => new Response("Forbidden", { status: 403 });
    await assert.rejects(simplefinProvider.listAccounts(ACCESS), (e: unknown) => e instanceof SyncProviderError && e.disconnected);
    clearSimplefinCache();
    respond = () => json(set({ errlist: [{ code: "gen.auth", msg: "Access revoked" }] }));
    await assert.rejects(simplefinProvider.listAccounts(ACCESS), (e: unknown) => e instanceof SyncProviderError && e.disconnected);
    clearSimplefinCache();
    respond = () => new Response("pay", { status: 402 });
    await assert.rejects(simplefinProvider.listAccounts(ACCESS), (e: unknown) => e instanceof SyncProviderError && !e.disconnected && e.code === "simplefin.payment_required");
  });

  test("claim POSTs to the decoded URL and returns the access URL", async () => {
    let method: string | undefined;
    respond = (_u, init) => {
      method = init?.method;
      return new Response(ACCESS + "\n", { status: 200 });
    };
    const tok = Buffer.from("https://beta-bridge.simplefin.org/simplefin/claim/demo").toString("base64");
    assert.equal(await claimSetupToken(tok), ACCESS);
    assert.equal(method, "POST");
    assert.equal(calls[0], "https://beta-bridge.simplefin.org/simplefin/claim/demo");
    respond = () => new Response("", { status: 403 });
    await assert.rejects(claimSetupToken(tok), /already claimed/);
  });
});

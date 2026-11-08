import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "crypto";
import { mapAccount, mapBalances, mapTransactions, plaidAccountType, plaidDirection, stableTxnId, txnDateOf } from "@/server/lib/plaid/map";
import { toProviderError } from "@/server/lib/plaid/client";
import { plaidWebhookEvent, verifyPlaidJwt } from "@/server/lib/plaid";
import type { PlaidAccount, PlaidTransaction } from "@/server/lib/plaid/types";

function txn(over: Partial<PlaidTransaction>): PlaidTransaction {
  return {
    transaction_id: "t1",
    account_id: "acc",
    amount: 12.5,
    iso_currency_code: "USD",
    date: "2026-10-05",
    authorized_date: null,
    pending: false,
    pending_transaction_id: null,
    name: "STARBUCKS #123",
    merchant_name: "Starbucks",
    payment_channel: "in store",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
    ...over,
  };
}

const range = { startDate: "2026-10-01", endDate: "2026-10-10" };

describe("plaid map", () => {
  test("sign: positive = money out (Debit), negative = money in (Credit), any account type", () => {
    assert.equal(plaidDirection(12.5), "Debit");
    assert.equal(plaidDirection(-500), "Credit");
    const m = mapTransactions([txn({ amount: -500, name: "PAYROLL" })], range)[0];
    assert.equal(m.direction, "Credit");
    assert.equal(m.amount, 500);
  });

  test("fields: name is the description, merchant + category are hints, transfers flagged", () => {
    const [m] = mapTransactions([txn({})], range);
    assert.equal(m.description, "STARBUCKS #123");
    assert.equal(m.counterparty, "Starbucks");
    assert.equal(m.rawCategory, "FOOD_AND_DRINK_COFFEE");
    assert.equal(m.kind, "in store");
    const [t] = mapTransactions([txn({ personal_finance_category: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" } })], range);
    assert.equal(t.kind, "transfer");
  });

  test("posted rows keep the pending row's id and date, so the engine promotes in place", () => {
    const pending = txn({ transaction_id: "P", pending: true, date: "2026-10-03" });
    const posted = txn({ transaction_id: "Q", pending_transaction_id: "P", date: "2026-10-05", authorized_date: "2026-10-03" });
    assert.equal(stableTxnId(posted), "P");
    assert.equal(txnDateOf(posted), "2026-10-03");
    // Both in one response: only the posted row survives, under the pending id.
    const out = mapTransactions([pending, posted], range);
    assert.equal(out.length, 1);
    assert.equal(out[0].externalId, "P");
    assert.equal(out[0].status, "posted");
  });

  test("range: posted rows by posted date; pending rows always kept", () => {
    const out = mapTransactions(
      [
        txn({ transaction_id: "old", date: "2026-09-20" }),
        txn({ transaction_id: "in", date: "2026-10-02", authorized_date: "2026-09-29" }),
        txn({ transaction_id: "hold", pending: true, date: "2026-09-25" }),
      ],
      range,
    );
    assert.deepEqual(out.map((t) => t.externalId).sort(), ["hold", "in"]);
  });

  test("accounts: type folding, mask, institution", () => {
    assert.equal(plaidAccountType("credit"), "credit");
    assert.equal(plaidAccountType("loan"), "credit");
    assert.equal(plaidAccountType("investment"), "depository");
    const a: PlaidAccount = {
      account_id: "A1",
      name: "Plaid Checking",
      official_name: null,
      mask: "0000",
      type: "depository",
      subtype: "checking",
      balances: { available: 100, current: 110, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
    };
    const m = mapAccount(a, { itemId: "I1", institutionId: "ins_1", institutionName: "First Platypus Bank" });
    assert.equal(m.lastFour, "0000");
    assert.equal(m.enrollmentId, "I1");
    assert.equal(m.institutionName, "First Platypus Bank");
    assert.deepEqual(mapBalances(a), { ledger: 110, available: 100 });
  });

  test("errors: only item-level codes disconnect", () => {
    const login = toProviderError(400, { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "x", display_message: null });
    assert.equal(login.disconnected, true);
    assert.match(login.message, /Reconnect/);
    const notReady = toProviderError(400, { error_type: "ITEM_ERROR", error_code: "PRODUCT_NOT_READY", error_message: "x", display_message: null });
    assert.equal(notReady.disconnected, false);
    assert.equal(notReady.code, "plaid.PRODUCT_NOT_READY");
    assert.equal(toProviderError(400, { error_type: "INVALID_INPUT", error_code: "INVALID_API_KEYS", error_message: "x", display_message: null }).disconnected, false);
  });
});

describe("plaid webhooks", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keyFor = async (kid: string) => (kid === "k1" ? publicKey : null);
  const now = 1_800_000_000;

  function jwt(body: string, opts: { iat?: number; alg?: string; kid?: string; bodyForHash?: string } = {}) {
    const header = Buffer.from(JSON.stringify({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "k1", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({ iat: opts.iat ?? now, request_body_sha256: createHash("sha256").update(opts.bodyForHash ?? body).digest("hex") }),
    ).toString("base64url");
    const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return `${header}.${claims}.${sig}`;
  }

  const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "DEFAULT_UPDATE", item_id: "I1" }, null, 2);

  test("a valid signature over the exact body verifies", async () => {
    assert.equal(await verifyPlaidJwt(body, jwt(body), now + 10, keyFor), true);
  });
  test("tampered body, stale iat, wrong alg, unknown key, missing header all fail", async () => {
    assert.equal(await verifyPlaidJwt(body + " ", jwt(body), now, keyFor), false);
    assert.equal(await verifyPlaidJwt(body, jwt(body, { iat: now - 301 }), now, keyFor), false);
    assert.equal(await verifyPlaidJwt(body, jwt(body, { alg: "HS256" }), now, keyFor), false);
    assert.equal(await verifyPlaidJwt(body, jwt(body, { kid: "other" }), now, keyFor), false);
    assert.equal(await verifyPlaidJwt(body, null, now, keyFor), false);
    assert.equal(await verifyPlaidJwt(body, "not.a.jwt", now, keyFor), false);
  });
  test("events: transactions → sync; login errors and revocations → disconnected", () => {
    assert.deepEqual(plaidWebhookEvent({ webhook_type: "TRANSACTIONS", webhook_code: "INITIAL_UPDATE", item_id: "I1" }), {
      type: "transactions.processed",
      enrollmentId: "I1",
    });
    assert.deepEqual(
      plaidWebhookEvent({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "I1",
        error: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "", display_message: null },
      }),
      { type: "enrollment.disconnected", enrollmentId: "I1", reason: "ITEM_LOGIN_REQUIRED" },
    );
    assert.equal(plaidWebhookEvent({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: "I1" }).type, "enrollment.disconnected");
    assert.equal(plaidWebhookEvent({ webhook_type: "ITEM", webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED", item_id: "I1" }).type, "test");
    assert.equal(plaidWebhookEvent({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", item_id: "I1" }).type, "other");
  });
});

describe("plaid OAuth redirect", () => {
  const saved = { APP_URL: process.env.APP_URL, PLAID_REDIRECT_URI: process.env.PLAID_REDIRECT_URI, PLAID_ENV: process.env.PLAID_ENV };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  test("derived from an https APP_URL; PLAID_REDIRECT_URI overrides; none for http", async () => {
    const { plaidRedirectUri } = await import("@/server/lib/plaid");
    try {
      delete process.env.PLAID_REDIRECT_URI;
      process.env.APP_URL = "https://finance.example.com/";
      assert.equal(plaidRedirectUri(), "https://finance.example.com/settings/sync/plaid-oauth");
      process.env.PLAID_REDIRECT_URI = "https://other.example.com/cb";
      assert.equal(plaidRedirectUri(), "https://other.example.com/cb");
      delete process.env.PLAID_REDIRECT_URI;
      process.env.APP_URL = "http://localhost:3000";
      assert.equal(plaidRedirectUri(), null);
    } finally {
      restore();
    }
  });

  test("an unregistered redirect falls back to a token without it and says so", async () => {
    const { createLinkToken } = await import("@/server/lib/plaid");
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(b);
      if (b.redirect_uri) {
        return new Response(
          JSON.stringify({ error_type: "INVALID_REQUEST", error_code: "INVALID_FIELD", error_message: "OAuth redirect URI must be configured in the developer dashboard.", display_message: null }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ link_token: "link-sandbox-x", expiration: "2026-10-11T00:00:00Z", request_id: "r" }), { status: 200 });
    }) as typeof fetch;
    try {
      process.env.PLAID_ENV = "sandbox";
      process.env.APP_URL = "https://finance.example.com";
      delete process.env.PLAID_REDIRECT_URI;
      const res = await createLinkToken();
      assert.equal(res.linkToken, "link-sandbox-x");
      assert.deepEqual(res.oauthUnavailable, { redirectUri: "https://finance.example.com/settings/sync/plaid-oauth" });
      assert.equal(bodies.length, 2);
      assert.equal("redirect_uri" in bodies[1], false);
    } finally {
      globalThis.fetch = realFetch;
      restore();
    }
  });
});

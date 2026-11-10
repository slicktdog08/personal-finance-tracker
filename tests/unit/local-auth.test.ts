// Built-in auth's pure pieces: password hashing, the HS256 session tokens and the
// provider switch. No database — the flows that need one are exercised in the browser.
import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, passwordProblem, verifyPassword } from "../../src/server/auth/local/password";
import { signJwt, verifyJwt } from "../../src/server/auth/local/jwt";
import { authProvider } from "../../src/server/auth/provider";

const SECRET = Buffer.from("a".repeat(64));

test("password: round-trips, rejects the wrong one, salts every hash", async () => {
  const a = await hashPassword("correct horse battery");
  const b = await hashPassword("correct horse battery");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("correct horse battery", a), true);
  assert.equal(await verifyPassword("correct horse batterz", a), false);
});

test("password: unreadable or hostile stored values verify false instead of throwing", async () => {
  for (const stored of ["", "plaintext", "bcrypt$10$abc$def", "scrypt$99999999999$8$1$c2FsdA$aGFzaA", "scrypt$32768$8$1$$"]) {
    assert.equal(await verifyPassword("anything", stored), false, stored);
  }
});

test("password: length policy", () => {
  assert.equal(passwordProblem("short"), "Use at least 8 characters.");
  assert.equal(passwordProblem("long enough"), null);
  assert.ok(passwordProblem("x".repeat(600)));
});

test("jwt: a signed token verifies and carries its claims", () => {
  const token = signJwt({ sub: "1", token_use: "access" }, SECRET, 60);
  const claims = verifyJwt(token, SECRET);
  assert.equal(claims?.sub, "1");
  assert.equal(claims?.token_use, "access");
});

test("jwt: expired, re-keyed and tampered tokens are rejected", () => {
  const now = Date.now();
  const token = signJwt({ sub: "1" }, SECRET, 60, now);
  assert.equal(verifyJwt(token, SECRET, now + 61_000), null, "expired");
  assert.equal(verifyJwt(token, Buffer.from("b".repeat(64))), null, "other key");

  const [h, , s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "2", iat: 0, exp: 9999999999 })).toString("base64url");
  assert.equal(verifyJwt(`${h}.${forged}.${s}`, SECRET), null, "payload swapped");
  assert.equal(verifyJwt("not.a.jwt", SECRET), null);
  assert.equal(verifyJwt("", SECRET), null);
});

test("jwt: only HS256 is accepted — alg:none and friends never verify", () => {
  const body = Buffer.from(JSON.stringify({ sub: "1", iat: 0, exp: 9999999999 })).toString("base64url");
  for (const alg of ["none", "HS512", "RS256"]) {
    const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
    assert.equal(verifyJwt(`${header}.${body}.`, SECRET), null, alg);
  }
});

test("provider: built-in unless a Cognito pool is configured; the demo is always built-in", () => {
  const keys = ["AUTH_PROVIDER", "DEMO_MODE", "NEXT_PUBLIC_COGNITO_USER_POOL_ID", "COGNITO_USER_POOL_ID"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const set = (env: Partial<Record<(typeof keys)[number], string>>) => {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, env);
  };
  try {
    set({});
    assert.equal(authProvider(), "local");
    set({ NEXT_PUBLIC_COGNITO_USER_POOL_ID: "us-east-1_XXXXXXXXX" });
    assert.equal(authProvider(), "local", "the .env.example placeholder is not a pool");
    set({ COGNITO_USER_POOL_ID: "us-east-1_AbCdEf123" });
    assert.equal(authProvider(), "cognito");
    set({ COGNITO_USER_POOL_ID: "us-east-1_AbCdEf123", AUTH_PROVIDER: "local" });
    assert.equal(authProvider(), "local");
    set({ COGNITO_USER_POOL_ID: "us-east-1_AbCdEf123", DEMO_MODE: "1" });
    assert.equal(authProvider(), "local");
    set({ AUTH_PROVIDER: "ldap" });
    assert.throws(() => authProvider(), /AUTH_PROVIDER/);
  } finally {
    set({});
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});

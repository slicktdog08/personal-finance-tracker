import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decryptToken, encryptToken, hasTokenKey } from "@/server/lib/sync/crypto";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token encryption", () => {
  const prev = process.env.SYNC_TOKEN_ENCRYPTION_KEY;
  test("round trip; each encryption is unique (random iv)", () => {
    process.env.SYNC_TOKEN_ENCRYPTION_KEY = KEY;
    const a = encryptToken("token_secret_123");
    const b = encryptToken("token_secret_123");
    assert.notEqual(a, b);
    assert.equal(decryptToken(a), "token_secret_123");
    assert.equal(decryptToken(b), "token_secret_123");
    assert.equal(hasTokenKey(), true);
  });
  test("tampered ciphertext fails authentication", () => {
    process.env.SYNC_TOKEN_ENCRYPTION_KEY = KEY;
    const enc = Buffer.from(encryptToken("x"), "base64");
    enc[enc.length - 1] ^= 0xff;
    assert.throws(() => decryptToken(enc.toString("base64")));
  });
  test("wrong key fails; truncated blob is rejected", () => {
    process.env.SYNC_TOKEN_ENCRYPTION_KEY = KEY;
    const enc = encryptToken("x");
    process.env.SYNC_TOKEN_ENCRYPTION_KEY = "f".repeat(64);
    assert.throws(() => decryptToken(enc));
    assert.throws(() => decryptToken(Buffer.alloc(10).toString("base64")), /Corrupt/);
  });
  test("missing or malformed key is a clear error", () => {
    delete process.env.SYNC_TOKEN_ENCRYPTION_KEY;
    assert.equal(hasTokenKey(), false);
    assert.throws(() => encryptToken("x"), /SYNC_TOKEN_ENCRYPTION_KEY/);
    process.env.SYNC_TOKEN_ENCRYPTION_KEY = "abc";
    assert.equal(hasTokenKey(), false);
    if (prev == null) delete process.env.SYNC_TOKEN_ENCRYPTION_KEY;
    else process.env.SYNC_TOKEN_ENCRYPTION_KEY = prev;
  });
});

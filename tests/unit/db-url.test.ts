import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDbUrl } from "@/server/lib/db-url";

describe("parseDbUrl", () => {
  test("password with '@' splits on the last one", () => {
    const c = parseDbUrl("mysql://billing:p@ss@word@db.example.com:3307/personal-billing");
    assert.deepEqual(c, {
      host: "db.example.com",
      port: 3307,
      user: "billing",
      password: "p@ss@word",
      database: "personal-billing",
    });
  });

  test("no ssl-mode means no TLS", () => {
    assert.equal(parseDbUrl("mysql://u:p@h/db").ssl, undefined);
    assert.equal(parseDbUrl("mysql://u:p@h/db?ssl-mode=DISABLED").ssl, undefined);
    assert.equal(parseDbUrl("mysql://u:p@h/db?ssl-mode=preferred").ssl, undefined);
  });

  test("ssl-mode=REQUIRED encrypts without checking the cert", () => {
    const c = parseDbUrl("mysql://u:p@h:3306/personal-billing?ssl-mode=REQUIRED");
    assert.deepEqual(c.ssl, { rejectUnauthorized: false });
    assert.equal(c.database, "personal-billing");
  });

  test("ssl-mode=VERIFY_IDENTITY checks the cert", () => {
    assert.deepEqual(parseDbUrl("mysql://u:p@h/db?ssl-mode=verify_identity").ssl, {
      rejectUnauthorized: true,
    });
  });

  test("unknown ssl-mode is rejected", () => {
    assert.throws(() => parseDbUrl("mysql://u:p@h/db?ssl-mode=yes"), /unknown ssl-mode/);
  });
});

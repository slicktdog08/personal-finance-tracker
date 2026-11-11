import { test } from "node:test";
import assert from "node:assert/strict";
import { demoResetTarget } from "@/server/lib/demo/mode";

// A demo reset wipes the whole ledger, so it may only ever aim at DATABASE_URL, and it must stop
// when DATABASE_MIGRATION_URL (often inherited from .env.local) names some other database.

const DEMO = "mysql://root:root@127.0.0.1:3307/pft_demo";
const LIVE = "mysql://app:p@ss@db.example.com:3306/live-db?ssl-mode=VERIFY_IDENTITY";

test("uses DATABASE_URL when it is the only URL", () => {
  assert.deepEqual(demoResetTarget({ DATABASE_URL: DEMO }), { url: DEMO });
});

test("never follows DATABASE_MIGRATION_URL to another database", () => {
  const r = demoResetTarget({ DATABASE_URL: DEMO, DATABASE_MIGRATION_URL: LIVE });
  assert.ok("error" in r);
  assert.match(r.error, /different databases/);
});

test("refuses when only the database name differs", () => {
  const r = demoResetTarget({ DATABASE_URL: DEMO, DATABASE_MIGRATION_URL: DEMO.replace("pft_demo", "other") });
  assert.ok("error" in r);
});

test("allows a migration URL with other credentials for the same database", () => {
  const admin = "mysql://admin:secret@127.0.0.1:3307/pft_demo";
  assert.deepEqual(demoResetTarget({ DATABASE_URL: DEMO, DATABASE_MIGRATION_URL: admin }), { url: DEMO });
});

test("refuses without DATABASE_URL, even when a migration URL is set", () => {
  assert.ok("error" in demoResetTarget({ DATABASE_MIGRATION_URL: LIVE }));
});

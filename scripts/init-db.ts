/**
 * Creates the full schema in an EMPTY database for a fresh install.
 *
 * The migration history in drizzle/ can't build a database from scratch on its own: the
 * drizzle journal stops at 0004 and scripts/apply-sql.ts records 0005–0021 as a baseline
 * without running them. So a new install loads tests/db/schema.sql — the current schema
 * plus the default lookup rows (statuses, payment types, categories) and the migration
 * ledger — and `npm run db:init` then runs `apply-sql.ts --pending` for anything newer.
 *
 * Refuses to touch a database that already has tables: the dump starts with DROP TABLE.
 *
 * Run: npm run db:init
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import mysql from "mysql2/promise";
import { parseDbUrl } from "../src/server/lib/db-url";

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ Set DATABASE_URL (or DATABASE_MIGRATION_URL) in .env.local first.");
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...parseDbUrl(url), multipleStatements: true });
  try {
    const [tables] = await conn.query("SHOW TABLES");
    if ((tables as unknown[]).length) {
      console.error(
        `✗ The database already has ${(tables as unknown[]).length} table(s). db:init only runs on an\n` +
          "  empty database. For an existing install, apply new migrations with:\n" +
          "      npx tsx scripts/apply-sql.ts --pending",
      );
      process.exit(1);
    }
    await conn.query(readFileSync("tests/db/schema.sql", "utf8"));
    const [after] = await conn.query("SHOW TABLES");
    console.log(`✓ Created ${(after as unknown[]).length} tables with default lookups.`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

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
 *
 *   --if-empty  exit quietly (success) when the database already has tables, instead of
 *               refusing. For start-up scripts that run on every boot.
 *   --wait      retry the connection for up to two minutes, for when MySQL is still booting
 *               (docker compose brings the database and the app up together).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import mysql from "mysql2/promise";
import { parseDbUrl } from "../src/server/lib/db-url";
import { CATEGORY_DEFAULTS, PAYMENT_TYPE_DEFAULTS, STATUS_DEFAULTS } from "../src/constants/enums";

const args = new Set(process.argv.slice(2));

// Categories the dump carries that aren't in CATEGORY_DEFAULTS (added in the app later).
const EXTRA_CATEGORY_EMOJI: Record<string, string> = { Housing: "🏠", Gas: "⛽", "Restaurant/Bar": "🍽️", Health: "❤️" };

async function connect(url: string): Promise<mysql.Connection> {
  const options = { ...parseDbUrl(url), multipleStatements: true, charset: "utf8mb4" };
  const deadline = Date.now() + (args.has("--wait") ? 120_000 : 0);
  for (let attempt = 1; ; attempt++) {
    try {
      return await mysql.createConnection(options);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      // Only "not up yet" is worth waiting out; a wrong password never fixes itself.
      const transient = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"].includes(code);
      if (!transient || Date.now() >= deadline) throw error;
      if (attempt === 1) console.log("Waiting for the database to accept connections ...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/**
 * tests/db/schema.sql is a mysqldump, and the dump wrote every emoji in the lookup tables
 * as a literal "?" (it was taken over a non-utf8mb4 connection). Rather than hand-edit a
 * generated file, put the real ones back from the same defaults scripts/seed-config.ts uses.
 * A row whose name has no known emoji gets none, which the UI renders as its colour dot.
 */
async function repairLookupEmoji(conn: mysql.Connection): Promise<void> {
  const tables: [string, { name: string; emoji?: string }[]][] = [
    ["bill_statuses", STATUS_DEFAULTS],
    ["payment_types", PAYMENT_TYPE_DEFAULTS],
    ["categories", [...CATEGORY_DEFAULTS, ...Object.entries(EXTRA_CATEGORY_EMOJI).map(([name, emoji]) => ({ name, emoji }))]],
  ];
  for (const [table, defaults] of tables) {
    for (const d of defaults) {
      if (d.emoji) await conn.query(`UPDATE \`${table}\` SET emoji = ? WHERE name = ? AND emoji LIKE '?%'`, [d.emoji, d.name]);
    }
    await conn.query(`UPDATE \`${table}\` SET emoji = NULL WHERE emoji LIKE '?%'`);
  }
}

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ Set DATABASE_URL (or DATABASE_MIGRATION_URL) in .env.local first.");
    process.exit(1);
  }
  const conn = await connect(url);
  try {
    const [tables] = await conn.query("SHOW TABLES");
    if ((tables as unknown[]).length && args.has("--if-empty")) {
      console.log(`Database already has ${(tables as unknown[]).length} tables; nothing to create.`);
      return;
    }
    if ((tables as unknown[]).length) {
      console.error(
        `✗ The database already has ${(tables as unknown[]).length} table(s). db:init only runs on an\n` +
          "  empty database. For an existing install, apply new migrations with:\n" +
          "      npx tsx scripts/apply-sql.ts --pending",
      );
      process.exit(1);
    }
    await conn.query(readFileSync("tests/db/schema.sql", "utf8"));
    await repairLookupEmoji(conn);
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

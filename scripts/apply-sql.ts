/**
 * Applies hand-written .sql migrations directly via mysql2.
 * Works around drizzle-kit migrate not applying migrations when the database
 * name contains a hyphen (e.g. "personal-billing"), and around the drizzle journal
 * stopping at 0004 — every migration since is hand-written and unjournaled.
 *
 * Usage:
 *   npx tsx scripts/apply-sql.ts --pending          apply every drizzle/*.sql not yet applied
 *   npx tsx scripts/apply-sql.ts <path-to-sql ...>  apply these files (even if already applied)
 *   npx tsx scripts/apply-sql.ts                    drizzle/0000_init.sql
 *
 * Every file that applies cleanly is recorded in the `sql_migrations` table, so `--pending`
 * (what the Jenkins APPLY_SQL stage runs on every deploy) skips anything already applied —
 * including files applied by hand from a dev machine with this script.
 *
 * Exits non-zero if any statement fails (other than "already exists", which is skipped so
 * re-runs are safe); a failed file is not recorded, and the deploy stops before the new code
 * goes live.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, readdirSync } from "fs";
import mysql from "mysql2/promise";
import { parseDbUrl } from "../src/server/lib/db-url";

const DIR = "drizzle";
const TABLE = "sql_migrations";

// Everything up to and including this number was applied by hand before `sql_migrations`
// existed. When the table is first created those files are recorded as applied without being
// run — several aren't safe to repeat (0007/0008 move and drop data). Never raise this.
const BASELINE_THROUGH = 21;

type Conn = mysql.Connection;

const fileName = (path: string) => path.split("/").pop()!;
const numberOf = (name: string) => Number(/^(\d+)_/.exec(name)?.[1] ?? NaN);

// Migrations drizzle-kit owns (its journal); `drizzle-kit migrate` applies those, not us.
function journaledTags(): Set<string> {
  try {
    const j = JSON.parse(readFileSync(`${DIR}/meta/_journal.json`, "utf8")) as {
      entries: { tag: string }[];
    };
    return new Set(j.entries.map((e) => `${e.tag}.sql`));
  } catch {
    return new Set();
  }
}

// Create the tracking table on first use, recording the baseline (see BASELINE_THROUGH).
async function ensureTable(conn: Conn): Promise<void> {
  const [rows] = await conn.query(`SHOW TABLES LIKE '${TABLE}'`);
  if ((rows as unknown[]).length) return;
  await conn.query(
    `CREATE TABLE \`${TABLE}\` (
       \`filename\` varchar(255) NOT NULL PRIMARY KEY,
       \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
       \`note\` varchar(64) NULL
     )`,
  );
  const baseline = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && numberOf(f) <= BASELINE_THROUGH)
    .sort();
  for (const f of baseline) {
    await conn.query(`INSERT IGNORE INTO \`${TABLE}\` (filename, note) VALUES (?, 'baseline')`, [f]);
  }
  console.log(`Created ${TABLE}; recorded ${baseline.length} earlier migrations as already applied.`);
}

async function appliedSet(conn: Conn): Promise<Set<string>> {
  const [rows] = await conn.query(`SELECT filename FROM \`${TABLE}\``);
  return new Set((rows as { filename: string }[]).map((r) => r.filename));
}

// Returns the number of statements that failed (0 = the file applied cleanly).
async function applyFile(conn: Conn, file: string): Promise<number> {
  const raw = readFileSync(file, "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`Applying ${statements.length} statements from ${file} ...`);
  let ok = 0;
  for (let i = 0; i < statements.length; i++) {
    try {
      await conn.query(statements[i]);
      ok++;
    } catch (e) {
      const msg = (e as Error).message;
      const stmt = statements[i];
      // Ignore "already exists" so this is safe to re-run.
      //
      // The last clause is narrower than it looks, and deliberately so. Re-adding a FOREIGN KEY
      // whose constraint name is already there does NOT report "already exists" on MySQL 5.7 —
      // InnoDB copies the table and complains about a duplicate key in its own temp table
      // ("Can't write; duplicate key in table '#sql-…'"). That message alone is far too generic
      // to skip on: it is also what adding a UNIQUE index over already-duplicated data says, and
      // swallowing THAT would let a broken migration record itself as applied. So the duplicate
      // -key escape is granted only to statements that are adding a foreign key, where the only
      // thing that can collide is the constraint name.
      const dupFk = /ADD\s+CONSTRAINT[\s\S]*FOREIGN\s+KEY/i.test(stmt) && /duplicate (key|foreign key)/i.test(msg);
      if (/already exists|Duplicate key name|Duplicate column name/i.test(msg) || dupFk) {
        console.log(`  · ${i + 1}/${statements.length} skipped (exists)`);
        ok++;
      } else {
        console.error(`  ✗ ${i + 1}/${statements.length}: ${msg}`);
      }
    }
  }
  console.log(`Done: ${ok}/${statements.length} statements applied.`);
  if (ok === statements.length) {
    await conn.query(
      `INSERT INTO \`${TABLE}\` (filename) VALUES (?) ON DUPLICATE KEY UPDATE applied_at = CURRENT_TIMESTAMP`,
      [fileName(file)],
    );
  }
  return statements.length - ok;
}

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url || url.includes("REPLACE_WITH_PASSWORD")) {
    console.error("✗ Set a real DATABASE_URL in .env.local first.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const pendingMode = args.includes("--pending");

  const conn = await mysql.createConnection(parseDbUrl(url));
  await ensureTable(conn);

  let files: string[];
  if (pendingMode) {
    const done = await appliedSet(conn);
    const journaled = journaledTags();
    files = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql") && !journaled.has(f) && !done.has(f))
      .sort()
      .map((f) => `${DIR}/${f}`);
    if (!files.length) console.log("No pending SQL migrations.");
  } else {
    files = args.length ? args : [`${DIR}/0000_init.sql`];
  }

  let failed = 0;
  for (const file of files) {
    const n = await applyFile(conn, file);
    failed += n;
    // Later migrations may depend on this one; don't run them on top of a half-applied file.
    if (n && pendingMode) break;
  }
  await conn.end();
  if (failed) {
    console.error(`✗ ${failed} statement(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

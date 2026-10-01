/**
 * Removes rows the e2e suite left behind in whatever database .env.local points at.
 *
 * The suite's own teardown (tests/e2e/helpers.ts) covers the tagged fixtures — "[e2e] …"
 * accounts and everything hanging off them. It never covered import_batches, and any run
 * whose `after()` hook did not complete left its sync_runs and sync_settings bookkeeping
 * behind too. This script sweeps all of that.
 *
 * Dry run by default; pass --apply to delete. Back the database up first.
 *   npx tsx scripts/purge-e2e-residue.ts
 *   npx tsx scripts/purge-e2e-residue.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import mysql from "mysql2/promise";
import { parseDbUrl } from "../src/server/lib/db-url";

// Import filenames the e2e suite commits (tests/e2e/pending.test.ts). A batch only counts
// as residue when nothing references it — a real import of yours named "stmt.pdf" keeps
// its transactions, so it survives.
const E2E_IMPORT_FILENAMES = ["stmt.pdf", "a.pdf", "b.pdf", "c.csv", "d1.csv", "d2.csv", "m.csv"];
const FAKE = "e2efake";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.local).");
  const conn = parseDbUrl(url);
  const c = await mysql.createConnection(conn);
  console.log(`${apply ? "PURGING" : "DRY RUN against"} ${conn.database} @ ${conn.host}\n`);

  const placeholders = E2E_IMPORT_FILENAMES.map(() => "?").join(",");

  // Each step: what it targets, the SELECT that shows it, the DELETE that removes it.
  const steps: { label: string; show: [string, unknown[]]; del: [string, unknown[]] }[] = [
    {
      label: "transactions from the fake provider",
      show: [`SELECT id, txn_date, description, amount, status, external_id FROM transactions WHERE source = ?`, [FAKE]],
      del: [`DELETE FROM transactions WHERE source = ?`, [FAKE]],
    },
    {
      label: "transactions on [e2e] accounts",
      show: [`SELECT t.id, t.txn_date, t.description, t.amount, t.source FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.label LIKE '[e2e]%'`, []],
      del: [`DELETE t FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.label LIKE '[e2e]%'`, []],
    },
    {
      label: "balances on [e2e] accounts",
      show: [`SELECT ab.* FROM account_balances ab JOIN accounts a ON a.id = ab.account_id WHERE a.label LIKE '[e2e]%'`, []],
      del: [`DELETE ab FROM account_balances ab JOIN accounts a ON a.id = ab.account_id WHERE a.label LIKE '[e2e]%'`, []],
    },
    {
      label: "[e2e] accounts",
      show: [`SELECT id, account_number, label FROM accounts WHERE label LIKE '[e2e]%'`, []],
      del: [`DELETE FROM accounts WHERE label LIKE '[e2e]%'`, []],
    },
    {
      label: "fake sync enrollments (cascades sync_accounts)",
      show: [`SELECT id, provider, institution_name FROM sync_enrollments WHERE provider = ?`, [FAKE]],
      del: [`DELETE FROM sync_enrollments WHERE provider = ?`, [FAKE]],
    },
    {
      label: "fake sync tombstones",
      show: [`SELECT * FROM sync_ignored WHERE source = ?`, [FAKE]],
      del: [`DELETE FROM sync_ignored WHERE source = ?`, [FAKE]],
    },
    {
      // No real provider has ever been enrolled (Teller shut down before launch), so every
      // sync_run in this database came from the fake provider. Once a real bank is wired up
      // this predicate must be narrowed — see planning/features/bank-sync.md.
      label: "sync runs (all of them: only the fake provider has ever run)",
      show: [`SELECT id, \`trigger\`, status, started_at, inserted, updated FROM sync_runs ORDER BY id`, []],
      del: [`DELETE FROM sync_runs`, []],
    },
    {
      label: "e2e import batches (only those with no transactions left)",
      show: [
        `SELECT b.id, b.filename, b.total_rows, b.created_at FROM import_batches b
         LEFT JOIN transactions t ON t.import_batch_id = b.id
         WHERE b.filename IN (${placeholders}) AND t.id IS NULL ORDER BY b.id`,
        E2E_IMPORT_FILENAMES,
      ],
      del: [
        `DELETE b FROM import_batches b
         LEFT JOIN transactions t ON t.import_batch_id = b.id
         WHERE b.filename IN (${placeholders}) AND t.id IS NULL`,
        E2E_IMPORT_FILENAMES,
      ],
    },
    {
      label: "e2e category rule",
      show: [`SELECT id, pattern, category FROM category_mappings WHERE pattern = 'E2E-RULE'`, []],
      del: [`DELETE FROM category_mappings WHERE pattern = 'E2E-RULE'`, []],
    },
    {
      label: "placeholder periods from the far-future fixtures",
      show: [`SELECT id, year, month FROM periods WHERE year >= 2031`, []],
      del: [`DELETE FROM periods WHERE year >= 2031`, []],
    },
  ];

  for (const s of steps) {
    const [rows] = await c.query(s.show[0], s.show[1]);
    const list = rows as unknown[];
    console.log(`• ${s.label}: ${list.length}`);
    for (const r of list.slice(0, 8)) console.log(`    ${JSON.stringify(r)}`);
    if (list.length > 8) console.log(`    … ${list.length - 8} more`);
    if (apply && list.length) {
      const [res] = await c.query(s.del[0], s.del[1]);
      console.log(`    deleted ${(res as mysql.ResultSetHeader).affectedRows}`);
    }
  }

  // Scheduler bookkeeping the e2e suite moved. last_run_id points at a run this script just
  // deleted; the timestamps are from fake runs and webhooks.
  const [[settings]] = (await c.query(
    `SELECT last_run_id, last_webhook_at, next_run_at, lock_until FROM sync_settings WHERE id = 1`,
  )) as [Record<string, unknown>[], unknown];
  console.log(`\n• sync_settings bookkeeping: ${JSON.stringify(settings)}`);
  if (apply) {
    await c.query(
      `UPDATE sync_settings SET last_run_id = NULL, last_webhook_at = NULL, next_run_at = NULL, lock_until = NULL WHERE id = 1`,
    );
    console.log(`    reset last_run_id / last_webhook_at / next_run_at / lock_until to NULL`);
  }

  await c.end();
  console.log(apply ? "\nDone." : "\nDry run — nothing deleted. Re-run with --apply.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

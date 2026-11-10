/**
 * Fills the database with a fictional household's finances — accounts, six months of
 * transactions, bills, a budget, goals — so every page has something to show. Handy for
 * looking around before you import your own data, and it is what the public demo runs on.
 *
 * Every name and number is made up, and dated relative to today.
 *
 *   npm run seed:demo              into an EMPTY ledger (refuses if transactions exist)
 *   npm run seed:demo -- --reset   REPLACE everything in the ledger with the demo data
 *
 * --reset deletes your accounts, transactions, bills, budgets and goals. It keeps sign-in
 * (users) and the migration ledger. Don't point it at a database you care about.
 *
 * Set SYNC_TOKEN_ENCRYPTION_KEY (openssl rand -hex 32) to also get the pretend "Demo Bank"
 * connection; run the app with DEMO_MODE=1 for its Sync button to work.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import mysql from "mysql2/promise";
import { parseDbUrl } from "../src/server/lib/db-url";
import { seedDemo } from "../src/server/lib/demo/seed";

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");
  const today = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ Set DATABASE_URL in .env.local first.");
    process.exit(1);
  }
  const target = parseDbUrl(url);
  const pool = mysql.createPool(target);
  try {
    const [rows] = await pool.query("SELECT COUNT(*) AS c FROM transactions");
    const existing = Number((rows as { c: number }[])[0].c);
    if (existing > 0 && !reset) {
      console.error(
        `✗ ${target.database} @ ${target.host} already has ${existing} transaction(s).\n` +
          "  The demo seed only fills an empty ledger. To REPLACE what is there with demo data:\n" +
          "      npm run seed:demo -- --reset",
      );
      process.exit(1);
    }
    if (reset) console.log(`Replacing the ledger in ${target.database} @ ${target.host} with demo data…`);
    const { summary } = await seedDemo(pool, { reset, today });
    console.log(`✓ Demo data seeded for ${summary.months[0]} … ${summary.months[summary.months.length - 1]} (today = ${summary.today})`);
    console.log(
      `  ${summary.accounts} accounts, ${summary.bills} bills (${summary.billInstances} monthly rows), ${summary.transactions} transactions ` +
        `(${summary.uncategorized} uncategorized, ${summary.pending} pending)`,
    );
    console.log(
      `  ${summary.balanceSnapshots} balance snapshots, ${summary.rules} rules, ${summary.budgets} budgets, ${summary.goals} goals, ${summary.insights} insights`,
    );
    console.log(
      summary.bankLinked
        ? "  Demo Bank linked. Run the app with DEMO_MODE=1 and press Sync now under Settings → Bank sync."
        : "  Demo Bank NOT linked: set SYNC_TOKEN_ENCRYPTION_KEY (openssl rand -hex 32) and re-run with --reset to add it.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

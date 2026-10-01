-- Cleanup: the legacy debts / debt_balances ledger has been folded into
-- accounts + account_balances (see scripts/migrate-debts-to-accounts.ts). These tables are
-- now unused backups. Run ONLY after confirming the migrated liability data looks correct:
--   npx tsx scripts/apply-sql.ts drizzle/0008_drop_debts.sql
-- Then remove the `debts` / `debtBalances` table defs + Debt/DebtBalance types from schema.ts.
DROP TABLE IF EXISTS `debt_balances`;--> statement-breakpoint
DROP TABLE IF EXISTS `debts`;

-- Budgets: opt-in auto-rebalance. When set, every write to a budget (income, a spending line, a
-- debt line other than the target) re-derives the target's payment as income − every other line,
-- so the snowball keeps sweeping the leftover without a manual "Rebalance" click.
-- Apply with: npx tsx scripts/apply-sql.ts drizzle/0018_budget_auto_rebalance.sql
ALTER TABLE `budgets` ADD COLUMN `auto_rebalance` boolean NOT NULL DEFAULT false;

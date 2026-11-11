-- Closing out a month: `finalized_at` freezes the plan (budget writes refuse while it's set) and
-- `outcome` keeps the month's report as it stood when it was closed (server/lib/budget-outcome.ts).
-- Reopening a month clears both.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0031_budget_finalize.sql
ALTER TABLE `budgets` ADD COLUMN `finalized_at` timestamp NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `budgets` ADD COLUMN `outcome` json NULL;

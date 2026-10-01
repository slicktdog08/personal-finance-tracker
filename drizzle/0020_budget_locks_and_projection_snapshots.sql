-- Two additions for the budget's second iteration.
--
-- 1. budget_lines.locked — a pinned line. Locked lines can't be edited or used as a "move money"
--    source without unlocking, and a locked TARGET is a standing override: auto-rebalance leaves
--    it alone. Same idea as the wizard's 🔒, now persisted on the saved plan.
--
-- 2. projection_snapshots — one row per (period, day) recording what the cash projection said
--    that day: projected month-end cash, low point, high-interest debt at horizon, and the
--    everyday spending still expected. Written the first time the projection is computed on a
--    given day, never overwritten, so "am I trending above or below what I projected a week ago?"
--    has something to compare against. Small rows; one per day per month at most.
--
-- Apply with: npx tsx scripts/apply-sql.ts drizzle/0020_budget_locks_and_projection_snapshots.sql
ALTER TABLE `budget_lines` ADD COLUMN `locked` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE `projection_snapshots` (
  `id` int AUTO_INCREMENT NOT NULL,
  `period_id` int NOT NULL,
  `taken_on` date NOT NULL,
  `as_of` date NOT NULL,
  `cash_now` decimal(12,2) NOT NULL,
  `end_balance` decimal(12,2) NOT NULL,
  `horizon_balance` decimal(12,2) NOT NULL,
  `low_balance` decimal(12,2) NOT NULL,
  `low_date` date NOT NULL,
  `spread_total` decimal(12,2) NOT NULL,
  `hot_end` decimal(12,2) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `projection_snapshots_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_proj_snap` UNIQUE(`period_id`,`taken_on`)
);
--> statement-breakpoint
ALTER TABLE `projection_snapshots` ADD CONSTRAINT `fk_ps_period` FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON DELETE CASCADE;

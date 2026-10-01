-- Budgets: what you PLAN to spend in a month, laid against what the transactions say you
-- actually spent. A budget belongs to one period (one per month) and is a list of lines.
--
-- Two kinds of line:
--   * category — matches transactions by `category`; actual = that month's net spend in the
--     category, computed with the same rule as the dashboard (cash offsets + pocket count).
--   * debt     — one liability account; actual = Debit payments in the month linked to the
--     account's bill (transactions.bill_id = accounts.bill_id).
--
-- `mode` records which generator produced the plan (debt_snowball | manual), `strategy` the
-- debt ordering (snowball = smallest balance first, avalanche = highest APR first). Both are
-- VARCHAR + a const in enums.ts so a new mode needs no migration. `planned_income` is the
-- month's expected take-home (defaulted from pay_schedule; editable).
--
-- Lines: `planned` is the full planned amount. Debt lines also snapshot `minimum` (the min
-- payment at planning time) so "min + extra" stays legible after the account's minimum moves,
-- and `is_target` marks the one debt the snowball's extra goes to.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0017_add_budgets.sql
CREATE TABLE `budgets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `period_id` int NOT NULL,
  `mode` varchar(32) NOT NULL DEFAULT 'manual',
  `strategy` varchar(32),
  `planned_income` decimal(12,2),
  `notes` text,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `budgets_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_budget_period` UNIQUE(`period_id`)
);
--> statement-breakpoint
ALTER TABLE `budgets` ADD CONSTRAINT `fk_budget_period` FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`);
--> statement-breakpoint
CREATE TABLE `budget_lines` (
  `id` int AUTO_INCREMENT NOT NULL,
  `budget_id` int NOT NULL,
  `kind` varchar(16) NOT NULL,
  `label` varchar(191) NOT NULL,
  `category` varchar(48),
  `account_id` int,
  `planned` decimal(12,2) NOT NULL DEFAULT '0.00',
  `minimum` decimal(12,2),
  `is_target` boolean NOT NULL DEFAULT false,
  `sort_order` int NOT NULL DEFAULT 0,
  `notes` varchar(255),
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `budget_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_bl_budget` ON `budget_lines` (`budget_id`);
--> statement-breakpoint
CREATE INDEX `idx_bl_account` ON `budget_lines` (`account_id`);
--> statement-breakpoint
ALTER TABLE `budget_lines` ADD CONSTRAINT `fk_bl_budget` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `budget_lines` ADD CONSTRAINT `fk_bl_account` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL;

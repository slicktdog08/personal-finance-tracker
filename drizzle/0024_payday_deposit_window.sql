-- Payday↔deposit reconciliation (planning/features/budget.md).
--
-- A schedule row says "$3,000.01 on the 21st"; the bank pays it as a split direct deposit whose
-- halves can land on the 20th and the 22nd. The projection now nets a scheduled payday against
-- the payroll credits that actually arrived within `deposit_window_days` of it, so the half
-- already inside the recorded balance isn't added a second time. `deposit_match` is the
-- case-insensitive regex that says which credits read as payroll.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0024_payday_deposit_window.sql
ALTER TABLE `pay_schedule` ADD COLUMN `deposit_window_days` int NOT NULL DEFAULT 3;--> statement-breakpoint
ALTER TABLE `pay_schedule` ADD COLUMN `deposit_match` varchar(255) NULL;

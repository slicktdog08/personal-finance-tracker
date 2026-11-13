-- Where a balance snapshot came from. NULL = recorded by hand (or by bank sync, which marks
-- its rows in `note`); 'statement' = a statement's opening/closing balance; 'statement-daily'
-- = an end-of-day balance read off a statement's running-balance column. Imported rows can be
-- refreshed by a later import of the same statement and folded out of the history list;
-- hand-entered rows are never touched by an import.
--
-- The UPDATE tags opening/closing snapshots imported before this column existed — their
-- note is always "<institution> opening|closing balance (<Month YYYY>)".
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts --pending
ALTER TABLE `account_balances` ADD COLUMN `source` varchar(24) NULL AFTER `note`;--> statement-breakpoint
UPDATE `account_balances` SET `source` = 'statement'
  WHERE `source` IS NULL AND `note` REGEXP ' (opening|closing) balance \\([A-Z][a-z]+ [0-9]{4}\\)$';

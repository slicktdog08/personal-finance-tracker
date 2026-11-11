-- Rules grow beyond "text → category":
--   * extra conditions — lock a rule to one account, one direction, and/or an amount range
--     (the amount range is what tells apart two card payments with the same statement line);
--   * a second action — link the matching transaction to a recurring bill (and to that bill's
--     instance on the transaction's month), so repeat bill payments link themselves.
-- `category` becomes nullable because a rule may now only link a bill.
--
-- transactions.bill_rule_id is the bill-link twin of category_rule_id: which rule linked the
-- bill (null = linked by hand). Rules never overwrite a link made by hand, and editing or
-- deleting a rule can undo exactly the links it made. SET NULL on rule delete.
--
-- An account-locked rule is deleted with its account (CASCADE): leaving it behind unlocked would
-- silently widen it to every account.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts --pending
ALTER TABLE `category_mappings` MODIFY `category` varchar(48) NULL;--> statement-breakpoint
ALTER TABLE `category_mappings` ADD COLUMN `account_id` int NULL AFTER `field`;--> statement-breakpoint
ALTER TABLE `category_mappings` ADD COLUMN `direction` varchar(8) NULL AFTER `account_id`;--> statement-breakpoint
ALTER TABLE `category_mappings` ADD COLUMN `amount_min` decimal(12,2) NULL AFTER `direction`;--> statement-breakpoint
ALTER TABLE `category_mappings` ADD COLUMN `amount_max` decimal(12,2) NULL AFTER `amount_min`;--> statement-breakpoint
ALTER TABLE `category_mappings` ADD CONSTRAINT `category_mappings_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD COLUMN `bill_rule_id` int NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_bill_rule_id_category_mappings_id_fk` FOREIGN KEY (`bill_rule_id`) REFERENCES `category_mappings`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_tx_bill_rule` ON `transactions` (`bill_rule_id`);

-- Rule provenance for categories: which saved rule (category_mappings) set a
-- transaction's category. Null = set by hand, or categorized before this was
-- tracked. Written by import, "apply saved rules" and rule-saving bulk
-- categorize; cleared whenever the category is set manually. SET NULL on rule
-- delete so removing a rule never fails on a FK.
--
-- Numbered 0020 (0019 was taken by a parallel session). Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0020_add_txn_category_rule.sql
ALTER TABLE `transactions` ADD COLUMN `category_rule_id` int NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_category_rule_id_category_mappings_id_fk` FOREIGN KEY (`category_rule_id`) REFERENCES `category_mappings`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_tx_cat_rule` ON `transactions` (`category_rule_id`);

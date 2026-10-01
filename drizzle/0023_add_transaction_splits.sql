-- Transaction splits: categorize pieces of one transaction differently — $60 of a $100 Target
-- run is Groceries, $40 is Household.
--
-- Same shape as cash offsets (0016): the bank row itself can't be cut into two rows, because
-- it's re-imported from the statement and has to keep matching it. So the pieces live beside
-- it. One row = "$X of transaction T belongs in category C". The transaction's own category
-- keeps whatever the pieces don't claim (amount - SUM(pieces)), so the parts always add back
-- up to the full transaction by construction — there's no second number to drift.
--
-- ON DELETE CASCADE: a piece is meaningless without its transaction.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0023_add_transaction_splits.sql
CREATE TABLE `transaction_splits` (
  `id` int AUTO_INCREMENT NOT NULL,
  `txn_id` int NOT NULL,
  `category` varchar(48) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `transaction_splits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ts_txn` ON `transaction_splits` (`txn_id`);
--> statement-breakpoint
CREATE INDEX `idx_ts_cat` ON `transaction_splits` (`category`);
--> statement-breakpoint
ALTER TABLE `transaction_splits` ADD CONSTRAINT `fk_ts_txn` FOREIGN KEY (`txn_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE;

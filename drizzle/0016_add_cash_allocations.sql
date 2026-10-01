-- Cash offsets: tie money spent out of the physical-cash wallet back to the
-- withdrawal that funded it.
--
-- The problem: an ATM withdrawal imported from the bank ($300 Debit, category
-- "Cash") and the hand-entered purchases it paid for (on the 9999 wallet
-- account) are THE SAME MONEY, so counting both doubles the spend. The bank row
-- can't be edited down — it's re-imported from the statement — so the link
-- lives beside it instead.
--
-- One row = "$X of withdrawal W was spent on purchase S". An amount per link
-- (rather than a plain FK on the spend) is what makes the accounting exact: one
-- $300 withdrawal covers many purchases, and one purchase can be paid from two
-- withdrawals. A withdrawal's UNALLOCATED remainder (amount - SUM(allocations))
-- is what still counts as spending — cash that walked off unaccounted for.
--
-- ON DELETE CASCADE both ways: an allocation is meaningless without both sides.
--
-- Numbered 0016 (0014 is reserved by a parallel session). Hand-written like
-- 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0016_add_cash_allocations.sql
CREATE TABLE `cash_allocations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `withdrawal_txn_id` int NOT NULL,
  `spend_txn_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `cash_allocations_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_cash_alloc` UNIQUE(`withdrawal_txn_id`,`spend_txn_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ca_withdrawal` ON `cash_allocations` (`withdrawal_txn_id`);
--> statement-breakpoint
CREATE INDEX `idx_ca_spend` ON `cash_allocations` (`spend_txn_id`);
--> statement-breakpoint
ALTER TABLE `cash_allocations` ADD CONSTRAINT `fk_ca_withdrawal` FOREIGN KEY (`withdrawal_txn_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `cash_allocations` ADD CONSTRAINT `fk_ca_spend` FOREIGN KEY (`spend_txn_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
-- The wallet itself becomes its own account type so "which account is cash?" is
-- data, not a hardcoded 9999 — a second wallet (Apple Cash) can be added later.
UPDATE `accounts` SET `account_type` = 'Cash' WHERE `account_number` = '9999' AND `label` = 'Cash';

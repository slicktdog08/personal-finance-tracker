-- Pending transactions: a charge entered by hand before it posts (card holds, tips not yet
-- settled) — the bank's export doesn't carry pending rows, so this is the only place they
-- live until the statement catches up. When the posted row arrives (via import) it is
-- matched to the pending one by account + direction + nearby date + roughly-equal amount
-- and the two are merged, so the charge is never counted twice.
-- See planning/features/pending-transactions.md.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0022_add_txn_pending.sql
ALTER TABLE `transactions` ADD COLUMN `pending` boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX `idx_tx_pending` ON `transactions` (`pending`);

-- Review follow-ups for bank sync (planning/features/bank-sync.md):
--  * sync_ignored — tombstones for synced rows the user deleted, so the next run does not
--    re-insert them while they are still inside the re-query window.
--  * one external account per local account — two bank accounts feeding one ledger account
--    would each expire the other's pending rows every run.
-- Hand-written like 0005+. Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0023_sync_ignored_and_unique_mapping.sql
CREATE TABLE `sync_ignored` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(16) NOT NULL,
	`external_id` varchar(64) NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sync_ignored_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sync_ignored` UNIQUE(`source`,`external_id`)
);--> statement-breakpoint
ALTER TABLE `sync_accounts` ADD CONSTRAINT `uq_sync_account_local` UNIQUE(`account_id`);

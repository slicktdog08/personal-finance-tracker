-- Bank sync (planning/features/bank-sync.md): provider-agnostic sync tables + the three
-- transaction columns synced rows need (source / external_id / status). Existing rows
-- backfill to source='import', status='posted' via the column defaults.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0022_bank_sync.sql
ALTER TABLE `transactions` ADD COLUMN `source` varchar(16) NOT NULL DEFAULT 'import';--> statement-breakpoint
ALTER TABLE `transactions` ADD COLUMN `external_id` varchar(64) NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD COLUMN `status` varchar(12) NOT NULL DEFAULT 'posted';--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `uq_tx_external` UNIQUE(`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_status` ON `transactions` (`status`);--> statement-breakpoint
CREATE TABLE `sync_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`interval_minutes` int NOT NULL DEFAULT 180,
	`sync_window_days` int NOT NULL DEFAULT 10,
	`pending_expiry_days` int NOT NULL DEFAULT 7,
	`record_balances` boolean NOT NULL DEFAULT true,
	`auto_categorize` boolean NOT NULL DEFAULT true,
	`webhook_enabled` boolean NOT NULL DEFAULT true,
	`lock_until` timestamp NULL,
	`next_run_at` timestamp NULL,
	`last_run_id` int,
	`last_webhook_at` timestamp NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sync_settings_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
CREATE TABLE `sync_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(16) NOT NULL,
	`enrollment_id` varchar(64) NOT NULL,
	`institution_id` varchar(64),
	`institution_name` varchar(128),
	`provider_user_id` varchar(64),
	`access_token_enc` text NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`disconnect_reason` varchar(64),
	`enrolled_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`last_synced_at` timestamp NULL,
	`last_error` text,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sync_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sync_enrollment` UNIQUE(`provider`,`enrollment_id`)
);--> statement-breakpoint
CREATE TABLE `sync_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enrollment_id` int NOT NULL,
	`external_account_id` varchar(64) NOT NULL,
	`name` varchar(128),
	`type` varchar(16),
	`subtype` varchar(32),
	`last_four` varchar(4),
	`currency` varchar(3),
	`account_id` int,
	`enabled` boolean NOT NULL DEFAULT true,
	`sync_balances` boolean NOT NULL DEFAULT true,
	`sync_from` date,
	`external_status` varchar(16) NOT NULL DEFAULT 'open',
	`last_synced_at` timestamp NULL,
	`last_error` text,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sync_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sync_account` UNIQUE(`external_account_id`)
);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trigger` varchar(16) NOT NULL,
	`enrollment_id` int,
	`status` varchar(12) NOT NULL DEFAULT 'running',
	`dry_run` boolean NOT NULL DEFAULT false,
	`started_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`finished_at` timestamp NULL,
	`inserted` int NOT NULL DEFAULT 0,
	`updated` int NOT NULL DEFAULT 0,
	`promoted` int NOT NULL DEFAULT 0,
	`expired` int NOT NULL DEFAULT 0,
	`skipped_dupes` int NOT NULL DEFAULT 0,
	`balances_recorded` int NOT NULL DEFAULT 0,
	`error` text,
	`details` json,
	CONSTRAINT `sync_runs_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
ALTER TABLE `sync_accounts` ADD CONSTRAINT `sync_accounts_enrollment_id_sync_enrollments_id_fk` FOREIGN KEY (`enrollment_id`) REFERENCES `sync_enrollments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_accounts` ADD CONSTRAINT `sync_accounts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD CONSTRAINT `sync_runs_enrollment_id_sync_enrollments_id_fk` FOREIGN KEY (`enrollment_id`) REFERENCES `sync_enrollments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_sa_enrollment` ON `sync_accounts` (`enrollment_id`);--> statement-breakpoint
CREATE INDEX `idx_sa_account` ON `sync_accounts` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_sr_started` ON `sync_runs` (`started_at`);--> statement-breakpoint
-- Seed the singleton. ON DUPLICATE KEY so re-running the file is a no-op rather than a
-- "Duplicate entry '1' for key 'PRIMARY'" that would fail the deploy's APPLY_SQL stage.
INSERT INTO `sync_settings` (`id`) VALUES (1) ON DUPLICATE KEY UPDATE `id` = `id`;

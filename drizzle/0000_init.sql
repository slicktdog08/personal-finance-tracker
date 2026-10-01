CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_number` varchar(8) NOT NULL,
	`label` varchar(64),
	`institution` varchar(64),
	`account_type` varchar(32),
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_acct` UNIQUE(`account_number`)
);
--> statement-breakpoint
CREATE TABLE `bill_instances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`period_id` int NOT NULL,
	`bill_id` int,
	`name` varchar(191) NOT NULL,
	`amount` decimal(10,2),
	`status` varchar(32) NOT NULL,
	`due_day` tinyint,
	`payment_type` varchar(32),
	`is_debt` boolean NOT NULL DEFAULT false,
	`is_cancel` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bill_instances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(191) NOT NULL,
	`default_amount` decimal(10,2),
	`default_due_day` tinyint,
	`default_payment_type` varchar(32),
	`is_debt` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`notes` text,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bill_name` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `category_mappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`match_type` varchar(12) NOT NULL,
	`pattern` varchar(255) NOT NULL,
	`field` varchar(16) NOT NULL DEFAULT 'description',
	`category` varchar(48) NOT NULL,
	`bill_id` int,
	`priority` int NOT NULL DEFAULT 100,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `category_mappings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(255) NOT NULL,
	`source` varchar(64),
	`account_id` int,
	`total_rows` int NOT NULL,
	`inserted_count` int NOT NULL,
	`duplicate_count` int NOT NULL,
	`error_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `import_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `periods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`year` smallint NOT NULL,
	`month` tinyint NOT NULL,
	`label` varchar(20) NOT NULL,
	`start_date` date,
	`end_date` date,
	`notes` text,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_period` UNIQUE(`year`,`month`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int,
	`period_id` int,
	`bill_instance_id` int,
	`txn_date` date NOT NULL,
	`description` varchar(512) NOT NULL,
	`category` varchar(48),
	`amount` decimal(12,2) NOT NULL,
	`net_amount` decimal(12,2),
	`direction` varchar(8) NOT NULL,
	`dedup_hash` char(64) NOT NULL,
	`import_batch_id` int,
	`raw` json,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dedup` UNIQUE(`dedup_hash`)
);
--> statement-breakpoint
ALTER TABLE `bill_instances` ADD CONSTRAINT `bill_instances_period_id_periods_id_fk` FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_instances` ADD CONSTRAINT `bill_instances_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `category_mappings` ADD CONSTRAINT `category_mappings_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_period_id_periods_id_fk` FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_bill_instance_id_bill_instances_id_fk` FOREIGN KEY (`bill_instance_id`) REFERENCES `bill_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_import_batch_id_import_batches_id_fk` FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_bi_period` ON `bill_instances` (`period_id`);--> statement-breakpoint
CREATE INDEX `idx_bi_bill` ON `bill_instances` (`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_bill_active` ON `bills` (`active`);--> statement-breakpoint
CREATE INDEX `idx_tx_date` ON `transactions` (`txn_date`);--> statement-breakpoint
CREATE INDEX `idx_tx_acct` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_cat` ON `transactions` (`category`);
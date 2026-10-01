CREATE TABLE `account_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`balance` decimal(12,2) NOT NULL,
	`as_of` date NOT NULL,
	`note` varchar(255),
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `account_balances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bill_statuses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(32) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#9ca3af',
	`is_settled` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bill_statuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_status_name` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `payment_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(32) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#9ca3af',
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ptype_name` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `account_balances` ADD CONSTRAINT `account_balances_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_ab_acct` ON `account_balances` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_ab_date` ON `account_balances` (`as_of`);
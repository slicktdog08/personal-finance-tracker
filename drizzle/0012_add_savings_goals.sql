CREATE TABLE `savings_goals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(191) NOT NULL,
	`goal_type` varchar(32) NOT NULL DEFAULT 'savings',
	`target_amount` decimal(12,2) NOT NULL,
	`target_date` date,
	`funding_account_id` int,
	`color` varchar(16) NOT NULL DEFAULT '#3b82f6',
	`emoji` varchar(16),
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`sort_order` int NOT NULL DEFAULT 0,
	`notes` text,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `savings_goals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `goal_contributions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`goal_id` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`occurred_on` date NOT NULL,
	`note` varchar(255),
	`transaction_id` int,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `goal_contributions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `savings_goals` ADD CONSTRAINT `savings_goals_funding_account_id_accounts_id_fk` FOREIGN KEY (`funding_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goal_contributions` ADD CONSTRAINT `goal_contributions_goal_id_savings_goals_id_fk` FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goal_contributions` ADD CONSTRAINT `goal_contributions_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_goal_status` ON `savings_goals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_goal_acct` ON `savings_goals` (`funding_account_id`);--> statement-breakpoint
CREATE INDEX `idx_gc_goal` ON `goal_contributions` (`goal_id`);--> statement-breakpoint
CREATE INDEX `idx_gc_date` ON `goal_contributions` (`occurred_on`);

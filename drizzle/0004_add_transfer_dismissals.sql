CREATE TABLE `transfer_dismissals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`low_id` int NOT NULL,
	`high_id` int NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `transfer_dismissals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dismissal` UNIQUE(`low_id`,`high_id`)
);
--> statement-breakpoint
ALTER TABLE `account_balances` ADD `credit_limit` decimal(12,2);--> statement-breakpoint
ALTER TABLE `bill_statuses` ADD `emoji` varchar(16);--> statement-breakpoint
ALTER TABLE `categories` ADD `emoji` varchar(16);--> statement-breakpoint
ALTER TABLE `payment_types` ADD `emoji` varchar(16);
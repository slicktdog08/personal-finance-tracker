ALTER TABLE `account_balances` ADD `apr` decimal(5,2);--> statement-breakpoint
ALTER TABLE `account_balances` ADD `min_payment` decimal(10,2);--> statement-breakpoint
ALTER TABLE `accounts` ADD `original_principal` decimal(12,2);--> statement-breakpoint
ALTER TABLE `accounts` ADD `opened_on` date;--> statement-breakpoint
ALTER TABLE `accounts` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `active` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `accounts` ADD `bill_id` int;--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_acct_bill` ON `accounts` (`bill_id`);

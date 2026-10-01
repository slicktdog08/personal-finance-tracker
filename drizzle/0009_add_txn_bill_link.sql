ALTER TABLE `transactions` ADD `bill_id` int;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_tx_bill` ON `transactions` (`bill_id`);

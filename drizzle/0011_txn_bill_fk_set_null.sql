ALTER TABLE `transactions` DROP FOREIGN KEY `transactions_bill_instance_id_bill_instances_id_fk`;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_bill_instance_id_bill_instances_id_fk` FOREIGN KEY (`bill_instance_id`) REFERENCES `bill_instances`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` DROP FOREIGN KEY `transactions_bill_id_bills_id_fk`;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE set null ON UPDATE no action;

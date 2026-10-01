CREATE TABLE `debts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`original_principal` decimal(12,2),
	`opened_on` date,
	`notes` text,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `debts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_debt_bill` UNIQUE(`bill_id`)
);
--> statement-breakpoint
CREATE TABLE `debt_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`debt_id` int NOT NULL,
	`balance` decimal(12,2) NOT NULL,
	`apr` decimal(5,2),
	`min_payment` decimal(10,2),
	`as_of` date NOT NULL,
	`note` varchar(255),
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `debt_balances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `debts` ADD CONSTRAINT `debts_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `debt_balances` ADD CONSTRAINT `debt_balances_debt_id_debts_id_fk` FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_db_debt` ON `debt_balances` (`debt_id`);--> statement-breakpoint
CREATE INDEX `idx_db_date` ON `debt_balances` (`as_of`);

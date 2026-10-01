CREATE TABLE `suggestion_dismissals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchant_key` varchar(191) NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `suggestion_dismissals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_suggestion_key` UNIQUE(`merchant_key`)
);

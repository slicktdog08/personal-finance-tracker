CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(48) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#9ca3af',
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_category_name` UNIQUE(`name`)
);

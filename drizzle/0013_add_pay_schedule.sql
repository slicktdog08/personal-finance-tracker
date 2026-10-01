-- Pay schedule: single-row config (always id = 1) driving the dashboard payday countdown.
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0013_add_pay_schedule.sql
CREATE TABLE `pay_schedule` (
	`id` int AUTO_INCREMENT NOT NULL,
	`frequency` varchar(32) NOT NULL DEFAULT 'semimonthly',
	`day_one` int,
	`day_two` int,
	`anchor_date` date,
	`take_home` decimal(12,2),
	`active` boolean NOT NULL DEFAULT true,
	`notes` text,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pay_schedule_id` PRIMARY KEY(`id`)
);

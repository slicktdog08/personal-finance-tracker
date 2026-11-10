-- Assets: things owned that hold value but aren't money (a car, a house). Each has a dated value
-- ledger; both count toward net worth, never toward cash on hand. Retirement accounts (401k/IRA)
-- need no schema change — they're a new accounts.account_type value ("Retirement").
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0027_add_assets.sql
CREATE TABLE `assets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(96) NOT NULL,
  `kind` varchar(32) NOT NULL DEFAULT 'other',
  `purchase_price` decimal(12,2),
  `acquired_on` date,
  `notes` text,
  `active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `asset_values` (
  `id` int AUTO_INCREMENT NOT NULL,
  `asset_id` int NOT NULL,
  `value` decimal(12,2) NOT NULL,
  `as_of` date NOT NULL,
  `note` varchar(255),
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_av_asset` (`asset_id`),
  KEY `idx_av_date` (`as_of`),
  CONSTRAINT `asset_values_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

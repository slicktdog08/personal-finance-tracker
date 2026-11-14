-- Numbers an account used to go by. A reissued card changes its last four, and imports
-- recognize an account by that number alone — so an old statement used to create a second
-- account. Merging the old account into the current one records the old number here, and
-- every import lookup resolves it to the surviving account.
--
-- Additive only: nothing is merged by this migration. Merging is a user action on /accounts.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts --pending
CREATE TABLE `account_aliases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `account_id` int NOT NULL,
  `account_number` varchar(8) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_alias_number` (`account_number`),
  KEY `idx_alias_acct` (`account_id`),
  CONSTRAINT `account_aliases_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

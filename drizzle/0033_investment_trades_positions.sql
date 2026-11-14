-- Investment accounts (brokerage, crypto): a structured home for what a statement shows beyond
-- cash. `investment_trades` is every holdings movement — a buy, a sale, an option opening or
-- expiring, coins withdrawn. `investment_positions` is what was held at a statement's close.
--
-- Neither feeds spending or income: a trade swaps cash for holdings inside an account whose
-- balance (account_balances) is already its whole value. Cash events on the same statement
-- (dividends, fees, card purchases) stay in `transactions`.
--
-- `dedup_hash` makes a re-import of the same statement a no-op, exactly as on transactions.
-- Positions have no natural key (two option contracts share an underlying symbol), so an
-- import replaces the whole snapshot for its account + date.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts --pending
CREATE TABLE `investment_trades` (
  `id` int AUTO_INCREMENT NOT NULL,
  `account_id` int NOT NULL,
  `trade_date` date NOT NULL,
  `kind` varchar(8) NOT NULL,
  `action` varchar(16) NOT NULL,
  `asset_class` varchar(8) NOT NULL,
  `symbol` varchar(32),
  `name` varchar(255) NOT NULL,
  `quantity` decimal(24,8),
  `price` decimal(18,8),
  `amount` decimal(12,2),
  `direction` varchar(8),
  `dedup_hash` char(64) NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'pdf',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_it_dedup` (`dedup_hash`),
  KEY `idx_it_acct_date` (`account_id`, `trade_date`),
  KEY `idx_it_symbol` (`symbol`),
  CONSTRAINT `investment_trades_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE `investment_positions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `account_id` int NOT NULL,
  `as_of` date NOT NULL,
  `asset_class` varchar(8) NOT NULL,
  `symbol` varchar(32),
  `name` varchar(255) NOT NULL,
  `quantity` decimal(24,8) NOT NULL,
  `price` decimal(18,8),
  `market_value` decimal(14,2),
  `source` varchar(32) NOT NULL DEFAULT 'pdf',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ip_acct_date` (`account_id`, `as_of`),
  CONSTRAINT `investment_positions_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

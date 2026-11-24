-- Spending Pace one-off tags: a transaction the user marked as a one-off (car repair, annual
-- bill, planned trip), so the pace monitor either leaves it out (`exclude`) or spreads it evenly
-- over the configured number of days (`spread`, default 90). Tagging is always the user's choice;
-- nothing writes here automatically. Cascades with the transaction.
--
-- The monitor's settings and its notification state live in app_settings (keys `spending_pace`
-- and `spending_pace_state`), which needs no migration. See planning/features/spending-pace.md.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts --pending
CREATE TABLE `pace_one_offs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `txn_id` int NOT NULL,
  `mode` varchar(8) NOT NULL DEFAULT 'spread',
  `note` varchar(255),
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pace_one_off_txn` (`txn_id`),
  CONSTRAINT `pace_one_offs_txn_id_fk` FOREIGN KEY (`txn_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

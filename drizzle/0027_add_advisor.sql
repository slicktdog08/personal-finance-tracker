-- The AI advisor channel: the app fires a Claude Code routine (no API credit), and the routine
-- reports back through the MCP connector. Four tables, all written only by the advisor tools
-- and the Insights / Advisor pages — never by the ledger code.
--
--   advisor_runs      one row per routine run (queued by the app, or opened by a scheduled run)
--   advisor_insights  findings Claude saved; dedupe_key keeps one row per finding across runs
--   advisor_threads   conversations started from /advisor
--   advisor_messages  the turns of each thread; the user's stay pending until a run answers
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0027_add_advisor.sql
CREATE TABLE `advisor_threads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(160) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_at_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint

CREATE TABLE `advisor_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kind` varchar(16) NOT NULL,                       -- insights | checkin | chat
  `trigger_source` varchar(16) NOT NULL DEFAULT 'app', -- app | cron | manual
  `status` varchar(12) NOT NULL DEFAULT 'queued',    -- queued | running | ok | failed
  `routine` varchar(96) NULL,
  `thread_id` int NULL,
  `session_url` varchar(512) NULL,
  `summary` text NULL,
  `report` mediumtext NULL,                          -- a check-in's full write-up
  `insights_saved` int NOT NULL DEFAULT 0,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ar_started` (`started_at`),
  KEY `idx_ar_kind_status` (`kind`, `status`),
  CONSTRAINT `fk_ar_thread` FOREIGN KEY (`thread_id`) REFERENCES `advisor_threads` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint

CREATE TABLE `advisor_insights` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dedupe_key` varchar(96) NOT NULL,
  `category` varchar(24) NOT NULL DEFAULT 'other',
  `severity` varchar(8) NOT NULL DEFAULT 'info',     -- info | watch | act
  `status` varchar(12) NOT NULL DEFAULT 'new',       -- new | seen | done | dismissed
  `title` varchar(200) NOT NULL,
  `body` text NOT NULL,
  `amount` decimal(12,2) NULL,                       -- the dollar impact, when there is one
  `period_label` varchar(7) NULL,                    -- YYYY-MM the finding is about
  `search` varchar(120) NULL,                        -- a /transactions?q= search that shows the evidence
  `transaction_ids` json NULL,
  `occurrences` int NOT NULL DEFAULT 1,
  `run_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_key` (`dedupe_key`),
  KEY `idx_ai_status` (`status`, `last_seen_at`),
  CONSTRAINT `fk_ai_run` FOREIGN KEY (`run_id`) REFERENCES `advisor_runs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint

CREATE TABLE `advisor_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `thread_id` int NOT NULL,
  `role` varchar(10) NOT NULL,                       -- user | assistant
  `body` mediumtext NOT NULL,
  `status` varchar(10) NOT NULL DEFAULT 'pending',   -- pending | answered | failed
  `run_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `answered_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `idx_am_thread` (`thread_id`, `id`),
  KEY `idx_am_pending` (`role`, `status`),
  CONSTRAINT `fk_am_thread` FOREIGN KEY (`thread_id`) REFERENCES `advisor_threads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_am_run` FOREIGN KEY (`run_id`) REFERENCES `advisor_runs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

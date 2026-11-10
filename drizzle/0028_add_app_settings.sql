-- Private, per-install settings that used to live in git-ignored files, so a fresh clone or a
-- CI workspace needs nothing copied in. One JSON value per key; today the only key is
-- `advisor_profile` (the MCP advisor's standing profile of the user — src/server/mcp/advisor-context.ts),
-- which falls back to config/advisor-profile.json when the row is missing.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts drizzle/0028_add_app_settings.sql
CREATE TABLE `app_settings` (
  `setting_key` varchar(64) NOT NULL,
  `value` json NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

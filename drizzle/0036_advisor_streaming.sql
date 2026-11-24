-- Live advisor replies. While a routine run answers a chat it posts its progress through the
-- `stream_advisor_reply` MCP tool: the reply so far is an assistant row in advisor_messages
-- with status 'streaming' (no new column: the status column already fits it), and the step it
-- is on ("Grouping the uncategorized backlog…") is `activity` on its advisor_runs row. The app
-- streams both to the open chat over /api/advisor/stream. See planning/features/ai-advisor.md.
--
-- Hand-written like 0005+ (the drizzle journal stops at 0004). Apply with:
--   npx tsx scripts/apply-sql.ts --pending
ALTER TABLE `advisor_runs` ADD COLUMN `activity` varchar(200) NULL AFTER `summary`;

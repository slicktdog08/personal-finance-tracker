-- Lines start LOCKED. The balancing model: everything is pinned until you unlock it; unlock one
-- line and edits to it change the leftover; unlock a second and the two trade with each other —
-- what you add to one comes out of the other. Existing rows flip to locked so the model holds
-- for the budget already in use.
-- Apply with: npx tsx scripts/apply-sql.ts drizzle/0021_budget_lines_locked_default.sql
ALTER TABLE `budget_lines` MODIFY `locked` boolean NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE `budget_lines` SET `locked` = true;

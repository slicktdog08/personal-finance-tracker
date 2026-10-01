-- Data fix: a budget line on the "Savings" category IS a savings line (money kept, never spent).
-- The user created one before `savings` existed as a line kind, so it was stored as `category`
-- and would have counted as spending. getBudgetView also normalizes this on read.
-- Apply with: npx tsx scripts/apply-sql.ts drizzle/0019_savings_line_kind.sql
UPDATE `budget_lines` SET `kind` = 'savings' WHERE `category` = 'Savings' AND `kind` = 'category';

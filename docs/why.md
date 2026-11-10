# Why this exists

I've always managed my finances by hand, in a system I maintained myself. First it was a
Monday.com board. Then it was Notion: one database
per month, cloned from the month before, with a row for every bill (amount, due date, how it
gets paid, and whether it's paid yet). Under that sat a transactions layer I filled by
downloading CSVs from each bank and mapping every line to my own categories.

It worked, but it was slow and fragile:
- **Cloning months by hand** meant re-typing structure and fixing due dates that had drifted.
- **Overlapping CSV exports** quietly double-counted transactions.
- **Every month was its own island.** Nothing answered "how am I actually doing?" across months.
- **The bookkeeping crowded out the thinking.** Most of my time went to maintaining the system,
  not using it to make decisions.

In June 2026 I started replacing it with my own app. The first goal was strict parity: keep
the workflow I already trusted, minus the tedium. I imported my full Notion history so nothing
was lost. Then I kept building on top of it as I lived in it:

| When | What got added |
|------|----------------|
| Jun 2026 | Monthly bill sheets, CSV import with duplicate rejection, dashboard, accounts, debts, transfers, PDF statement import, categorization rules |
| Jul 2026 | Running balances from CSV imports, a pay schedule with a payday countdown |
| Aug 2026 | Cash offsets (so ATM cash isn't counted twice), transaction notes |
| Sep 2026 | Budgets with a debt-payoff generator, a cash projection, an MCP server so Claude can act as my financial advisor, the bank-sync engine, pending transactions, split transactions |
| Oct 2026 | Bank sync through SimpleFIN and Plaid, a rearrangeable dashboard, AI insights and in-app advisor chat, retirement accounts and assets in net worth |
| Nov 2026 | Built-in sign-in (no AWS needed), a one-command Docker install, a public demo |

Every feature exists because I hit the problem while managing my own money. It's built for one
person and it's opinionated. I'm open-sourcing it as a working example of a personal tool built
with Claude Code as a pair programmer, and as a starting point if you'd rather own your
financial data than rent a budgeting app. Every number in the docs, tests and fixtures is
illustrative; my real data never leaves my own database.

[← Back to the README](../README.md)

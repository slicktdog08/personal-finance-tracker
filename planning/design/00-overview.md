# Personal Billing Tracker — Overview

A personal web app to replace the Monday.com / Notion monthly bill-tracking workflow.
Single user. Next.js + TypeScript + Tailwind, backed by MySQL.

## Why this exists

Today the workflow lives in Notion (previously Monday):
- One **database per month** ("sheet"), cloned from the previous month to keep structure.
- Each row is a **bill** with name, amount, status, due date, payment type, and debt flag.
- A separate **transactions** layer tracks individual bank transactions, hand-imported
  from bank CSVs and manually mapped to internal categories.

Pain points this app fixes:
1. Cloning a month by hand is tedious and error-prone.
2. CSV imports are manual, and duplicate transactions sneak in across overlapping exports.
3. No single source of truth or roll-up across months.

## Goals (v1 — parity, not improvement)

The explicit goal is to **continue the existing workflow**, then improve later.

- [ ] Bills tracked per month, with one-click "clone previous month".
- [ ] Inline editing of a bill's status / amount / due date for a given month.
- [ ] "Apply due date to following months" (due dates drift a day or two).
- [ ] CSV transaction import with **automatic duplicate rejection**.
- [ ] Category mapping for imported transactions (raw bank text → internal category).
- [ ] Historical data from `notion_data/` imported so nothing is lost.
- [ ] Dashboard: monthly totals, amount due, debt outstanding, paid vs unpaid.

## Explicit non-goals (v1)

- Multi-user / auth beyond a single local user.
- Bank API / Plaid integration (CSV only for now).
- Budgeting/forecasting beyond simple roll-ups.
- Mobile-native app.

## The data we are migrating

See [01-data-inventory.md](01-data-inventory.md) for the full survey. Summary:

- **Monthly sheets**, one per month, each holding that month's bill rows.
- An optional **transaction layer** per month (not every month has one).
- Transactions reference **bank accounts by last-4 digits** and one of a fixed set of
  **transaction categories**; bills carry one of a set of **bill statuses**.

## Document map

| Doc | Purpose |
|-----|---------|
| [00-overview.md](00-overview.md) | This file — vision & scope |
| [01-data-inventory.md](01-data-inventory.md) | Format of the `notion_data/` export |
| [02-data-model.md](02-data-model.md) | Proposed MySQL schema |
| [03-architecture.md](03-architecture.md) | App stack, structure, DB access strategy |
| [04-migration-and-seed.md](04-migration-and-seed.md) | Loading history + the DDL blocker |
| [06-roadmap.md](06-roadmap.md) | Phased build plan |
| [07-decisions.md](07-decisions.md) | Locked decisions |

Per-feature docs (how each shipped feature works, including CSV import) live in
[../features/](../features/), not here — design covers high-level app choices only.

## Decisions (locked) — see [07-decisions.md](07-decisions.md)

The MCP MySQL connection (a restricted MCP user) is read/write but **cannot run DDL**
(`CREATE TABLE` blocked). Resolved:

- **Schema** is created via a **privileged connection string** + Drizzle migrations
  (not via MCP).
- Tables live in a **new dedicated database `personal_billing`**, with **unprefixed**
  table names.
- We **pause for plan review** before scaffolding the app.

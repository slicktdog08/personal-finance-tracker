# Architecture

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js (App Router)** + TypeScript | Requested; server actions remove most API boilerplate |
| Styling | **Tailwind CSS** | Requested |
| DB | **MySQL** — dedicated `personal_billing` DB on the existing MySQL server | Existing server, isolated from other app databases |
| ORM | **Drizzle ORM** (`drizzle-orm/mysql2`) | Type-safe, lightweight, SQL-first, easy schema-as-code |
| Migrations | **drizzle-kit** | Generates/applies DDL with a privileged connection |
| CSV | **papaparse** (server-side) | Robust quoting/BOM handling |
| Validation | **zod** | Import row + form validation |
| Tables/UI | TanStack Table + shadcn/ui (optional) | Editable grids that feel like the old sheets |

> Drizzle is the recommendation. Prisma is a fine alternative if preferred — same model,
> the schema in [02-data-model.md](02-data-model.md) maps cleanly to either.

## Two database connections (important)

The MCP MySQL user is intentionally restricted: **no DDL, no DROP,
no DELETE**. We therefore use two roles:

1. **App/runtime connection** — used by Next.js (Drizzle). Needs SELECT/INSERT/UPDATE
   (and DELETE for the app's delete features). Schema is created once via drizzle-kit using
   a privileged connection string.
2. **MCP connection** — used by Claude for ad-hoc reads/inserts/verification during
   development. Cannot create tables (see the blocker in
   [04-migration-and-seed.md](04-migration-and-seed.md)).

`.env.local` (gitignored):
```
DATABASE_URL="mysql://USER:PASS@DB_HOST:3306/personal_billing"
# Privileged URL for migrations (DDL + CREATE DATABASE rights):
DATABASE_MIGRATION_URL="mysql://ADMIN:PASS@DB_HOST:3306/personal_billing"
```

## Proposed project structure

```
personal-billing/
  src/
    app/
      layout.tsx
      page.tsx                      # redirect → current month
      months/[period]/page.tsx      # the monthly bill sheet (editable grid)
      transactions/page.tsx         # transaction ledger + filters
      import/page.tsx               # CSV upload + dedup summary
      dashboard/page.tsx            # rollups across months
      api/ (only where server actions don't fit)
    components/
      bills/BillTable.tsx
      bills/StatusBadge.tsx
      bills/CloneMonthButton.tsx
      transactions/TxTable.tsx
      import/ImportWizard.tsx
      ui/ ...
    server/
      db/index.ts                   # drizzle client
      db/schema.ts                  # all tables (periods, bills, bill_instances, ...)
      actions/bills.ts              # server actions (CRUD, clone, apply-due-date)
      actions/transactions.ts
      actions/import.ts             # parse → dedup → insert
      lib/money.ts                  # parse/format USD
      lib/dedup.ts                  # hash + normalize description
      lib/categorize.ts            # apply category_mappings
    constants/enums.ts              # statuses, payment types, categories
  scripts/
    seed-history.ts                 # one-time loader for notion_data/
  drizzle/                          # generated migrations
  drizzle.config.ts
  planning/                         # these docs
  notion_data/                      # source export (kept, gitignored or read-only)
```

## Server-side patterns

- **Server Actions** for all mutations (edit bill, clone month, import CSV) — no REST layer
  needed for a single-user app.
- **Money** stored as `DECIMAL`; never use floats. `lib/money.ts` parses `$1,100.00` /
  `-$1,500.00` / `""` → number|null and formats back.
- **Dedup** computed server-side at import; UNIQUE constraint is the backstop.
- CSV parsing happens server-side (file uploaded to a server action / route handler), so
  no large client bundles and the raw row can be stored in `transactions.raw`.

## Key flows

1. **Edit month** → `/months/2026-03` shows `billing_bill_instances` for that period in an
   editable grid; inline status/amount/due-day edits via server action.
2. **Clone month** → "New month" copies the latest period's instances forward (status reset
   to a sensible default like `Not Due Yet`/`Unpaid`, amounts/due days retained).
3. **Apply due date forward** → edit a bill's due day and optionally propagate to all
   later periods' instances of the same `bill_id`.
4. **Import CSV** → upload → parse → map categories → show "N new / M duplicates" → commit.
5. **Dashboard** → totals per period: total due, paid, unpaid, debt outstanding.

See [../features/csv-import.md](../features/csv-import.md) and [06-roadmap.md](06-roadmap.md).

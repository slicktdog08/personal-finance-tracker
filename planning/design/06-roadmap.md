# Roadmap

Phased build. Each phase is independently verifiable.

## Phase 0 — Decisions & access (blocking)
- [x] DDL path → **privileged URL + Drizzle migrations** (see [07-decisions.md](07-decisions.md)).
- [x] DB target → **new dedicated database `personal_billing`**, unprefixed tables.
- [x] Sequencing → **review plan first** before scaffolding.
- [ ] User provides `DATABASE_MIGRATION_URL` (privileged) / runtime `DATABASE_URL`.
- [ ] Confirm runtime DB user can INSERT/UPDATE/DELETE.
- [ ] Go-ahead to scaffold.

## Phase 1 — Schema
- [ ] Drizzle schema in `src/server/db/schema.ts` matching [02-data-model.md](02-data-model.md).
- [ ] Create tables (via chosen DDL path).
- [ ] Verify via MCP `SHOW TABLES` / `DESCRIBE`.

## Phase 2 — App scaffold
- [ ] `create-next-app` (App Router, TS, Tailwind, ESLint).
- [ ] Drizzle client + `.env.local`; smoke-test a query.
- [ ] Base layout, nav (Months / Transactions / Import / Dashboard), money & enum utils.

## Phase 3 — Historical seed
- [ ] `scripts/seed-history.ts` loads `notion_data/` (accounts → periods → bills →
      instances → transactions), idempotent.
- [ ] Verify counts match the export (periods, instances, accounts, transactions;
      `COUNT = COUNT(DISTINCT dedup_hash)`).

## Phase 4 — Monthly bill sheet
- [ ] `/months/[period]` editable grid of bill instances.
- [ ] Inline edit: status, amount, due day, payment type, debt/cancel flags.
- [ ] Add/remove a bill in a month; reorder.
- [ ] **Clone previous month** action.
- [ ] **Apply due day to following months** action.

## Phase 5 — Transactions ledger
- [ ] `/transactions` with filters (month, account, category, search, direction).
- [ ] Inline category edit; optional link a txn to a bill instance.
- [ ] Per-period and per-category totals.

## Phase 6 — CSV import
- [ ] `/import` wizard: upload → column-map (savable) → preview (new/dup/error) → commit.
- [ ] Dedup + category rules per [../features/csv-import.md](../features/csv-import.md).
- [ ] Batch audit list.

## Phase 7 — Dashboard
- [ ] Per-month rollups: total due, paid, unpaid, debt outstanding, by payment type.
- [ ] Spend by category (from transactions).
- [ ] Cross-month trend.

## Phase 8 — Polish (later)
- [ ] Saved category rules management UI.
- [ ] Bill detail view (history of a recurring bill across months).
- [ ] Export, simple auth, deploy.

## Suggested first working slice (thin vertical)
Phases 1→2→3→4: schema + scaffold + seeded history + a read/edit monthly sheet. That alone
replaces the day-to-day Notion usage; import and dashboard follow.

# Decisions Log

Locked decisions that the rest of the plan now assumes. Update here if they change.

## D1 — Schema creation: privileged DB URL + Drizzle migrations
The MCP user cannot run DDL. The user will provide a **privileged MySQL connection string**
(with DDL + CREATE DATABASE rights) as `DATABASE_MIGRATION_URL`. Schema is defined as code
in Drizzle and applied with `drizzle-kit` — repeatable and version-controlled.
MCP stays for ad-hoc **reads/verification** (and INSERTs if convenient).

- Migration user needs: `CREATE`, `ALTER`, `CREATE DATABASE` (or DB pre-created), plus DML.
- Runtime app user needs: `SELECT/INSERT/UPDATE/DELETE` on the new DB.
- If one privileged user covers both, a single `DATABASE_URL` is fine.

## D2 — Dedicated database: `personal-billing`
A new database separate from any other application database on the same server.
- DB name: **`personal-billing`** (hyphenated; already created on the server).
  Note: a hyphen requires backtick-quoting in raw SQL, but works fine inside a connection URL.
- Because the DB is dedicated, **table names are unprefixed**: `periods`, `bills`,
  `bill_instances`, `accounts`, `transactions`, `import_batches`, `category_mappings`.
  (The earlier `billing_` prefix is dropped.)

## D3 — Sequencing: review-first
The user reviews these planning docs **before** any app scaffolding. No `create-next-app`,
no schema creation, no seed until explicit go-ahead.

## D4 — ORM: Drizzle (default, not yet contested)
Drizzle ORM + drizzle-kit. Swappable for Prisma later if desired; schema maps cleanly.

## D5 — CSV import mapping: normalize to amount+direction; balances are end-of-day
Locked 2026-07-17 (see [../features/csv-import.md](../features/csv-import.md)).
- Every row normalizes to **`amount` (magnitude) + `direction`** (`Debit`/`Credit`). A bank's
  free-form "Type" (Sale/Payment/Fee) is **not** a direction. Three input layouts are supported:
  signed amount, amount + a Debit/Credit label column, and **separate Debit/Credit columns**.
- **Account column detection scores header name + value shape** (threshold 3). Bare numbers with
  no naming hint are deliberately *not* treated as accounts (no check-#/ZIP false positives).
- **Balances from a CSV are one end-of-day snapshot per (account, day)**, idempotent per
  (account, as-of) in `account_balances` — not one row per transaction.
- `netAmount` is optional and treated as **unreliable** (don't `SUM` it); derive sign from
  direction+amount instead.

## D6 — Cash offsets: a withdrawal counts only for what it can't explain
Locked 2026-08-20 (see [../features/cash-offsets.md](../features/cash-offsets.md)).
- An ATM withdrawal and the wallet purchases it funded are **the same money**. The bank row is
  never edited (it re-imports from the statement); the link lives in `cash_allocations`.
- Every spend rollup counts a withdrawal for its **unaccounted remainder**
  (`GREATEST(amount − SUM(allocations), 0)`), and each wallet purchase once, under its own
  category. **Unaccounted cash is still spending** — an offset moves money between categories and
  months, it never erases it.
- **Month attribution follows the cash.** Offsetting a July 30 withdrawal with August purchases
  lowers July and raises August. That retroactive shift is intended.
- The wallet is identified by `account_type = 'Cash'` and a cash source by `category = 'Cash'` —
  both data, not hardcoded ids, so more wallets/sources need no code.
- Allocations are **clamped, never rejected** (≤ what the withdrawal has left, ≤ what the purchase
  cost), which is what makes double-counting structurally impossible.
- **Cash still in your pocket isn't spending.** A withdrawal is explained either by a purchase or
  by cash you still hold, so a month's real cash outflow is
  `opening pocket + withdrawals − closing pocket`. The pocket balance is only ever what the user
  **counted** (a manual `account_balances` snapshot on the wallet) — nothing derives it, because a
  derived pocket balance would only restate the app's own assumption.
- The pocket correction applies at **month level** (dashboard + `/cash`); `/transactions` rows keep
  their full un-offset amounts. Chosen by the user 2026-08-20 over threading it per-row.
- The pocket delta is **signed**: kept cash comes off the month, cash drawn down from a previous
  month goes on to it. Clamping the negative case would lose money that was deliberately excluded
  from an earlier month's spending. Capped above at that month's unaccounted cash; uncapped below.

## D7 — Budgets measure against transactions; modes are generators
Locked 2026-09-07 (see [../features/budget.md](../features/budget.md)).
- A budget line's **actual comes from the month's transactions**, never from bill instances. Bills
  say what's due; a budget is about what was spent. Category lines reuse `getCategorySpend` so the
  budget and the dashboard can't disagree.
- A **mode is how the first draft is generated**, not a kind of budget. Every budget is the same
  set of lines once created. New modes are an enum entry + a pure generator, no migration.
- **One budget per month**, one line per category / per debt account. Duplicates are refused
  rather than merged, because the actual would be counted twice.
- The snowball's **extra is swept down the payoff order** and never plans above a balance; a month
  that can't cover minimums + usual spending reports a shortfall with every debt at its minimum.
- Snowball ordering defaults to **smallest balance first** (the user asked for a snowball), with
  highest-APR-first offered as a toggle — same machinery, different sort key.
- **Only debt above 10% APR is snowballed or projected** (`SNOWBALL_MIN_APR`, 2026-09-08). Cheap
  debt is carried at its minimum: it gets a line, never the extra, and is named as excluded in the
  projection. Low-rate debt (e.g. a student loan) isn't actively paid down; "debt-free" means
  high-interest debt-free.

## D8 — Savings is a budget line that is never "spent"; cash projections anchor on recorded balances
Locked 2026-09-09 (see [../features/budget.md](../features/budget.md)).
- `Savings` is a **seeded system category** and a **budget line kind**. It competes for the month's
  income like spending, but never counts as spent and is never a cash outflow; its truth test is
  whether cash on hand (checking + savings + pocket) grew by that much.
- The cash projection **anchors on the freshest recorded cash snapshot**, not on today, and shows
  that date. It never derives a balance — the same rule as the pocket count (D6).
- In the projection, **bills time the money and budget lines size it**: an unpaid bill leaves on
  its due day and is deducted from the line that covers it; a debt line is one payment of what the
  plan still owes after linked transactions and the sheet's paid marks.

## D9 — Months are automatic; the projection looks one month past the current one
Locked 2026-09-20 (see [../features/budget.md](../features/budget.md)).
- **No manual month creation.** This month and next always exist, cloned from the most recent
  month with bills; nothing creates further ahead. The Months index page is gone; the dashboard's
  "Open <month>" is the way into a sheet.
- **The cash projection runs to the end of NEXT month**, using next month's sheet and its budget
  if it has one, else this month's plan repeated — always labeled "assumed". A month that ends
  well but faces rent on the 1st must show it.
- **Projection snapshots are first-write-wins per day**; trend compares today to the most recent
  snapshot at least a week old (else the earliest).
- **Budget lines start locked; the unlocked ones are the balancing pool.** Unlock one → its edits
  change the leftover (the auto-rebalance target, when on). Unlock two → they trade. Money never
  moves through a separate transfer dialog. (Revised same day from a lock-as-override model.)
- **Sliders on desktop, steppers on phones** for every money amount (`AmountControl`). The user
  found sliders better on desktop and unusable on mobile.

## Still needed from user before Phase 1
- [ ] `DATABASE_MIGRATION_URL` (privileged) and/or runtime `DATABASE_URL`.
- [ ] Confirm DB name `personal_billing` (or supply preferred name).
- [ ] Go-ahead to scaffold (lifts D3).

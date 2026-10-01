# Data Model — MySQL Schema

Relational model that captures the Notion "one sheet per month" pattern without copying
data by hand. Lives in a **dedicated database `personal-billing`** (separate from any
other application database on the same server). Because the DB is dedicated, table names are **unprefixed**. (The hyphen in
the DB name trips `drizzle-kit migrate` → migrations are applied with `scripts/apply-sql.ts`.)

## Core idea: definitions vs. monthly instances

Notion cloned an entire month to get a new month. We split that into:

- **`bills`** — the *recurring definition* of a bill (its identity over time).
- **`bill_instances`** — that bill's state *in one specific month* (status, amount,
  due day — the things that change month to month).
- **`periods`** — the months themselves.

"Clone last month" becomes: copy this month's instances into a new period.
"Apply due date to following months" becomes: update `due_day` on future instances.

```
periods 1──* bill_instances *──1 bills
                    │
accounts 1──* transactions *──0..1 bill_instances
   │                │
   *          import_batches
account_balances    (cash-on-hand history; for credit accounts, balance owed + limit history)

category_mappings   (raw bank text → category, optional auto-link to a bill)
bill_statuses · payment_types · categories   (UI-managed lookup lists: name + color + emoji)
```

---

## `periods`

One row per month sheet.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK AUTO_INCREMENT | |
| year | SMALLINT NOT NULL | e.g. 2025 |
| month | TINYINT NOT NULL | 1–12 |
| label | VARCHAR(20) NOT NULL | `2025-01` (generated) |
| start_date | DATE NULL | first of month |
| end_date | DATE NULL | last of month |
| notes | TEXT NULL | |
| created_at / updated_at | TIMESTAMP | |

`UNIQUE (year, month)`

## `bills` — recurring definitions

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| name | VARCHAR(191) NOT NULL | canonical name |
| default_amount | DECIMAL(10,2) NULL | typical amount |
| default_due_day | TINYINT NULL | 1–31 |
| default_payment_type | VARCHAR(32) NULL | see enum below |
| is_debt | BOOLEAN NOT NULL DEFAULT 0 | long-standing debt (credit cards) |
| active | BOOLEAN NOT NULL DEFAULT 1 | still recurring? |
| notes | TEXT NULL | |
| created_at / updated_at | TIMESTAMP | |

`UNIQUE (name)` · index on `active`

## `bill_instances` — a bill within a month

This is the row the user actually edits each month (the Notion "bill").

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| period_id | INT NOT NULL FK → periods | |
| bill_id | INT NULL FK → bills | null allowed for one-offs |
| name | VARCHAR(191) NOT NULL | snapshot (names drift) |
| amount | DECIMAL(10,2) NULL | NULL = no amount this month |
| status | VARCHAR(32) NOT NULL | see status enum |
| due_day | TINYINT NULL | 1–31, this month's due day |
| payment_type | VARCHAR(32) NULL | |
| is_debt | BOOLEAN NOT NULL DEFAULT 0 | |
| is_cancel | BOOLEAN NOT NULL DEFAULT 0 | the Notion "Cancel" flag |
| sort_order | INT NOT NULL DEFAULT 0 | preserve display order |
| created_at / updated_at | TIMESTAMP | |

Index on `period_id`, `bill_id`. (No unique on (period, bill) — duplicate names per month
are legitimate.)

## `accounts` — bank accounts

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| account_number | VARCHAR(8) NOT NULL | last-4, e.g. `1234` |
| label | VARCHAR(64) NULL | user-friendly name (fill in later) |
| institution | VARCHAR(64) NULL | |
| account_type | VARCHAR(32) NULL | `Checking` / `Savings` / `Credit` / `Loan` / `Other`. Checking/Savings → cash-on-hand history; Credit → balance owed + limit history (see `account_balances`) |
| created_at / updated_at | TIMESTAMP | |

`UNIQUE (account_number)`

## `account_balances` — manual balance snapshots over time

History (not a single mutable field), so past months reflect the balance recorded back then.
Checking/savings record cash-on-hand in `balance`; **credit** accounts record the amount owed
in `balance` plus the card's `credit_limit` on the same snapshot. Queried with an "as of" date:
the latest snapshot with `as_of <= asOf` per account (`getCashOnHand`, `getCreditStanding`).

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| account_id | INT NOT NULL FK → accounts | |
| balance | DECIMAL(12,2) NOT NULL | cash on hand, or amount owed for credit |
| credit_limit | DECIMAL(12,2) NULL | credit accounts only; NULL for cash accounts |
| as_of | DATE NOT NULL | snapshot date |
| note | VARCHAR(255) NULL | |
| created_at | TIMESTAMP | |

Index on `account_id`, `as_of`. Added in `0001_add_lookups_and_balances.sql`; `credit_limit`
added in `0005_add_credit_limit.sql`.

## `transactions`

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| account_id | INT NULL FK → accounts | |
| period_id | INT NULL FK → periods | derived from txn_date |
| bill_instance_id | INT NULL FK → bill_instances | optional manual/auto link |
| transfer_partner_id | INT NULL FK → transactions | other side of an internal transfer (self-ref); added in `0003_add_transfer_link.sql` |
| txn_date | DATE NOT NULL | |
| description | VARCHAR(512) NOT NULL | raw bank text |
| category | VARCHAR(48) NULL | mapped system category |
| amount | DECIMAL(12,2) NOT NULL | absolute value |
| net_amount | DECIMAL(12,2) NULL | signed (credits negative) |
| direction | VARCHAR(8) NOT NULL | `Debit` / `Credit` |
| dedup_hash | CHAR(64) NOT NULL | sha256, see below |
| import_batch_id | INT NULL FK → import_batches | |
| raw | JSON NULL | original CSV row |
| created_at | TIMESTAMP | |

`UNIQUE (dedup_hash)` · index on `txn_date`, `account_id`, `category`.

**Dedup hash** = `sha256( account_number | txn_date(ISO) | amount | normalized_description | direction )`.
The UNIQUE constraint makes re-importing overlapping CSVs a no-op (insert ignored).
See [../features/csv-import.md](../features/csv-import.md) for normalization details.

## `import_batches`

Audit trail for each CSV import (also powers the "X new, Y duplicates" summary).

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| filename | VARCHAR(255) NOT NULL | |
| source | VARCHAR(64) NULL | bank/source label |
| account_id | INT NULL FK | if single-account file |
| total_rows | INT NOT NULL | |
| inserted_count | INT NOT NULL | |
| duplicate_count | INT NOT NULL | |
| error_count | INT NOT NULL DEFAULT 0 | |
| created_at | TIMESTAMP | |

## `category_mappings` — raw → system category rules

Drives auto-categorization on import.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| match_type | VARCHAR(12) NOT NULL | `contains` / `equals` / `regex` |
| pattern | VARCHAR(255) NOT NULL | matched against description (or raw category) |
| field | VARCHAR(16) NOT NULL DEFAULT 'description' | `description` / `raw_category` |
| category | VARCHAR(48) NOT NULL | resulting system category |
| bill_id | INT NULL FK → bills | optional auto-link |
| priority | INT NOT NULL DEFAULT 100 | lower wins |
| created_at / updated_at | TIMESTAMP | |

## `savings_goals` — savings goals & funding initiatives

A goal to accumulate money toward a target (emergency fund, a future purchase, or paying a set
amount toward a debt). Progress is the running SUM of `goal_contributions`; an optional funding
account backs the goal and drives the "regress" behavior (see below). Added in
`0012_add_savings_goals.sql`.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| name | VARCHAR(191) NOT NULL | e.g. "Emergency fund", "New car" |
| goal_type | VARCHAR(32) NOT NULL DEFAULT 'savings' | `savings` / `purchase` / `debt_payoff` / `custom` (enum const) |
| target_amount | DECIMAL(12,2) NOT NULL | editable |
| target_date | DATE NULL | optional deadline |
| funding_account_id | INT NULL FK → accounts | real account backing the goal (cash acct → reality-checked; liability → context only) |
| color | VARCHAR(16) NOT NULL DEFAULT '#3b82f6' | badge/bar color |
| emoji | VARCHAR(16) NULL | |
| status | VARCHAR(16) NOT NULL DEFAULT 'active' | `active` / `achieved` / `archived` |
| sort_order | INT NOT NULL DEFAULT 0 | priority (drives the shortfall fill order) |
| notes | TEXT NULL | |
| created_at / updated_at | TIMESTAMP | |

Index on `status`, `funding_account_id`.

## `goal_contributions` — funding ledger (append-only)

The funding history of a goal (not one mutable field — same dated-ledger pattern as
`account_balances`). Positive amount = money put toward the goal, negative = withdrawn. Progress
= `SUM(amount)`.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| goal_id | INT NOT NULL FK → savings_goals | |
| amount | DECIMAL(12,2) NOT NULL | + fund, − withdraw |
| occurred_on | DATE NOT NULL | |
| note | VARCHAR(255) NULL | |
| transaction_id | INT NULL FK → transactions (SET NULL) | optional link to the real bank txn — the hook the future paycheck-allocation module writes |
| created_at | TIMESTAMP | |

Index on `goal_id`, `occurred_on`.

**Progress & "regress" (`getGoalsWithProgress`):** `funded = SUM(contributions)` drives the
progress bar (`funded / target_amount`). For goals backed by a **cash** account the allocation is
reality-checked against that account's recorded cash-on-hand (`getCashOnHand`) as of the date: the
balance is filled to its goals in `sort_order` priority, and any goal the account can't cover shows
a `shortfall` — i.e. the goal *regresses* when the funding account dips below what's been allocated.
Debt-payoff goals track progress from their logged contributions only (the linked liability account
is shown for context, not reality-checked).

## `cash_allocations` — cash offsets

"$X of withdrawal W paid for purchase S." Cash taken out of the bank (a `Debit` categorized
`Cash`) and the purchases logged on the wallet account (`account_type = 'Cash'`) are the same
money; without this link both count as spending. The bank row can't be adjusted — it re-imports
from the statement — so the link is recorded alongside it.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| withdrawal_txn_id | INT NOT NULL FK → transactions (CASCADE) | the cash source |
| spend_txn_id | INT NOT NULL FK → transactions (CASCADE) | the wallet purchase |
| amount | DECIMAL(12,2) NOT NULL | how much of the withdrawal this purchase used |
| created_at | TIMESTAMP | |

Unique on `(withdrawal_txn_id, spend_txn_id)`; indexes on each side. The per-link **amount** (not a
plain FK on the purchase) is what makes it exact: one $300 withdrawal covers many purchases, and
one purchase can draw on two withdrawals. Both FKs cascade — an allocation is meaningless without
both halves.

**The pocket count.** There is no table for "cash in my pocket" — it's an ordinary
`account_balances` snapshot on the wallet account, the same dated ledger every other account uses.
Month-scoped rollups subtract `closing − opening` (signed) so cash withdrawn but not yet spent
isn't counted as spending, and cash drawn down from an earlier month is. See `getCashHeld`.

**The rollup rule:** every spend aggregate counts a transaction as
`GREATEST(amount − COALESCE(SUM(allocations), 0), 0)` (`unaccountedAmount()` in `queries.ts`), so a
withdrawal contributes only the cash it couldn't account for and each purchase contributes once
under its own category. Rows with no allocations — nearly all of them — are unaffected. See
[../features/cash-offsets.md](../features/cash-offsets.md).

## `budgets` — the month's plan

One per period. `mode` = the generator that drafted it, `strategy` = debt ordering it used; both
VARCHAR + `enums.ts` consts. Added in `0017_add_budgets.sql`. See
[../features/budget.md](../features/budget.md).

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| period_id | INT NOT NULL FK → periods | `UNIQUE` — one budget per month |
| mode | VARCHAR(32) NOT NULL DEFAULT 'manual' | `debt_snowball` / `manual` |
| strategy | VARCHAR(32) NULL | `snowball` (smallest balance first) / `avalanche` (highest APR first) |
| planned_income | DECIMAL(12,2) NULL | expected take-home for the month (defaulted from `pay_schedule`) |
| auto_rebalance | BOOLEAN NOT NULL DEFAULT 0 | every write re-derives the target debt's payment as income − other lines (`0018_budget_auto_rebalance.sql`) |
| notes | TEXT NULL | |
| created_at / updated_at | TIMESTAMP | |

## `budget_lines` — one planned amount, measured against transactions

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| budget_id | INT NOT NULL FK → budgets (CASCADE) | |
| kind | VARCHAR(16) NOT NULL | `category` (actual = month's net spend in `category`) / `debt` (actual = Debit payments linked to the account's bill) / `savings` (money kept; never an outflow — reality-checked against cash-on-hand growth) |
| label | VARCHAR(191) NOT NULL | |
| category | VARCHAR(48) NULL | category lines |
| account_id | INT NULL FK → accounts (SET NULL) | debt lines |
| planned | DECIMAL(12,2) NOT NULL DEFAULT 0 | the full planned amount |
| minimum | DECIMAL(12,2) NULL | debt lines: min payment snapshot at planning time |
| is_target | BOOLEAN NOT NULL DEFAULT 0 | the snowball focus (one per budget) |
| locked | BOOLEAN NOT NULL DEFAULT 1 | lines start locked; the unlocked ones form the balancing pool (`0020`, default flipped in `0021`) |
| sort_order | INT NOT NULL DEFAULT 0 | payoff order for debts, then spending |
| notes | VARCHAR(255) NULL | |
| created_at / updated_at | TIMESTAMP | |

Index on `budget_id`, `account_id`. Nothing here stores an actual — every actual is derived at read
time (`getBudgetView`), so re-categorizing a transaction moves the budget with it.

## `projection_snapshots` — what the cash projection said, per day

One row per (period, day), written the first time a live projection is computed that day and never
overwritten (`0020_budget_locks_and_projection_snapshots.sql`). Feeds the "versus earlier
projections" trend on the cash widget.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| period_id | INT NOT NULL FK → periods (CASCADE) | |
| taken_on | DATE NOT NULL | `UNIQUE (period_id, taken_on)` |
| as_of | DATE NOT NULL | the cash snapshot the projection anchored on |
| cash_now / end_balance / horizon_balance | DECIMAL(12,2) | anchor cash; projected end of the month; end of the horizon (next month) |
| low_balance / low_date | DECIMAL / DATE | projected low on the horizon |
| spread_total | DECIMAL(12,2) | everyday spending still expected this month |
| hot_end | DECIMAL(12,2) | high-interest debt at this month's end |
| created_at | TIMESTAMP | |

---

## Enumerations (app-level constants; stored as VARCHAR for flexibility)

Kept as VARCHAR + a TypeScript const so the user can add values without a migration.

**Bill status (16):**
`Unpaid, Optional, Not Due Yet, Past Due, Debt, Autopay, Ready for Payment, Pending,
Partial Payment, Autopay Pending, Declined, Paid/Purchased, Paid & Cancelled, Suspended,
No Balance, Skipped`

**Payment type (4):**
`Payable By Credit, ACH Payment, Cashapp/Zelle, Cash Only`

**Transaction direction (2):** `Debit, Credit`

**Transaction category (17, seed set — extensible):**
`Business, Cash, Debt Repayment, Deposit, Discretionary, Essentials,
Essentials/Discretionary, Fees, Food/Groceries, Interest, Interest/Rewards, Investing,
Rent, Savings, Temporary Debt, Transfer, Transportation, Utilities`

## Lookup tables (UI-managed) — `bill_statuses`, `payment_types`, `categories`

The "we can add a lookup table later" plan below was acted on: statuses, payment types, and
transaction categories are now editable in **Settings** (reorder, recolor, set emoji), seeded
from the constants in [enums.ts](../src/constants/enums.ts). Instance rows still store the
chosen value as a VARCHAR **snapshot** (so historical rows don't shift when a list is edited);
these tables drive the pickers, ordering, and badge color/emoji.

All three share the same shape:

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | |
| name | VARCHAR(32/48) NOT NULL UNIQUE | 48 for `categories`, 32 for the others |
| color | VARCHAR(16) NOT NULL DEFAULT '#9ca3af' | badge color |
| emoji | VARCHAR(16) NULL | badge/select emoji (added in `0004_add_emoji.sql`) |
| sort_order | INT NOT NULL DEFAULT 0 | display + picker order |
| active | BOOLEAN NOT NULL DEFAULT 1 | |
| created_at / updated_at | TIMESTAMP | |

`bill_statuses` additionally has `is_settled BOOLEAN NOT NULL DEFAULT 0` (counts as "no money
still owed this month" in rollups). `bill_statuses` + `payment_types` added in
`0001_add_lookups_and_balances.sql`; `categories` in `0002_add_categories.sql`.

## Why VARCHAR over native MySQL ENUM

The user explicitly wants to add statuses freely. Native ENUM requires `ALTER TABLE` (DDL).
VARCHAR + an app-validated list gives flexibility; the UI-managed lookup tables above
(`bill_statuses`, `payment_types`, `categories`) layer color/emoji/order on top while
instance rows keep a plain VARCHAR snapshot of the chosen value.

The full `CREATE TABLE` DDL lives in [04-migration-and-seed.md](04-migration-and-seed.md).

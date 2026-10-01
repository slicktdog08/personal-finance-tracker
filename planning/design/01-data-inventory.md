# Data Inventory — `notion_data/`

Description of the Notion-workspace export format that the seed script supports. It
documents the folder layout, column sets, and normalization rules the schema and
loader must accommodate.

## Folder structure

```
notion_data/
  2024 Bills/<MM 01 24 - MM 31 24>/      ... + a sibling month CSV (the bill list)
  2025 Bills/<MM 01 25 - MM 31 25>/
      Budget *.html                       (month rollup page)
      Manual Bills *.csv  | Payments *.csv (the bill list)
      Transactions *.csv                  (only some months)
  2026 Bills/<MM 01 26 - MM 31 26>/
      Budget *.html
      Payments *.csv
```

The per-bill `.html` files inside each month folder contain **no extra data** — just the
same fields as the CSV row. The bill CSV is the authoritative source.

## Months and folder naming

- One folder per month, labelled `MM 01 YY - MM 31 YY` (the end day is always written as
  `31`, even for shorter months). Derive the period from the `MM ... YY` prefix, not the
  end date.
- Months can be missing from an export; the loader must not assume a contiguous range.
- Notion may append a ` (1)` suffix to a duplicated folder name — strip it.
- The bill CSV is named differently by era (see below); the transaction CSV, when present,
  is `Transactions *.csv`. Not every month has a transaction layer.

## Bill schema evolution

The columns drifted over time. The union of all bill columns:

`Name, Amount, Monthly Due Date, Due Date, Cancel, Debt, Payment Account, Payment Type, Status`

| Era | Columns |
|-----|---------|
| Earliest (month CSV) | Name, Amount, **Monthly Due Date**, Payment Account, Payment Type, Status |
| Middle (`Manual Bills *.csv`) | Name, Amount, **Cancel**, **Debt**, **Due Date**, Payment Account, Payment Type, Status |
| Latest (`Payments *.csv`) | Name, Amount, Debt, Due Date, Payment Account, Payment Type, Status (Cancel sometimes dropped) |

Normalization rules:
- `Monthly Due Date` and `Due Date` are the **same field** → `due_day` (1–31, nullable).
- `Cancel` / `Debt` are `Yes`/`No` strings → booleans (default `false` when column absent).
- `Payment Account` is not used for bills → ignored by the loader.
- `Amount` formats seen: `$40.00`, `$1,100.00`, `$0.00`, empty. Strip `$`/`,`; empty → NULL.

### Bill statuses recognized by the loader
`Autopay, Debt, No Balance, Paid & Cancelled, Paid/Purchased, Past Due, Pending,
Ready for Payment, Skipped, Suspended, Unpaid`

Also valid (added later in the workflow):
`Optional, Not Due Yet, Partial Payment, Autopay Pending, Declined`

→ The status enum should be the **superset** (16 values). See [02-data-model.md](02-data-model.md).

### Payment types recognized by the loader
`ACH Payment, Cashapp/Zelle, Payable By Credit`
Also valid: `Cash Only`. → enum superset = 4 values.

### Bill name drift
Names are not stable across months (e.g. `Card A Credit Card` → `Card A`, a subscription
renamed or cancelled). The recurring-bill matching during seed must be
fuzzy/manual-reviewable, not an exact-name join. Duplicate names can also occur within a
month (e.g. two rows with the same payee).

## Transaction schema (months with a transaction layer)

Columns:
`Transaction Description, Account Number, Category, Net Transaction Amount,
Transaction Amount, Transaction Date, Transaction Type`

- `Transaction Date` format: `MM/DD/YYYY`.
- `Transaction Amount` = absolute value (always positive, `$` formatted).
- `Net Transaction Amount` = signed; **credits appear negative** (e.g. `-$1,500.00`).
- `Transaction Type` ∈ `{Debit, Credit}`.
- `Account Number` = last 4 digits.

### Bank accounts
Accounts are identified only by the `Account Number` last-4 column. The seed creates one
account per distinct last-4 value; names/types are filled in afterwards.

### Transaction categories (17)
`Business, Cash, Debt Repayment, Deposit, Discretionary, Essentials,
Essentials/Discretionary, Fees, Food/Groceries, Interest, Interest/Rewards,
Investing, Rent, Temporary Debt, Transfer, Transportation, Utilities`

These are the "system values" bank CSV rows get mapped to. The import tool must let the
user map new raw categories/descriptions to this set — see [../features/csv-import.md](../features/csv-import.md).

## Data-quality notes / edge cases for the loader

1. Empty `Amount` → NULL (e.g. `Investing` with no amount).
2. Empty `due_day` → NULL (subscriptions on autopay often have none).
3. Negative net amounts on credits.
4. Quoted fields containing commas (CSV) — use a real CSV parser, not split(',').
5. UTF-8 BOM at the start of every CSV (`utf-8-sig`).
6. Duplicate bill names within a month are legitimate (keep both, use sort order).
7. Folder labels say `31` even for 30-day months — derive period from folder prefix
   `MM ... YY`, not the end date.

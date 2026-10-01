# Feature: Internal transfers

**Status:** live · **Entry:** `/transfers`

> Intent confirmed from earlier notes + code copy; flag the user if any of it reads wrong.

## Intent / why
An "internal transfer" is money moved between two of the user's **own** accounts (checking → card
payment, brokerage → checking). In imported CSVs it shows up as **two** transactions: a **Debit**
on the source and an equal **Credit** on the destination. Left alone, the Debit inflates
"spending" and the Credit inflates "income" — double-counting money that never entered or left the
user's net worth. This feature links the two sides so the pair is **excluded from income/spend**,
and surfaces likely pairs for the user to confirm. (Marking transactions `category="Transfer"`
alone fixes most of the skew; detection makes the rest low-effort.)

## What it does
Three groups on `/transfers`: **Linked** (confirmed pairs), **Flagged needing a match**
(one side marked Transfer, no partner), and **Suggestions** (auto-detected likely pairs). The user
links, unlinks, marks/unmarks, or dismisses a suggestion. A month filter scopes what's displayed.

## How it works today
- Page: `src/app/transfers/page.tsx` (`TransfersPage`, reads `?period=YYYY-MM`).
- **Pure detection engine** (no DB, unit-testable): `src/server/lib/transfers.ts` —
  `detectTransfers()` produces linked / unmatched / suggestion groups.
- Query wiring: `src/server/queries.ts` `getTransfersData(periodLabel?)` — loads all txns +
  dismissals, runs `detectTransfers`, then filters *displayed* groups by month.
- Actions: `src/server/actions/transfers.ts` — `linkTransfer`, `unlinkTransfer`,
  `dismissSuggestion`, `markAsTransfer`, `unmarkTransfer` (each calls `refresh()` →
  revalidates `/transfers`, `/dashboard`, `/transactions`).
- UI: `src/components/transfers/TransfersManager.tsx`.

## Non-obvious logic / edge cases
- **A transfer is not a first-class entity** — it's a *pairing of two `transactions` rows* plus a
  category flag. Two mechanisms: `transactions.category = "Transfer"` (drives exclusion) and
  `transactions.transfer_partner_id` (self-FK; both rows point at each other, symmetric).
- **Exclusion keys off the category flag, not the link.** A one-sided flagged transfer (partner
  never imported) is *still* excluded from cashflow. The reused SQL condition is `notTransferCond`
  (`queries.ts`): `(category IS NULL OR category <> 'Transfer')`, applied in top-spend/deposit,
  cashflow, category-spend, and recurring-suggestion queries.
- **Matching predicate**: equal absolute `amount` + opposite `direction` + **different account** +
  within `windowDays` (default **4**). Amount is always positive magnitude; greedy nearest-date
  pairing with a `used` set so each txn matches once.
- **Mutual-reciprocity guard**: a pair is "linked" only if both sides point at each other — guards
  against stale one-way links. `linkTransfer` proactively nulls any prior partners on both ids and
  auto-sets `category="Transfer"` on both (atomic `db.transaction`).
- **Dismissals are per-pair, not per-txn** (`transfer_dismissals`, normalized `(low_id, high_id)`
  unique index) — dismissing one debit↔credit combo still lets that debit match a different credit.
- **Caps**: suggestions capped at 50, candidate lists at 6 — very large datasets could hide valid
  matches beyond the cap.
- **Month filter is display-only**: detection always scans all data (so cross-month counterparts
  match); only shown groups are filtered to those touching the selected month.
- **`ON DELETE no action`** on the self-FK — deleting a transaction that's still someone's partner
  can leave a dangling reference; nothing auto-nulls it.

## Data model
- `transactions.transfer_partner_id` — self-FK (`schema.ts`), migration
  `drizzle/0003_add_transfer_link.sql`.
- `transfer_dismissals` — `low_id`/`high_id` + `uq_dismissal`, migration
  `drizzle/0004_add_transfer_dismissals.sql`.
- Category constant `"Transfer"` in `src/constants/enums.ts` (color `#64748b`, emoji 🔁).

## How to extend it
- **Loosen/extend matching** (fuzzy amounts, description similarity, different window): edit the
  pure `detectTransfers` in `src/server/lib/transfers.ts` (has an `opts` bag; unit-testable).
- **Exclude transfers from a new aggregate**: reuse the `notTransferCond` pattern from
  `queries.ts`.
- **New action** (e.g. bulk-confirm suggestions): add a `"use server"` fn in
  `actions/transfers.ts` following `linkTransfer`'s atomic transaction + `refresh()`.

## Related
- Engine consumer: [dashboard.md](dashboard.md) (cashflow excludes transfers) ·
  [categorization.md](categorization.md) (the `Transfer` category)

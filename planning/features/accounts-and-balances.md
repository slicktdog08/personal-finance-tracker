# Feature: Accounts & balances (unified ledger)

**Status:** live · **Entry:** `/accounts`, `/debts` (+ dashboard cards)

## Intent / why
Every asset and liability is a single `accounts` row, and **every dated balance snapshot for all of
them lives in one table, `account_balances`** — cash-on-hand for checking/savings, amount owed for
credit cards/loans. `/accounts`, `/debts`, and `/dashboard` are three read-only **lenses** over
that one ledger.

**Why debts were folded into accounts:** originally a credit card existed twice — as a `Credit`
account *and* as a `debt` (a bill flagged `is_debt` with its own `debts`/`debt_balances` ledger).
The same card was editable in two places and **double-counted on the dashboard**. Migration 0007
unified them: liabilities are just accounts, recorded in ONE place, so the screens can't disagree.

**Why one dated ledger:** balances are *history, not a single field*. Each snapshot has `as_of`, so
any screen can ask "what was the balance as of end-of-month X" and read past months historically.

Split rule (one account = one screen): `LIABILITY_ACCOUNT_TYPES = ["Credit","Loan"]` → `/debts`;
everything else (Checking/Savings/Other) → `/accounts`. Changing type moves it between screens.

## How it works today
- Pages: `src/app/accounts/page.tsx` (filters OUT liabilities), `src/app/debts/page.tsx`
  (roll-up stat cards + `DebtCard`), dashboard cards in `src/app/dashboard/page.tsx`.
- **All writes** for both screens: `src/server/actions/accounts.ts` — `updateAccount`,
  `createAccount`, `createLiabilityAccount`, `addAccountBalance`, `deleteAccountBalance`. Every
  action calls `revalidateLedger()` → revalidates `/accounts`, `/debts`, `/dashboard` together.
- Reads: `src/server/queries.ts` — `getCashOnHand`, `getLiabilityAccounts`, `getLiabilityLedger`,
  `getLiabilityPaymentTotals`, `getBalanceTrends`, `getAccountBalances`, `getAccountLastTxnDates`.
- Pure math: `src/server/lib/debt.ts` — `monthlyInterest = balance*(apr/100)/12`, `payoffProgress`.
- Enums: `ACCOUNT_TYPES`, `CASH_ACCOUNT_TYPES`, `LIABILITY_ACCOUNT_TYPES` in `enums.ts`.
- Components: `src/components/accounts/AccountCard.tsx`, `src/components/debts/DebtCard.tsx` — both
  write via the same three actions.

## Non-obvious logic — the "as-of" read
Shared by `getCashOnHand` / `getLiabilityAccounts`:
1. Select accounts of the type set.
2. Pull `account_balances` with optional `as_of <= asOf` (no `asOf` = "now").
3. Order `desc(as_of), desc(id)` — newest first, `id` tiebreaks same-date snapshots (last inserted
   wins; there is **no unique constraint** on `(accountId, asOf)`).
4. First row per `accountId` = latest snapshot; null when none on/before `asOf`.

**Carry-forward**: rates rarely change, so a newer snapshot may record only `balance` and omit
`creditLimit`/`apr`/`minPayment`. `getLiabilityAccounts` backfills each null field from the
freshest non-null value seen while scanning newest-first — an omitted APR doesn't blank the
display. `getBalanceTrends` applies the same as-of logic per month-end for the dashboard sparklines
(loan balances clamped ≥0).

## Edge cases / gotchas
- **`transactions.net_amount` is unreliable** (~48% wrong sign) — never `SUM(net_amount)`. This
  ledger is manual-snapshot based so it sidesteps that, but any balance derived from transactions
  must use `SUM(CASE WHEN direction='Debit' THEN amount ELSE -amount END)`.
- **Manual liabilities have a synthesized account number** — `createLiabilityAccount` slugs the
  name (a card/loan you don't import txns for has no real last-4); the label carries the real name.
  It also links a matching unclaimed bill (`accounts.billId`) for payment attribution.
- `getLiabilityLedger` returns raw rows (no carry-forward) → the `/debts` history table shows
  literal per-snapshot nulls as "—".
- `getLiabilityPaymentTotals` attributes payments by joining
  `transactions → bill_instances → accounts.billId` (Debit only) — this is why `accounts.billId`
  exists.

## Data model — live vs legacy
- **Live**: `accounts` (`schema.ts`) — registry with liability facts folded in
  (`originalPrincipal`, `openedOn`, `notes`, `active`, `billId` + `uq_acct_bill`); `account_balances`
  — the one dated ledger (`balance` NOT NULL, `creditLimit`, `apr`, `minPayment`, `asOf`, `note`).
- **Legacy, still DEFINED but unused by app code**: `debts` + `debt_balances` (+ `Debt`/
  `DebtBalance` types). No `src/` code references them — the app is fully cut over.
- Migrations: `0005_add_credit_limit` → `0006_add_debts` (old parallel ledger) →
  `0007_unify_balances` (the unification) → **`0008_drop_debts` — PENDING**. 0008 is a manual
  apply-script (not auto-run on this hyphenated DB); it drops the legacy backup tables. **Finishing
  step**: apply `drizzle/0008_drop_debts.sql`, then delete the `debts`/`debtBalances` defs + types
  from `schema.ts`.

## How to extend it
- **New account type**: add to `ACCOUNT_TYPES` and to `CASH_` or `LIABILITY_ACCOUNT_TYPES` — set
  membership alone routes it to the right lens.
- **New per-snapshot field**: add the column (schema + migration), thread through
  `addAccountBalance`, add carry-forward in `getLiabilityAccounts` if rarely-changing, surface in
  the cards.
- **New lens**: read via the as-of queries and add its path to `revalidateLedger()`.

## Related
- Balance sources: [csv-import.md](csv-import.md), [pdf-import.md](pdf-import.md) (both write
  `account_balances`) · consumers: [dashboard.md](dashboard.md), [savings-goals.md](savings-goals.md)


## UI note (2026-09-20)
`/accounts` shows two cards per row on desktop; each card's recorded-balance ledger is inside a
`<details>` ("History (n recorded)") collapsed by default — the current balance and the Record
form stay visible. `/debts` gained a **High-interest (>10%)** roll-up (owed, count, monthly
interest, share) using `isSnowballDebt`.

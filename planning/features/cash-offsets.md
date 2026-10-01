# Feature: Cash offsets

**Status:** live · **Entry:** `/cash`, plus the expandable withdrawal rows on `/transactions`

## Intent / why

Cash spending was being **counted twice**. An ATM withdrawal arrives from the bank statement as a
$300 Debit categorized `Cash`; the purchases it pays for get hand-entered on the `9999 Cash`
wallet account. Both are real rows, both look like spending, and the app happily added them
together — so the more diligently the user recorded cash purchases, the more wrong the month got.

The obvious fix — edit the ATM row down as purchases are logged — is not available: that row is
re-imported from the statement on every import and has to keep matching the bank. So the link
lives beside it instead, in its own ledger.

The rule the user set, and the one the whole feature turns on:

> It's the same money. But if there are no transactions to offset the cash withdrawal, that still
> counts as real spending — it's just unaccounted for.

So an offset never *erases* money. It only **moves it from "unaccounted cash" to the category it
was actually spent on**. A withdrawal nobody explained stays 100% spending, because it is.

**A withdrawal is explained two ways.** Either it bought something (an allocation), or the cash is
**still in your pocket** — withdrawn but not spent, an asset rather than an expense. Only a manual
count can tell those apart; nothing in the bank feed knows. So the wallet's counted balance is the
second half of the reconciliation:

```
cash actually spent in a month = opening pocket + withdrawals − closing pocket
```

Added 2026-08-20, after the first cut counted held cash as both spent and held. Per the user's
call, that correction is applied at **month level** (dashboard + `/cash`); individual withdrawal
rows on `/transactions` keep showing their full un-offset amount.

**Month attribution follows the cash, not the withdrawal.** Withdraw $300 on Aug 30 and August
carries all $300 as spending. Log $120 of it against September purchases and August drops to $180
while September carries the $120 under Gas, Groceries, or whatever it bought. Confirmed with the
user 2026-08-20: that retroactive shift is the intent, not a side effect.

## What it does

- Entering a purchase on a wallet account offers **"Offset cash withdrawals"**, pre-selected to
  the withdrawal that most likely funded it, with the amount pre-filled. When no single
  withdrawal covers the price, the form plans a **split** across several (a $470 purchase against
  a $300 + $200 withdrawal drains one and takes the rest from the other), and a "+ Draw the
  other …" row lets more withdrawals be added by hand.
- A withdrawal row on `/transactions` **expands** to show what its cash bought, how much is
  accounted for, and how much still isn't — and can be linked/unlinked there.
- `/cash` is the month's reconciliation screen: withdrawals with their unaccounted balances on one
  side, cash purchases still needing a source on the other, one-click linking between them, a
  **Suggest matches** pass for backfilling history, and **Count my cash** for recording what's
  actually in your pocket. The four totals are shown adding up, in words.
- The wallet's counted balance shows as **Pocket** on the dashboard's Cash-on-hand tile, and comes
  off that month's cash spending.
- Every spend rollup (dashboard categories, cash-flow chart, `/transactions` totals, highest
  spending) counts a withdrawal for its **unaccounted remainder only**.

## How it works today

Two definitions drive everything, both data-derived rather than hardcoded:

- **Cash source (withdrawal)** — a `Debit` on an account that isn't a wallet, with a *cash
  portion*: categorized **`Cash`** (`CASH_SOURCE_CATEGORY`), or with a part split off as `Cash`
  (cash back at a register — see [transaction-splits.md](transaction-splits.md)). It can hand
  out only its cash portion (`cashPortion` in `queries.ts`, `cashPortionOf` in `lib/cash.ts`). Descriptions vary far too much to match on ("ATM Withdrawal - CVS…",
  "Digital Card Purchase - APPLE CASH BALANCE ADD…", "Zelle money sent to J DOE"), so the
  category is the switch: categorize a row as `Cash` and it becomes offsettable.
- **Wallet purchase** — a `Debit` on an account whose `account_type` is **`Cash`**
  (`WALLET_ACCOUNT_TYPES`). Account 9999 was switched to that type by `drizzle/0016`; a second
  wallet just works.

Files:

- `src/server/lib/cash.ts` — pure matching. `canFund`, `defaultWithdrawalFor` (single best
  pick), `defaultOffsetsFor` (entry-form plan, splitting across withdrawals when none covers the
  price), `proposeAllocations` (backfill), `DEFAULT_LOOKBACK_DAYS`, `SUGGEST_WINDOW_DAYS`.
- `src/server/queries.ts` — `allocatedByWithdrawal()` / `coveredBySpend()` derived tables,
  `unaccountedAmount()` (the row-level rollup expression), `getCashHeld` /
  `getCashHeldByPeriod` / `carryInFundedByPeriod` / `effectiveHeldByPeriod` (the month-level
  pocket correction; the reconciliation rules live in `effectiveHeld` in `lib/cash.ts`),
  `getCashOverview`, `getCashWithdrawals`, `getWalletSpends`, `getWithdrawalDetail`,
  `getOpenWithdrawals`, `getWalletAccounts`.
- Dashboard reconciliation: `getCategorySpend` (the `Cash` slice) and `getCashflowByPeriod`
  (Outgoing) both subtract the month's pocket delta; the Cash-on-hand tile in
  `src/app/dashboard/page.tsx` sums **every** cash-type account, wallet included.
- `src/server/actions/cash.ts` — `allocateCash`, `unallocateCash`, `clearWithdrawalAllocations`,
  `suggestCashAllocations`, `applyProposals`, `loadWithdrawalDetail`,
  `reconcileAllocationsAfterEdit`.
- `src/app/cash/page.tsx` + `src/components/cash/CashManager.tsx` — the reconciliation screen.
- `src/components/transactions/CashOffsetDetail.tsx` — the expanded withdrawal panel (reused by
  both `/transactions` and `/cash`).
- `src/components/transactions/AddTransaction.tsx` — the offset rows on entry;
  `createTransaction` carries `offsets: {withdrawalId, amount}[]` and applies them one at a
  time so each allocation clamps against what the earlier ones took.

## Non-obvious logic / edge cases

- **`unaccountedAmount()` is the whole accounting rule.** Every spend rollup joins
  `allocatedByWithdrawal()` and sums `GREATEST(amount - COALESCE(allocated,0), 0)` instead of
  `amount`. Rows with no allocations — nearly all of them — COALESCE straight back to `amount`, so
  it's a no-op everywhere else. A new rollup that sums raw `transactions.amount` silently
  reintroduces the double count.
- **`GREATEST(…, 0)`** is a hard floor: an offset must never be able to subtract from real
  spending, whatever the data does.
- **Allocations carry an amount** rather than being a plain FK on the purchase. One $300
  withdrawal covers many purchases, and one purchase can draw on two withdrawals.
- **Amounts are clamped, never rejected**, in `allocateCash`: never more than the withdrawal has
  left, never more than the purchase costs. That's what makes double-counting structurally
  impossible regardless of what the UI sends.
- **Editing a transaction reconciles its links** (`reconcileAllocationsAfterEdit`): cutting a
  withdrawal's amount below what's allocated trims the newest links first; moving a purchase off
  the wallet or flipping it to a Credit drops its links entirely.
- **Deleting either side cascades** (FK `ON DELETE CASCADE`) — an allocation is meaningless
  without both halves.
- **The pocket delta is signed, and both directions matter.** `closing − opening` comes OFF a
  month's cash spending when positive (you kept the cash) and goes ON when negative (you spent
  down cash carried in — real spending with no transaction behind it). Clamping the negative case
  to zero *loses money*: the month you carried that cash in already excluded it from spending
  precisely because you still had it. When a drawdown is a month's only cash spending there's no
  `Cash` row to adjust, so `getCategorySpend` synthesizes one.
- **The pocket correction is capped above at unaccounted** (`effectiveHeld`): it can't explain
  more than that month's withdrawals left unaccounted, so a pocket that grew from cash the app
  never saw (a gift, a side job) can't quietly erase unrelated spending. A drawdown has no such
  ceiling — it's spending, however large.
- **A drawdown is netted against carry-in funding** (`effectiveHeld`, `carryInFundedByPeriod`).
  Fixed 2026-09-08, after a month showed a $50 `Cash` slice against a $100 withdrawal that was
  fully allocated. Two independent mechanisms move carried-in cash from the month it was
  withdrawn to the month it was spent, and they were stacking:

  1. an allocation to an **earlier** month's withdrawal takes the money off *that* month's `Cash`
     slice and books the purchase under its own category here — month attribution follows the
     cash, as above;
  2. the pocket drawdown adds the same money to this month as spending nobody logged.

  Both fired on the same $50, so the month counted $200 of cash spending against $150 of real
  outflow. `carryInFundedByPeriod` sums the allocations whose withdrawal month precedes their
  purchase month, and `effectiveHeld` cancels the drawdown by that much. The netting **floors at
  zero**: carry-in can only cancel a drawdown, never turn it into held cash. Only earlier→later
  counts — a purchase dated a day or two *before* its withdrawal is posting lag, not carry-in.
  The two figures reconcile only when a month's wallet spending was funded entirely by that same
  month's withdrawals, which is why this stayed invisible until the first month that carried cash
  across a boundary and then spent it.
- **`/cash`'s "unaccounted" and the dashboard's `Cash` slice can differ legitimately**, by any
  wallet purchase the user filed under the `Cash` category itself. `/cash` measures cash whose
  fate is unknown; the category chart measures what's filed under `Cash`.
- **Two different time windows, on purpose.** The manual picker offers withdrawals up to
  `DEFAULT_LOOKBACK_DAYS` (45) back — you know where your cash came from. Automatic suggestions
  only reach `SUGGEST_WINDOW_DAYS` (14), because a link moves spending between months and a
  six-week-old guess would quietly drop June's spending for a purchase made in August.
- **Ranking prefers the most recent withdrawal dated on or before the purchase** (`fundingRank`).
  A withdrawal dated slightly *after* is only considered when nothing earlier qualifies — bank rows
  post late (`POST_LAG_DAYS` = 3), but that slack must not let a not-yet-happened withdrawal
  outrank the one actually spent from.
- **Suggestions propose nothing for a purchase with no plausible source.** Unfunded cash spending
  is a real signal (cash from somewhere the app doesn't know about), not an error to paper over.

## Data model

`cash_allocations` — `drizzle/0016_add_cash_allocations.sql`, schema at
`src/server/db/schema.ts` (`cashAllocations`). One row = "$X of withdrawal W paid for purchase S".
Unique on `(withdrawal_txn_id, spend_txn_id)`; both FKs `ON DELETE CASCADE`.

The same migration sets account 9999 to `account_type = 'Cash'`; `Cash` was added to
`ACCOUNT_TYPES` and `CASH_ACCOUNT_TYPES` (so the wallet still counts as cash on hand) plus the new
`WALLET_ACCOUNT_TYPES` in `src/constants/enums.ts`.

## How to extend it

- **Another wallet** (Apple Cash, a spouse's cash): set that account's type to `Cash`. No code.
- **Another kind of cash source**: categorize it `Cash`. No code.
- **A new spend rollup**: join `allocatedByWithdrawal()` and sum `unaccountedAmount()`. If it's
  month-scoped and counts cash, also subtract `effectiveHeldByPeriod()` for that month.
- **Tune the matching**: `SUGGEST_WINDOW_DAYS` / `DEFAULT_LOOKBACK_DAYS` / `fundingRank` in
  `src/server/lib/cash.ts` — all pure, all in one file.

## Related
- Sibling features: [transfers.md](transfers.md) (the other "this isn't new money" mechanism),
  [accounts-and-balances.md](accounts-and-balances.md), [categorization.md](categorization.md)
- Decisions: [../design/07-decisions.md](../design/07-decisions.md) (D6)

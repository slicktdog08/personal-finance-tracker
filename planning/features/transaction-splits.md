# Feature: Transaction splits

**Status:** live · **Entry:** the ✂ button on each `/transactions` and `/months/[period]` row; MCP `split_transaction`

> Intent from the user's request 2026-09-26: "split a single transaction into two … categorize a
> piece of a transaction in one direction and another piece in the other. It should always add up
> to the full transaction still. It's very similar to what we do for cash." Choices below the
> quote (remainder model, Transfer pieces) were inferred; confirm. Follow-up the same day: a
> part split off as `Cash` (cash back — "$40 with $20 of cash back") must "still function as
> cash downstream".

## Intent / why

One charge is sometimes two things — a $100 Target run that's $60 of groceries and $40 of
household. A single category per row forces one of them to be wrong.

The bank row can't be cut into two rows: it's re-imported from the statement on every import
and has to keep matching it (same reason as [cash offsets](cash-offsets.md)). So the split lives
**beside** the row, in its own table.

**The row's own category keeps the remainder.** A split stores only the pieces carved *off*;
whatever they don't claim stays in the transaction's category. There's no second "parent share"
number that could drift, so the parts add up to the full amount by construction — the user's
"it should always add up" rule is structural, not a validation.

**Cash back is cash.** A $40 grocery charge that included $20 cash back is split into $20
Groceries + $20 `Cash`. That $20 is money you took out, exactly like an ATM withdrawal, so the
cash-offset machinery treats it as one: see "Cash parts" below.

## What it does

- ✂ on a row opens **Split across categories**: the row's category ("Keeps the rest", with the
  live remainder), then one or more "Split off" parts (category + amount), "+ Add another part",
  and a "Half" shortcut for the common two-way split. **Unsplit** removes it.
- A split row shows its parts under the category: `✂ $60.00 here  + $40.00 [Household]`.
- Category rollups (dashboard category chart, budget actuals, budget history inputs, MCP month
  summaries) count each part in its own category.
- Filtering `/transactions` (and `getTransactions`, the month page's loader) by a category also
  finds rows with a *part* in that category; the `/transactions` filtered totals count only the
  matching part.
- A `Cash` part makes the row a cash withdrawal for [cash offsets](cash-offsets.md): it shows up
  on `/cash`, in the wallet-purchase offset picker and suggestions, expands on `/transactions`
  ("$20.00 cash unaccounted"), and counts in the pocket reconciliation.
- The budget's "unassigned debt payments" counts Debt Repayment by part too.

## How it works today

- `src/server/actions/splits.ts` — `setTransactionSplits` (validate + replace all parts in one DB
  transaction; optionally changes the remainder's category), `reconcileSplitsAfterEdit`.
- `src/server/queries.ts` — `splitByTxn()` (per txn: SUM of parts as `split`, SUM of `Cash`
  parts as `cashSplit`), `cashPortion()`, `ownShare()`, `pieceShare()`, `pieceNotTransferCond`,
  `getSplitsFor()`. Used by `getCategorySpend`, `getCashflowByPeriod`, `getTransactionsPage`,
  `getTransactions`, `getBudgetView` (unassigned Debt Repayment) and every cash-offset query
  (`cashSourceConds`, `getCashWithdrawals`, `getWithdrawalDetail`, `cashUnaccountedByPeriod`).
- `src/server/lib/cash.ts` — `cashPortionOf` (pure twin of `cashPortion`, used by the UI and
  actions). `src/server/actions/cash.ts` — `cashPortionFor(txnId)`.
- `src/components/transactions/SplitTransaction.tsx` — `SplitTransaction` (button + Sheet
  editor) and `SplitSummary` (the parts line under the category). Used by `TransactionsTable`
  and `MonthTransactions`.
- `src/server/mcp/tools-write.ts` — `split_transaction`; `list_transactions` returns `splits`.

## Non-obvious logic / edge cases

- **Only category-grouped rollups look at parts.** They sum `ownShare()` per row's category plus
  each part per its category (two queries, merged in JS). Rollups that don't group by category
  (`/transactions` unfiltered totals, highest spending) keep using the whole row — the parts add
  back up to it. A new category rollup that groups raw `transactions.category` silently ignores
  splits.
- **Transfer is per part.** A row's own share is excluded when its category is `Transfer`; a part
  is excluded when *its* category is. So a Zelle marked Transfer with a $25 Gifts part counts $25
  of spending, and a part filed as Transfer drops out of spending. `getCashflowByPeriod` follows
  the same rule, so the dashboard's Outgoing and category chart agree.
- **Parts must leave at least a cent** in the row's own category. Taking the whole amount is a
  recategorization, not a split, and is rejected.
- **Cash parts (cash back).** The *cash portion* of a row is its `Cash` parts plus, when its own
  category is `Cash`, its own share (`cashPortion` / `cashPortionOf`). Any non-wallet Debit with
  a cash portion is a withdrawal, and a withdrawal can only hand out its cash portion to wallet
  purchases (`allocateCash` clamps to it). So the $40-with-$20-cash-back row offers $20, never
  the groceries. An ATM withdrawal can be split too (say $100 of it was a gift): its cash
  portion shrinks to the rest.
- **Offsets come out of `Cash` parts first.** In category rollups `pieceShare` reduces each
  `Cash` part by the row's offsets (pro rata across several), and `ownShare` only loses what the
  parts couldn't absorb. For a plain ATM row (no parts) that's exactly the old
  `amount − allocated`. Rollups that don't split by category still use `amount − allocated`,
  which is the same total.
- **A split can't strand an offset.** `setTransactionSplits` refuses a split (or unsplit) that
  would leave less cash than is already offset against purchases; unlink on `/cash` first.
  Edits reconcile **splits first, then offsets** (`updateTransaction`, `mergeIntoPosted`), so a
  trimmed `Cash` part trims the offsets drawing on it. A row with offsets but no cash portion
  (recategorized after offsetting) keeps its face value as the offset limit, as before.
- Wallet *purchases* can be split freely — funding and category are independent.
- **Edits trim, never reject.** `updateTransaction` calls `reconcileSplitsAfterEdit`: if the
  amount shrinks under the parts, the newest parts are trimmed then dropped until a cent remains
  for the row's own category. Merging a pending row carries its parts to the posted row (unless
  that one is already split) and trims the same way.
- **Category rename/delete carry parts.** `renameCategory` renames parts; `deleteCategory` counts
  parts as usages (so it demands a reassignment target) and reassigns them.
- Rules and bulk-categorize only touch the row's own category; parts are always by hand.

## Data model

`transaction_splits` — `drizzle/0023_add_transaction_splits.sql`, schema `transactionSplits`.
One row = "$X of transaction T belongs in category C". FK `ON DELETE CASCADE`.

## How to extend it

- **A new category rollup**: join `splitByTxn()`, sum `ownShare()` by the row's category, then
  add a second query over `transaction_splits` grouped by the part's category (see
  `getCategorySpend`).
- **Splits on another screen**: load parts with `getSplitsFor(ids)` (or use `getTransactions`,
  which attaches them) and render `SplitSummary` / `SplitTransaction`.
- **A new cash query**: join `splitByTxn()` and use `cashSourceConds(walletIds, st)` /
  `cashPortion(st)` — never `category = 'Cash'` alone, or cash back disappears from it.

## Related
- Sibling features: [cash-offsets.md](cash-offsets.md) (same side-ledger pattern),
  [categorization.md](categorization.md), [transfers.md](transfers.md)

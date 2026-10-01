# Feature: Pending transactions

**Status:** live (migration `drizzle/0022_add_txn_pending.sql` must be applied) · **Entry:**
`/transactions` (Add/Edit → "Pending", pending tray, "Pending only" filter), `/import` preview

> One feature, end to end. When the doc and the code disagree, the code wins; fix the doc.

## Intent / why
Intent stated by the user on 2026-09-24:
- Bank export files don't carry **pending** transactions, so a charge made today is invisible until
  it posts. The user wants to enter those by hand and flag them as pending.
- Entering a charge by hand and then importing the statement that contains it creates a
  **duplicate** the exact dedup hash can't see: the typed name rarely matches the bank's, the bank
  posts a few days later, and the amount can differ (a tip added after the card was authorized).
  Account and date "more or less" line up; the amount is close but not exact.
- So: mark transactions pending, and make it easy to dedupe them once the posted row arrives.

Design choices that follow:
- **Merge, don't delete-and-reimport.** The statement wins on bank facts: the **description**
  (the bank's name is the title), the settled **amount** (net amount too), the **posting date**
  (and so the month), and the bookkeeping that keeps re-importing the same statement a no-op
  (dedup hash, import batch, raw, source). What the user added stays: category, notes, bill link,
  transfer partner, cash offsets, split. The hand-entered description moves into notes when it
  differs from the bank's. (Intent restated by the user on 2026-09-30: settling must never blank
  the category or make them set it again; the bank's name stays the title.) Both settle paths —
  auto `finalizes` and a ticked merge — build notes the same way (`settledNotes`).
- **A pick in the preview beats the pending entry.** Import-preview rows that settle a pending
  entry show *its* category ("from pending"). Only a category the user picks there by hand
  (`PreviewRow.categoryPicked`) replaces it; a rule's guess from the bank's description never does.
- **Pending still counts.** A pending charge is real money already spent — it's in every total,
  the dashboard and the budget, exactly like a posted one. The flag only drives matching.
- **Fuzzy match with hard gates.** Same account, same direction, posted date from 3 days before to
  10 days after the entered date, amount within max(30 %, $2). Name similarity only breaks ties.
  Pairing is one-to-one, best score first.
- **Pre-ticked only when safe.** At import, a match is pre-ticked when the hand-entered row is
  marked pending or the amount matches to the cent. Other hand-entered matches are shown unticked
  as suggestions, so an ordinary manual entry is never silently absorbed.

## What it does
- Add/Edit transaction has a **Pending** checkbox; pending rows show an amber *Pending* badge and
  can be filtered with **Pending only** (`?pending=1`). MCP `create_transaction` takes `pending`.
- **Import preview (CSV and PDF):** each new row that looks like a hand-entered transaction shows
  "Replaces your pending entry …" with a checkbox. Ticked rows are merged on commit; the done
  message reports how many.
- **Pending tray** on `/transactions`: every pending transaction, with the posted row it most
  likely became (if imported already) and **Merge** / **Keep both**, or "Waiting for it to post" /
  **Mark posted**. **Merge all** when several have matches. This catches duplicates that got in
  anyway (imported without ticking, or imported before this feature).

## How it works today
- Pure matching: `src/server/lib/pending-match.ts` — `matchScore`, `pairPending`,
  `enteredWindow` / `postedWindow`, and the tolerances (`DAYS_BEFORE`, `DAYS_AFTER`,
  `AMOUNT_PCT`, `AMOUNT_MIN`).
- DB side: `src/server/pending.ts`
  - `attachPendingMatches(rows)` — called by `analyzeWithMapping` (`src/server/actions/import.ts`)
    and `analyzeRows` (`src/server/actions/pdf-import.ts`); sets `PreviewRow.pendingMatch` and
    the default `mergeWith`.
  - `getPendingReview()` — the tray's data (wrapped in `src/server/queries.ts`).
  - `mergeIntoPosted(enteredId, postedId)` — the one merge routine, used by both paths.
- Commit: `commitImport` inserts as usual, then merges each row with `mergeWith` into its newly
  inserted id (looked up by dedup hash). `CommitResult.merged` / `PdfCommitResult.merged`.
- Actions: `setTransactionPending`, `mergePendingTransaction` in
  `src/server/actions/transactions.ts`; `createTransaction` / `updateTransaction` accept `pending`.
- UI: `src/components/transactions/PendingReview.tsx` (tray), `PendingMatchBox` in
  `src/components/import/ImportPreviewTable.tsx`, badge in `TransactionsTable.tsx`.

## Non-obvious logic / edge cases
- "Hand-entered" means `import_batch_id IS NULL AND raw IS NULL`. Seeded history has `raw` but no
  batch and counts as bank data. `mergeIntoPosted` refuses to absorb anything else, so a stale or
  forged id can't delete a statement row (which would just come back on the next import).
- Import matching considers **all** hand-entered rows on the account, not only pending ones; the
  tray considers only rows still flagged pending. "Keep both" / "Mark posted" just clear the flag.
- `transfer_partner_id` has no ON DELETE action, so the partner's back-pointer is moved to the
  posted row before the hand-entered row is deleted.
- Cash offsets are moved to the posted row unless it already has the same (withdrawal, spend)
  pair; `reconcileAllocationsAfterEdit` then clamps them to the posted amount.
- A PDF batch with two statements can match the same pending row twice; the second merge is
  skipped at commit.
- A balance snapshot written by "Apply to account balance" on the pending entry is left alone —
  balances are their own ledger, and the statement's balance column corrects it.
- `TransactionEdit.pending` omitted = unchanged (unlike `notes`, where omitted = cleared).
- Notes from both sides are joined line by line, each distinct line once (`joinNotes`).
- The Import button counts pending settles: a file of only duplicates and settles is importable.
- Bank sync's settle path (`sync.ts`) doesn't yet move the typed description into notes — no
  provider is registered today; bring it in line when one is.

## One pending model, not two

`main` and the bank-sync branch each grew their own pending-transaction implementation in
parallel, and this branch merged them. The reconciliation, so nobody re-litigates it:

- **`transactions.pending` (boolean) is the model.** It won on evidence rather than taste: it is
  the one recorded in `sql_migrations` (`0022_add_txn_pending.sql`) and the one carrying live
  rows. The bank-sync branch's `status` varchar ('posted' | 'pending') had been pushed to the
  database but never tracked, and never held a single pending row.
- **The `status` column still exists and is read by nothing.** It is declared in `schema.ts` only
  so the schema matches the live database — `drizzle-kit push` drops columns a schema omits, and
  dropping a production column to tidy a dead field is not a trade worth making. Delete the
  declaration and the column together, deliberately, or leave both alone.
- **The provider wire format keeps its own vocabulary.** `SyncProvider`'s `TxnStatus` is still
  `'posted' | 'pending'`, and `reconcile.ts` still reasons in those terms — that is the bank's
  language, not a column name. `sync.ts` converts at the database boundary in both directions, so
  the reconciler needed no changes at all and its unit tests were untouched by the merge.
- **Both settle paths survive, because they do different jobs.** `import-guard`'s `"finalizes"`
  rows settle a placeholder automatically when the match is unambiguous; `attachPendingMatches`
  offers `mergeWith` on `"new"` rows for the fuzzier cases the user confirms in the preview. They
  cannot both claim one row: a row matched by the guard is `"finalizes"`, and `mergeWith` is only
  ever offered on `"new"`.

## Data model
- `transactions.pending` BOOLEAN NOT NULL DEFAULT false, index `idx_tx_pending`
  (`src/server/db/schema.ts`, `drizzle/0022_add_txn_pending.sql`).

## How to extend it
- Tune matching in `pending-match.ts` only; both the import preview and the tray follow.
- To carry another user-set field across a merge, add it in `mergeIntoPosted`.
- The month page (`/months/[period]`) doesn't show the badge yet; add `pending` to its query and
  `MonthTxn` if wanted.

## Related
- [csv-import.md](csv-import.md), [pdf-import.md](pdf-import.md) — exact dedup this complements.
- [cash-offsets.md](cash-offsets.md) — offsets move across on merge.

# Feature: CSV import

**Status:** live · **Entry:** `/import` → "CSV file" tab

> This doc owns CSV import **in full** — intent, why, and implementation. (Design docs cover only
> high-level app choices; per-feature detail lives here.) When the doc and the code disagree, the
> code wins — fix the doc.

## Intent / why
Take an **arbitrary bank CSV**, map its columns to our schema, and import it **without
duplicates** — even when the same transaction shows up in overlapping exports. Banks all name and
shape their columns differently, and a person re-downloads overlapping date ranges, so the two
hard requirements are: (1) accept any layout via a mapping step, and (2) never double-import a
transaction. Everything else (categories, balances, account inference) is convenience layered on
top. We deliberately **do not trust bank-provided transaction IDs** — they're inconsistent across
re-exports — so identity is derived from the transaction's real-world facts (see Dedup).

Goals:
1. Accept arbitrary bank CSV layouts (column names differ per bank).
2. Map raw columns → our transaction fields, guessing as much as possible.
3. Auto-categorize via rules; let the user fix the rest before commit.
4. Reject duplicates deterministically.
5. Optionally capture a balance column into the account ledger.
6. Show a clear "N new / M duplicates / E errors" summary and an audit batch.

## Shape of the code
Wizard phases `upload → map → preview → done` in
`src/components/import/ImportWizard.tsx`. Server actions in `src/server/actions/import.ts`
(`inspectCsv`, `analyzeWithMapping`, `commitImport`). **Pure, unit-testable** mapping logic (no
DB / server-only imports) in `src/server/lib/import-map.ts`. Shared serializable types in
`src/server/lib/import-types.ts`. The historical seed (`scripts/seed-history.ts`) reuses the same
`lib/money`, `lib/dedup`, `lib/categorize` so a one-time load and a live import behave identically.

Pipeline: `upload → parse → column-map → normalize → categorize → dedup → preview → commit`.

## 1. Parse
`papaparse`, server-side, `header: true`, BOM-stripped, empty rows dropped (`parseRows`). The
original row object is kept and stored in `transactions.raw` (JSON) for traceability.

## 2. The mapping (`ColumnMapping`)
Auto-guessed from headers + a 5-row sample by `guessMapping()`, editable in the map step.

| Field | Meaning |
|---|---|
| `date`, `description` | required source columns |
| `amount` | the amount column (single-column modes) |
| `amountMode` | `"single"` (one amount col) or `"split"` (separate Debit/Credit cols) |
| `debitColumn` / `creditColumn` | split mode: money-out / money-in columns |
| `directionMode` | single mode: `"sign"` (from amount sign) or `"column"` (a Debit/Credit label col) |
| `negativeIs` / `directionColumn` | config for the two `directionMode`s |
| `accountMode` | `"fixed"` (one account for all rows) or `"column"` (per-row from a column) |
| `accountColumn` / `fixedAccountNumber` | config for the two `accountMode`s |
| `category` | optional source category column |
| `balanceColumn` | optional; an available/running balance → ledger (§5) |
| `netAmount` | optional; a bank's own signed figure. Overlaps amount+direction and is unreliable — usually left unmapped |

### Amount & direction — three layouts (intent: never let a "Type" column masquerade as direction)
Every row normalizes to **`amount` (magnitude) + `direction`** (`Debit`/`Credit`). A bank's
free-form "Type" (Sale/Payment/Fee) must never leak into direction — it isn't one.
1. **One signed amount column** — direction from the sign (`negativeIs`, default negative = Debit).
2. **Amount + a Debit/Credit label column** — direction from that column, but only values that are
   truly `debit/credit/dr/cr/withdrawal/deposit` qualify (`DIR_VALUE`).
3. **Separate Debit & Credit columns** (Capital One, many CU exports) — the amount is in whichever
   of the two columns is non-empty/non-zero, and that column *is* the direction. Auto-detected
   when a debit-ish and a distinct credit-ish header both exist.

### Account detection is resilient (name **+** value shape)
Why: a bank might name the column anything. `guessAccountColumn()` scores each column (threshold 3):
- **Name** signal: `account/acct/card/member/ending/last4` → strong; a bare `no./number/#` → weak;
  `check/routing/ref/confirmation` → penalized.
- **Value shape**: masked refs (`****1234`, `xxxx-1234`, `ending in 1234`) score high even under a
  bespoke header; bare numbers (last-4 or full account #) score lower and need a naming hint, so a
  check-# / ZIP / phone column isn't mistaken for an account.

If the resolved account column holds a **single** value across the whole file, `inspectCsv`
preselects that account in **fixed** mode (dropdown auto-selects it if it already exists); the user
can still change it or switch back to per-row. If a file has **no** account column, the user picks
one account (or types a new last-4) applied to all rows.

### Amount column detection
Word-bounded on `Amt`/`Amount` (won't match "Payment"), prefers a transaction/posted amount, and
excludes `net`/`fee`/`balance`/`available`/`limit`/`interest`. Handles `Transaction Amount`,
`Transaction Amt`, `Amt`.

## 3. Normalize
- **Date**: `parseDateToIso` — `MM/DD/YYYY` and common variants → ISO `YYYY-MM-DD`.
- **Money**: `lib/money.parseMoney` handles `$1,100.00`, `-$1,500.00`, `(123.45)`, `""` → null.
  `amount` = magnitude; `netAmount` = signed (or derived from direction).
- **Account**: reduced to last-4 (`last4`); a new `accounts` row is created on commit if unseen.
- **Description**: kept for display; normalized (trim/collapse/upper) only inside the hash.

## 4. Categorize
Applies saved `category_mappings` in `priority` order (`lib/categorize`): `equals`/`contains`/
`regex` against `description` or `rawCategory`, first match wins → sets `category` and optionally a
bill link via `billId`. Unmatched rows keep a raw category only if it's already a known system
category, else fall to uncategorized (so a bank's "Personal"/"Travel" doesn't pollute). Each
preview row carries `categoryRuleId` (the rule that picked it) and the review shows it as a chip
you can edit/delete in place; picking a category by hand clears it and offers to save a rule
(`ImportCategoryCell`), which is then applied to the other rows on screen too. The stamp is
persisted on commit. See the categorization
feature doc for the engine.

## 5. Balances → `account_balances` ledger
When `balanceColumn` is mapped, `buildBalanceSnapshots()` collapses per-row running balances to
**one end-of-day snapshot per (account, day)**. Intent: the ledger is a dated as-of history; one
row per transaction would be intra-day noise. It auto-detects file order (newest-first vs
oldest-first) from the first-vs-last date so the correct row wins when a day has several. On commit
these insert into `account_balances`, **idempotent per (account, as-of date)** — a re-import won't
pile up duplicates — and are recorded **even if every transaction is a duplicate** (so you can
re-import a statement just to backfill balances). Same ledger the manual-entry and PDF-statement
flows use. Preview shows a banner of what will be recorded; the done screen reports the count.
The field is labeled **"Available balance"** because that's what this ledger tracks here.

## 6. Dedup — the core requirement
Each row gets a stable fingerprint (`lib/dedup.hashRows`):
```
dedup_hash = sha256(
  account_number_last4 | txn_date_iso | amount.toFixed(2) | normalizedDescription | direction | #occ
)
```
- A `UNIQUE` index on `transactions.dedup_hash` is the hard guarantee; commit uses
  `INSERT ... ON DUPLICATE KEY UPDATE id=id` (effectively INSERT IGNORE) and counts new vs skipped.
- **Intra-day occurrence index (`#occ`) — the subtle bit, do not "fix" by accident.** Genuinely
  identical same-day transactions (e.g. three identical `$5.00 COFFEE SHOP` charges on one day,
  which does happen) would collapse to one under a pure hash. So within a single import the Nth
  identical row gets suffix `#N`. Re-importing the same file reproduces the same sequence → still
  deduped; true duplicates are preserved.

Why these fields: account + date + amount + description + direction uniquely identifies a
real-world transaction across re-exports; bank IDs are not reliable across exports.

## 7. Commit (`commitImport(filename, rows, balances?)`)
Upserts referenced accounts, records balance snapshots (§5), writes an `import_batches` audit row,
then chunked (200) `INSERT ... ON DUPLICATE KEY UPDATE` of the `new` rows tagged with the batch id
and `period_id` (from `txn_date`). Returns `{ inserted, duplicates, errors, batchId,
balancesRecorded }`. **The PDF import path reuses this same function** — keep the `balances` arg
optional.

## Extending it — where to look
- **New bank layout won't auto-map?** It's still importable via the manual mapping UI. To improve
  the *guess*, adjust the detectors in `guessMapping`/`guessAccountColumn` (`import-map.ts`) and add
  a case to the pure test harness.
- **Per-row balances** instead of end-of-day → change `buildBalanceSnapshots`.
- **Extra dedup safety** if a bank exposes a stable reference column → fold it into the hash.
- **Saved per-source mappings** (one-click repeat imports) are still unbuilt — a natural next step.

## Related
- Sibling feature: [pdf-import.md](pdf-import.md) · engine: [categorization.md](categorization.md) ·
  ledger target: [accounts-and-balances.md](accounts-and-balances.md)
- Locked choices: [../design/07-decisions.md](../design/07-decisions.md) (D5)

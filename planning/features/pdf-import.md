# Feature: PDF statement import

**Status:** live · **Entry:** `/import` → "PDF statements" tab

## Intent / why
Some accounts only hand you PDF statements, no usable CSV export (e.g. Robinhood Spending). This
path reuses the **entire CSV dedup/categorize/commit machinery** but drives it from **text
extracted out of PDFs**. What it adds over CSV: per-issuer parsing, **statement balances** (opening
as of period start, closing as of period end → dated snapshots in `account_balances`), and
multi-file batch upload with cross-statement dedup. No OCR — these are text PDFs.

## How it works today
- Tab shell: `src/app/import/page.tsx` → `src/components/import/ImportTabs.tsx` (csv/pdf toggle).
- Client wizard: `src/components/import/PdfImportWizard.tsx` (`upload → review → done`). Guards:
  `MAX_FILES=12`, `MAX_FILE_MB=15`, `MAX_TOTAL_MB=18`; base64-encodes files (chunked, to dodge
  `String.fromCharCode` arg limits); re-analyzes on account change (stale-response guarded, carries
  over user-set categories); per-balance record toggles.
- Server actions: `src/server/actions/pdf-import.ts` — `parsePdfStatements` (decode → `extractPdf`
  → `detectAndParse` → `analyzeRows`), `analyzeStatement` (re-analyze on account change),
  `commitPdfStatements`.
- PDF lib: `src/server/lib/pdf/` — `extract.ts` (`extractPdf` via **unpdf**), `lines.ts`
  (`groupItemsToLines` — reconstructs visual lines from positioned text by baseline-y grouping,
  tolerance 3), `registry.ts` (`PARSERS`, `detectAndParse`), `parsers/robinhood.ts` (the template),
  `types.ts` (contracts).
- Config: `next.config.ts` — `serverExternalPackages: ["unpdf"]` (or Turbopack bundles pdf.js and
  breaks), `bodySizeLimit: "25mb"` (base64 adds ~33%).

## The parser registry — how to add an issuer
A `StatementParser` (`types.ts`) has `id`, `label`, `detect(text) => boolean` (cheap sniff), and
`parse(lines, text, pages?) => ParserResult`. Registration is first-match: `PARSERS` array in
`registry.ts`; `detectAndParse` runs the first whose `detect` passes, else the statement is flagged
unrecognized. **To add one:**
1. Copy `parsers/robinhood.ts`.
2. `detect` = a text sniff (Robinhood's = regex for "robinhood" + "spending statement").
3. `parse` = scrape header metadata via regex over `text` (account last-4, opening/closing balance,
   period start/end), then walk `lines` with a row regex to emit `ParsedTxn[]`; push
   unmatched-but-txn-looking lines to `notes` rather than dropping them silently.
4. Add it to `PARSERS` in `registry.ts` — **nothing else changes** (analyze/dedup/categorize/
   commit/balances/UI are all generic off the contract).
5. When a PDF is unrecognized the UI shows the first 12 extracted lines (`sampleLines`) — paste
   those in as your spec. Test with `npx tsx scripts/test-pdf.ts <path.pdf>`.

Robinhood's row regex uses two money columns where `--` marks the empty side, so **column position
determines Credit vs Debit**; `mdyToIso` range-validates dates so a stray match can't inject an
impossible date.

## Credit card statements
`parsers/capitalone-card.ts` (Capital One cards) is the model for a liability account:
- **Balances are amounts owed.** Opening = "Previous Balance", closing = "New Balance". The generic
  check (opening + credits − debits == closing) has the wrong sign for that, so the parser returns
  its own `reconciled`: previous + charges − payments/credits == new. Each kind of row (payments
  and credits, transactions, fees, interest) is also compared with its Account Summary figure, and
  a mismatch becomes a note naming the kind that is short.
- **Direction:** purchases, fees and interest are `Debit`; payments, refunds and reward credits
  (printed with a leading `- `) are `Credit`.
- **Interest has no row date** — it is imported as one `Debit` per non-zero "Interest Charge on …"
  line, dated the period end.
- **Dates:** the transaction date is used (it can fall a few days before the period starts); the
  post date is kept in `raw.postDate`. Rows print no year, so it is inferred from the period.
- **Foreign purchases** add three lines under the row (original amount, currency, rate). They are
  attached to the row as `raw.foreignAmount / foreignCurrency / exchangeRate`, not treated as rows.
- **Credit limit:** `meta.creditLimit` flows into the closing balance snapshot, so utilization
  history comes with the import. The opening snapshot carries none.

## Investment statements (brokerage, crypto)
A brokerage or crypto statement is not a cash ledger, and treating it as one corrupts the
rollups: income/spend totals count every row that isn't categorized `Transfer`, so a `$2,000` buy
would read as `$2,000` spent and the later sale as income. The rule the Robinhood brokerage and
crypto parsers follow:

| What the statement shows | What is stored |
|---|---|
| Portfolio value (holdings + uninvested cash), opening and closing | `account_balances` snapshots |
| Cash events: card purchases, bank transfers, fees, margin interest, dividends, interest | `transactions`, like any bank row |
| Trades, option events, moves between brokerage and crypto | `investment_trades` — never `transactions` |
| Holdings at the statement's close | `investment_positions` |

Why this is consistent: the account's balance is its *whole* value, so a trade moves money between
two pockets of the same balance and changes neither net worth nor spending. Only money crossing
the account's edge is a transaction. Market gains show up as the balance drifting between
snapshots, which is what they are.

- **Account type `Investment`** (in `RETIREMENT_ACCOUNT_TYPES`): counts toward net worth, never
  toward cash on hand — same bucket as a 401(k), shown as "Investments".
- **`investment_trades`** (migration 0033): date, `kind` (buy/sell/other), `action` (the
  statement's own code, verbatim), `asset_class` (equity/option/crypto/cash), symbol, name, signed
  `quantity` (negative = left the account), price, and the cash side (`amount` + `direction`, null
  when no cash moved — an expiry, a reward share, coins withdrawn). `dedup_hash` (built in
  `lib/pdf/investments.ts`, same occurrence-index idea as transactions) makes re-importing a
  statement, or its corrected reissue, a no-op.
- **`investment_positions`**: one snapshot per account + date, replaced whole on re-import (rows
  have no natural key — two option contracts share their underlying's symbol).
- **Parsers return** `trades` and `positions` on `ParserResult`; the wizard previews them
  read-only and always sends them on commit (both writes are idempotent, so there is no toggle).
  The accounts page shows the latest holdings and the trade list on the account's card.
- **Reconciliation** can't be "opening + credits − debits = closing" for a market value, so a
  parser may return its own `reconciled` verdict. The brokerage parser sums *every* activity row
  (trade or not) against the printed "Total Funds Paid and Received", and its holdings against
  "Total Securities". Crypto returns `null` (nothing to check).
- **Column-aware parsing.** The brokerage tables print one amount per row under either Debit or
  Credit, with no placeholder in the empty column; flattened to a line the two are identical.
  `extractPdf` therefore also returns `items` (raw positioned text per page) and `parse` receives
  it as an optional third argument. `readTable` in the brokerage parser finds a heading row, takes
  each heading's x as its column start, and assigns cells by x. Multi-line descriptions (security
  name above the row, CUSIP below) are attached to the nearest row by y.
- **Not built:** cost basis and realized gains. Statements don't print them; reconstructing them
  from trades means lots, splits, option exercises and pre-history — use the broker's 1099.

## Text extraction — unpdf, no OCR
`extractPdf` uses **unpdf** (`getDocumentProxy`, bundler-friendly pdf.js, no worker), reads each
page's positioned text items (x=`transform[4]`, y=`transform[5]`), and `groupItemsToLines`
rebuilds columnar lines. Implications: **text PDFs only** — a scanned/image statement yields no
text → flagged unrecognized (no image fallback). Extraction failures are caught → an unrecognized
statement with a "Could not read PDF" note.

## Balances + reuse of commitImport
`commitPdfStatements`: upsert accounts, best-effort stamp `institution`/`accountType`, **batch-wide
`seenHashes`** to fold cross-statement duplicates (per-statement occurrence indexes would otherwise
double-count), then call **`commitImport(s.filename, rows)`** (the CSV commit path) for
transactions. **Balances are recorded in a separate loop** (not through `commitImport`'s optional
`balances` arg): for each chosen `StatementBalance` it inserts into `account_balances` only if no
row exists for that `(accountId, asOf)` — **idempotent per account + as-of date**.

`StatementBalance` (`types.ts`): `{ kind: "opening"|"closing", balance, asOf, creditLimit, note }`.
`buildBalanceSuggestions` emits opening (`periodStart ?? firstTxnDate`) and closing
(`periodEnd ?? lastTxnDate`); each is a checkbox with editable amount/date in the UI (default on).

## Edge cases / gotchas
- `serverExternalPackages: ["unpdf"]` is mandatory; `bodySizeLimit: "25mb"` is the backstop behind
  the client size guards.
- **Cross-statement dedup** needs the batch-wide `seenHashes` guard, else the same txn in two
  statements double-inserts.
- **Stale-response race**: free-text last-4 fires analyze per keystroke; results are applied only if
  the account still matches.
- **Category-edit preservation** on re-analyze; **empty balance input ignored** (won't write $0);
  **idempotent balances** (two statements same as-of → only first recorded).
- Unrecognized PDFs are non-fatal (flagged with `sampleLines`); only detected statements commit.

## How to extend it
Add `parsers/<issuer>.ts` (copy Robinhood) + register in `registry.ts` — that's the only wiring.

## Related
- Shares the commit/dedup/categorize path with [csv-import.md](csv-import.md); engine
  [categorization.md](categorization.md); balances → [accounts-and-balances.md](accounts-and-balances.md)

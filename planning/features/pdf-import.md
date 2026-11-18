# Feature: PDF statement import

**Status:** live · **Entry:** `/import` → "PDF statements" tab

## Intent / why
Some accounts only hand you PDF statements, no usable CSV export (e.g. Robinhood Spending). This
path reuses the **entire CSV dedup/categorize/commit machinery** but drives it from **text
extracted out of PDFs**. What it adds over CSV: per-issuer parsing, **statement balances** (opening
as of period start, closing as of period end → dated snapshots in `account_balances`), and
multi-file batch upload with cross-statement dedup. No OCR — these are text PDFs.

## Supported statements
`PARSERS` in `registry.ts`, in match order (first `detect` wins, so the titled Robinhood
Spending / Crypto sniffs sit ahead of the untitled brokerage one):

| Parser | Statement | Account kind | Section below |
|---|---|---|---|
| `robinhood.ts` | Robinhood Spending | cash | [registry](#the-parser-registry--how-to-add-an-issuer) (the template) |
| `robinhood-crypto.ts` | Robinhood Crypto | investment | [Investment statements](#investment-statements-brokerage-crypto) |
| `robinhood-brokerage.ts` | Robinhood brokerage ("Individual") | investment | [Investment statements](#investment-statements-brokerage-crypto) |
| `capitalone.ts` | Capital One 360 checking + savings | cash, **one result per account** | [Bank statements](#bank-statements-capital-one-360) |
| `capitalone-card.ts` | Capital One credit card (current + pre-mid-2021 layout) | liability | [Credit card statements](#credit-card-statements) |
| `chase-card.ts` | Chase credit card, personal + business (Ink) | liability | [Credit card statements](#credit-card-statements) |
| `zable-loan.ts` | Zable personal loan | liability | [Loan statements](#loan-statements) |

## How it works today
- Tab shell: `src/app/import/page.tsx` → `src/components/import/ImportTabs.tsx` (csv/pdf toggle).
- Client wizard: `src/components/import/PdfImportWizard.tsx` (`upload → review → done`). Guards:
  `MAX_FILES=200`, `MAX_FILE_MB=15`, `MAX_TOTAL_MB=300`; files are parsed in batches
  (`BATCH_FILES=8`, `BATCH_BYTES=6MB`) to stay under the server-action body limit, then sorted
  oldest first; base64-encodes files (chunked, to dodge `String.fromCharCode` arg limits);
  re-analyzes on account change (stale-response guarded, carries over user-set categories);
  per-balance record toggles plus a per-statement "Daily balances (N days)" toggle, all covered
  by the summary list's All/None.
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
`parse(lines, text, pages?) => ParserResult | ParserResult[]` (an array when one statement
covers several accounts — each result becomes its own reviewable statement). Registration is first-match: `PARSERS` array in
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

## Bank statements (Capital One 360)
`parsers/capitalone.ts` reads the 360 statement, which covers **every** deposit account the
customer holds:
- **One result per account section.** A section starts at `<nickname> - <account number>`,
  confirmed by the APY block under it; the product line (`360 CHECKING`) is absent when the
  nickname already is one.
- **Every row carries the running balance**, so each transaction is checked against it — a
  mis-signed or dropped row becomes a note rather than silent drift. Rows that carry only a
  balance (an interest-rate notice) are skipped, not flagged.
- **Wrapped descriptions** put their first line *above* the amount row and the rest below; both
  are rejoined onto the row.
- **Daily balances.** The parser returns `dailyBalances`: the last running balance of each day,
  carried forward over quiet days, so a statement yields a gap-free end-of-day series (see
  [Balances](#balances--reuse-of-commitimport)). Any parser whose statement prints a running
  balance can do the same.

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

**Older Capital One layout (before mid-2021).** Same parser, detected by the absence of the
"Trans Date Post Date" table head. Differences: the header reads `<product> Account Ending in
1234`, months carry a dot (`Dec. 25, 2025`), rows have one date, and a long description wraps
onto the line *below* its row (a payment's `AuthDate` value wraps the same way). The activity
runs down the left half of the page and continues in the right half beside the interest tables,
so whole-page lines splice unrelated text onto rows — the parser rebuilds its lines from `pages`
one column at a time (split at x=320). Credits only ever appear in their own block there, so a
`-` before a purchase's amount is the tail of a wrapped merchant name, not a sign.

**Airline tickets** add `PSGR:` / `ORIG: …, DEST: …` lines under the row; they are kept in
`raw.travel`.

`parsers/chase-card.ts` (Chase personal and business cards — one layout) follows the same
liability rules, with these differences:
- Rows are `mm/dd description amount` with no `$`; a leading minus is a payment or credit, and a
  cents-only amount prints as `.54`. Chase prints headings twice (`ACCOUNT ACCOUNT ACTIVITY
  ACTIVITY`), once for screen readers.
- Fees and interest are ordinary dated rows (`FOREIGN TRANSACTION FEE`, `PURCHASE INTEREST
  CHARGE`), so nothing is synthesised. The summary check groups purchases, cash advances, balance
  transfers and fees together, because only the wording tells them apart.
- Each card on the account closes its rows with `TRANSACTIONS THIS CYCLE (CARD 1234) $…` (a net
  credit prints with a trailing minus). The rows above it get `raw.card` and are checked against
  that total — a business account can carry several employee cards.
- A foreign purchase adds two lines (currency name; `amount X rate (EXCHG RATE)`), kept on the
  row as `raw.foreignCurrency / foreignAmount / exchangeRate`.
- Credit limit is `Revolving Credit Amount` on business cards, `Credit Access Line` on personal.
- Personal statements group rows under headings (`PAYMENTS AND OTHER CREDITS`, `PURCHASE`, …);
  they are skipped.
- Airline tickets list their legs under the row (`031526 1 S AAA BBB`, then `2 T BBB AAA`); they
  are kept in `raw.travel`.
- Quirks seen on personal statements: a stray `` ` `` inside or between summary lines (tolerated
  — otherwise the figure on that line is lost), and a foreign refund whose currency line is a
  bare date with no currency name.
- The printed account number changes when a card is reissued, so older statements of the same
  account can carry a different last-4; the user picks the account in the import wizard.

## Loan statements
`parsers/zable-loan.ts` (Zable personal loan, "Loan Periodic Statement") is the model for a loan:
- **Balance = "Outstanding balance"** (principal plus interest accrued so far — the payoff
  figure), as of the period end. The principal goes in the snapshot's note via
  `meta.balanceDetail` ("… closing balance (Dec 2025) — principal $4,000.00").
- **APR and the scheduled payment** ("Recurring amount") are returned as `meta.apr` /
  `meta.minPayment` and written to the closing snapshot's `apr` / `min_payment` columns, so debt
  projections get the rate without hand entry. Any parser may set these.
- **No opening balance is printed**, so no opening snapshot and `reconciled: null`. Import the
  statements in a run and each closing balance is the next one's opening.
- **Payments** are `Credit` rows (`Nov 8, 2025 Payment - Bank Account *1234 -$250.00`). One still
  clearing prints as `Payment processing - …`; it is imported as `Payment - …` with
  `raw.status = "processing"` so a relisting on the next statement dedups.
- **Interest** is one `Debit` per statement, dated the period end, from `TOTAL INTEREST FOR THIS
  PERIOD` (no per-day rows exist). **Fees** work the same, except that dated rows inside the Fees
  block (not yet seen on a real statement) are imported as themselves and only the remainder of
  the total is synthesised.
- The account number is the last four characters of the loan ID (letters and digits).
- "Paid Last Period" on page 1 is not checked against the payment rows: it can cover a payment
  the activity table does not list.

`parsers/edfinancial-loan.ts` (Edfinancial, a federal student-loan servicer) is the model for a
**servicer account that holds several loans**. The statement has one column per loan
(`Loan ID 1-01 1-02 … Total`) and the tracker keeps the whole account as **one** loan:
- **Balance = the Total "Current Balance"** (unpaid principal + unpaid interest), as of the
  billing cycle's end. Principal, unpaid interest and the loan count go in the snapshot note.
- **Every row is checked across**: the per-loan figures must add up to the Total, and principal +
  unpaid interest must equal the balance (`reconciled`). A mismatch is a note naming the row.
- **APR = the principal-weighted average** of the loans' rates (interest accrues on principal);
  the payment is page 1's "Regular Monthly Payment Amount".
- Labels that wrap (`Capitalized` / figures / `Interest`) print their figures on a line of their
  own; such a row is keyed by the label's first half (`Payments`, `Applied to`, …).
- **Transactions**: the cycle's "Payments Received" total as one `Credit` dated the latest "Last
  Payment Date", and its "Applied to Interest" part as an `Interest charged` `Debit` the same day.
  Only totals are printed, so two payments in one cycle become one row (noted). A payment made on
  the statement date itself is usually reported on the *next* statement.
- The account number is the last four digits before the `-1` suffix.

**Backfilling a loan's past.** A servicer hands out a few months of statements, but its
transaction-history export (Date, Description, Principal, Interest, Fees, Total — no balance
column) goes back to the first disbursement. Principal can be rebuilt exactly by summing the
Principal column forward (disbursements +, capitalized interest +, payments −) and checking it
against a statement's Unpaid Principal. If the sum falls short, the export is missing events —
typically payments made while the loan was with an earlier servicer, which the bank side of the
ledger still holds, and capitalizations that print as `$0.00`. The statement's life-of-loan
totals (Capitalized Interest, Total Principal Paid, Total Interest Paid) give the size of each
gap. Interest owed between events is not in the export; spread the interest each payment or
capitalization settled over the days since the previous one, in proportion to principal × days
(zero during a 0% period). Write the month-ends as `account_balances` snapshots. Do this as a
one-off against live data (`planning/progress/`), not as an import path.

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
`balances` arg), planned by the pure helpers in `src/server/lib/pdf/balances.ts`
(`statementPoints` + the upsert plan; unit-tested in `tests/unit/pdf-balances.test.ts`). One
snapshot per account per date:
- a date with no row gets a new one;
- a date holding an **imported** row (`account_balances.source` set — `statement` for
  opening/closing, `statement-daily` for end-of-day points; migration 0032) is **refreshed**, so
  re-importing a statement corrects it;
- a date holding a hand-entered or synced row (`source` null) is **never touched**.

Each account's existing snapshots are loaded once and inserts are chunked. Opening/closing win a
date they share with a daily point. The accounts page hides `statement-daily` rows behind a
show/hide toggle in the history.

`StatementBalance` (`types.ts`): `{ kind: "opening"|"closing", balance, asOf, creditLimit, note }`
(plus `apr` / `minPayment` from `meta`). `buildBalanceSuggestions` emits opening and closing; the
**opening is dated the day before the period starts** (`dayBefore` — the end of that day), so it
doesn't collide with the first day's end-of-day point. Each is a checkbox with editable
amount/date in the UI (default on).

## Edge cases / gotchas
- `serverExternalPackages: ["unpdf"]` is mandatory; `bodySizeLimit: "25mb"` is the backstop behind
  the client size guards.
- **Cross-statement dedup** needs the batch-wide `seenHashes` guard, else the same txn in two
  statements double-inserts.
- **Stale-response race**: free-text last-4 fires analyze per keystroke; results are applied only if
  the account still matches.
- **Category-edit preservation** on re-analyze; **empty balance input ignored** (won't write $0);
  **balances upsert per account + date** (imported rows refresh on re-import; hand-entered rows
  win).
- Unrecognized PDFs are non-fatal (flagged with `sampleLines`); only detected statements commit.

## How to extend it
Add `parsers/<issuer>.ts` + register in `registry.ts` — that's the only wiring. Copy the closest
existing parser: `robinhood.ts` for a simple cash statement, `capitalone.ts` for running balances
or several accounts per file, `capitalone-card.ts` / `chase-card.ts` for a card, `zable-loan.ts`
for a loan, `robinhood-brokerage.ts` for anything needing column positions. Add the row to
[Supported statements](#supported-statements) and to the table in `docs/importing.md`.

## Related
- Shares the commit/dedup/categorize path with [csv-import.md](csv-import.md); engine
  [categorization.md](categorization.md); balances → [accounts-and-balances.md](accounts-and-balances.md)

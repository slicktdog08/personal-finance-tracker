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
`parse(lines, text) => ParserResult`. Registration is first-match: `PARSERS` array in
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

# Feature: Transaction categorization & rules

**Status:** live · **Entry:** `/transactions/categorize`, inline on the ledger, `/settings/categories`

## Intent / why
Imported transactions arrive with free-text `description` (and sometimes a source `raw_category`).
This turns that raw text into a consistent set of **system categories** so dashboard/reporting
rollups are meaningful. Three layers: (1) **automatic** categorization on import via saved rules;
(2) a **mass-categorize** UI to clear the backlog and manage rules; (3) **inline** one-click
"save this as a rule that also catches N similar." Bill-linking is an adjacent attribution
mechanism (see below).

## How it works today
- **Rule engine (pure, no DB)**: `src/server/lib/categorize.ts` — `categorize(input, rules)`:
  sorts rules ascending by `priority` (**lower number wins**), tests each via `matches()`
  (`equals` case-insensitive exact / `regex` `new RegExp(p,"i")`, invalid → no match / `contains`
  default), **first match wins**. Fallback: if nothing matched but `rawCategory` is already a known
  system category, trust it; else null.
- **Actions**: `src/server/actions/categorize.ts` — `previewCategorizeMatch`,
  `bulkCategorizeByMatch` (UPDATE + optionally **upsert** a rule by field/match/pattern; returns
  `{updated, rule}`), `applySavedRules` (SQL mirror of the engine: runs each rule by priority over
  uncategorized), `bulkSetCategory`, `updateCategoryRule` (edit + optional re-apply),
  `deleteCategoryRule` (optional "also clear categories it set"), `getRuleUsage`,
  `suggestRuleForTransaction` (the inline offer; reads the whole ledger grouped by description).
- **Rule provenance** (2026-09-09): `transactions.category_rule_id` is stamped by every path that
  applies a rule (import commit, `applySavedRules`, rule-saving bulk categorize) and **cleared by
  every manual set** (`updateTransactionCategory`, `updateTransaction` on category change,
  `bulkSetCategory`, transfer linking). `explainCategory()` in `lib/categorize.ts` resolves the
  rule behind a row: the stamp first, else the first matching rule that agrees with the current
  category (so pre-stamp rows still show one).
- **Rule editor (shared)**: `src/components/transactions/RuleEditor.tsx` — one Sheet for create /
  edit / delete. Opened from a transaction (`source` prop) it is mostly taps: the description is
  laid out as **word chips** (`describeWords`) — tap to grow or shrink the pattern; store numbers,
  places and bank boilerplate are dashed — and "only on this account / money out / exactly $X"
  are one-tap limits taken from that transaction. Match field, match type, any account and an
  amount range sit under "More options". The live preview counts what it would categorize / link
  and warns **"probably too broad"** when the pattern also matches transactions already filed in
  other categories (`previewRule` → `elsewhere`). `RuleBadge.tsx` is the `rule "X"` chip next to a
  category that opens it; it turns amber ("still active") when the row's category no longer
  agrees with the rule — i.e. right after you re-categorized an auto-categorized row by hand,
  which is exactly when you'd want to fix or remove the rule.
- **Import review** (`src/components/import/ImportCategoryCell.tsx`): same chip + the same
  "Always for “X”" offer as the ledger. The phrase is computed client-side (`suggestRule` over the
  rows on screen, so there's always an offer) with counts for rows on screen and uncategorized
  rows in the DB. Saving/editing/deleting a rule mid-review re-applies it to the on-screen rows
  via pure helpers in `src/components/import/rule-helpers.ts` (stamped rows follow the rule;
  hand-picked rows never move; `raw_category` rules only apply at analyze time).
- **Mass-categorize**: `src/app/transactions/categorize/page.tsx` +
  `src/components/transactions/MassCategorize.tsx` — Suggested rules, Auto-apply, Bulk-by-match
  builder w/ Preview, Saved-rules table.
- **Inline cell**: `src/components/transactions/CategoryCell.tsx` — assign → offer
  `Always for "MERCHANT" · +N now` (one click saves the rule; ✎ opens the editor on that
  transaction; × dismisses). The offer is made even when nothing else matches today (a merchant
  seen once is still worth a rule), skipped when a saved rule already files the description
  there, and opens the editor instead of saving when the phrase also hits rows filed elsewhere.
- **Rows stay put while you work a filtered list**: categorizing a row under the Uncategorized
  filter (or a category filter) refreshes the list without it. `TransactionsTable` holds such
  rows (`held`, keyed by id, at the index they had) and shows them with a ✓ until the filter,
  sort or page changes — or "Hide" in the summary line — so the rule offer is still there to use.
- **Suggestion engine (pure)**: `src/server/lib/suggest.ts`. It reads a description's
  *structure* instead of counting common words (which used to crown the city):
  `[bank boilerplate] [processor*] MERCHANT [store # / ref] [CITY ST]` → `merchantPhrase()` keeps
  MERCHANT, always as a verbatim slice (rules are case-insensitive "contains").
  - boilerplate lead-ins ("Debit Card Purchase -", "CHECKCARD 0102", "Withdrawal from") and
    processor tags before a `*` ("SQ *", "TST*", any 1–3 letter tag) are skipped; a brand before
    the star ("UBER *TRIP") is kept;
  - the name ends at the first store number / reference / date, ACH field label, or place;
  - places: a trailing state (plus zip / country / "CARD 1234" after it) and the city before it
    — `learnPlaces()` learns city words from the ledger (a word before the state on ≥2 different
    merchants), which also strips a city that has no state after it; with no evidence it assumes
    one city word (two after SAN / NEW / FORT …) and never eats the first word of the name.
  - `suggestRule(description, corpus, category)` — the inline offer. Default is the full merchant
    phrase; it only shortens ("AMAZON MKTPL" → "AMAZON") when the ledger already files other
    descriptions under the shorter phrase in the same category and none anywhere else. Returns
    `matchCount` (uncategorized it would catch), `conflicts` (filed elsewhere) and the other
    phrase lengths as `alternatives`.
  - `computeSuggestions()` — the categorize screen: uncategorized rows grouped by merchant phrase
    (≥2 matches), with the category their categorized look-alikes agree on.
- **Category management**: `src/app/settings/categories/` + `src/server/actions/config.ts`
  (`addCategory`, `updateCategoryColor/Emoji`, `reorderCategories`, `renameCategory`,
  `deleteCategory`).
- **Import application**: `import.ts` / `pdf-import.ts` load rules and call `categorize()` per row.

## Categorizing history in the advisor chat
For a large historical backlog (thousands of rows, years back) the per-row and per-rule tools
are too slow, so the advisor works through it with the user in an ordinary `/advisor` chat. No
extra review screen: the chat *is* the review, and nothing is written until the user confirms
in the thread. Entry: the "Start in chat" card on the categorize page and Settings →
Categories (`CategorizeWithAdvisor`, shown while anything is uncategorized) →
`/advisor?start=categorize`, which prefills `CATEGORIZE_PROMPT`.

**Rounds.** Each user turn fires one routine run (chat playbook, `CATEGORIZE` section in
`src/server/lib/advisor/playbooks.ts`):
1. Context: `get_categorization_overview` — backlog by year and account, a month-by-month
   timeline of the places named in descriptions (a block of months in another city usually
   means a move or a long trip, which decides how a whole run of restaurants/shops is filed),
   active categories, bills with ids, saved-rule count. Earlier answers in the thread are
   standing instructions.
2. Batch: `get_uncategorized_groups` — uncategorized rows grouped by merchant phrase, biggest
   first, paged by offset (filters: dates, accounts, direction, search).
3. Proposal: a numbered table (merchant · n · dates · → category · rule or these rows · bill ·
   confidence) plus ≤5 questions chosen to settle many groups at once.
4. Apply what the user confirmed ("all but 4", "7 is Groceries"): `categorize_with_rule`
   (recurring merchants — the rule also files future imports; `dryRun` + `elsewhere` to catch a
   too-broad pattern; `billId` links payments to a bill), `set_transaction_category` (one-offs,
   up to 500 ids), `link_transactions_to_bill` (specific payments). Then report and propose the
   next round.

**Tools** (`src/server/mcp/tools-categorize.ts`, pure grouping in `src/server/lib/backlog.ts`):
- `groupBacklog()` puts every uncategorized row in exactly one group (keyed by
  `merchantPhrase`, unlike `computeSuggestions`, which counts substring matches). Per group:
  count, money out/in, amount range, first/last date, months, `monthly` (3+ months, median gap
  25–35 days), accounts, samples, places, ids (capped, `idsTruncated`), and `lookalikes` —
  what categorized descriptions with the same phrase (else containing it) are filed under.
- `backlogTimeline()` / `placesIn()` read places with `describeWords` (kind `place`).
- `categorize_with_rule` wraps `createRule` (upsert by conditions + `applyRules` scoped to the
  rule), so it stamps `category_rule_id` / `bill_rule_id` and never touches categorized rows;
  it refuses patterns with no letters in them (store numbers). Undo is the rule editor's
  delete with "also clear what it set".
- `link_transactions_to_bill` wraps `setTransactionBill` (hand-made link: `bill_rule_id`
  cleared, instance in the row's own month when one exists).
- Writes still follow the MCP rule: the playbook only writes what the user's latest message
  confirmed; a claude.ai conversation asks before each write as usual.

The reply streams into the chat while the run works — see
[ai-advisor.md](ai-advisor.md#live-replies-streaming).

## Data model
- `category_mappings` (`schema.ts`): `matchType` (`contains`|`equals`|`regex`), `pattern`,
  `field` (`description`|`raw_category`), `category`, `billId?` (FK bills), **`priority`
  (lower wins)**.
- `transactions.category` VARCHAR (string, **not an FK**), plus `billId` (cross-month) and
  `billInstanceId` (per-month), both `ON DELETE SET NULL`.
- `transactions.category_rule_id` (migration 0020) → `category_mappings.id`, `ON DELETE SET NULL`:
  which rule auto-set the category; null = by hand / pre-stamp.
- System categories: promoted to a real `categories` lookup table (migration 0002, managed in
  Settings — color/emoji/order); `TXN_CATEGORIES`/`CATEGORY_DEFAULTS` in `enums.ts` are the
  seed/fallback.
- `suggestion_dismissals` (unique `merchantKey`).

## Bill linking (adjacent)
- **`billInstanceId`** = the specific per-month `bill_instances` row a payment records against;
  **`billId`** = durable cross-month link to the recurring bill (migration 0009) so past/future
  occurrences attribute without retroactive instances.
- Convert/link flow: `src/server/actions/transactions.ts` (`convertTransactionToBill`,
  `attachToBill`) links the txn + every unlinked same-merchant occurrence to `billId`, adding to the
  current period only if not already present and the charge is recent.
- **Merchant matching**: `src/server/lib/merchant.ts` `normalizeMerchant()` — uppercase, strip
  punctuation, drop digit-containing tokens, so "NETFLIX.COM 8663" and "…4941" both key to
  "NETFLIX COM". (MySQL 5.7 has no `REGEXP_REPLACE` → cheap LIKE on first word, refine by exact key
  in JS.)
- **Recurring suggestions**: `getRecurringSuggestions()` groups unlinked Debit non-transfer txns by
  merchant key; surfaces groups with ≥3 distinct months + near-monthly cadence, amount-consistent
  first; dismissed keys excluded.

## Edge cases / gotchas
- **`category_mappings.billId` is NOT applied on import** — `categorize()` returns `billId` and
  import loads it into the rule, but the import path only persists `category`, never
  `transactions.billId`. Bill-linking happens *only* through the separate convert/link flow. **Do
  not claim rules auto-link bills.**
- **JS regex vs MySQL `REGEXP`** can diverge for edge patterns (engine uses JS; `applySavedRules`/
  `matchWhere` use SQL). Invalid regex silently no-matches in JS.
- **Category is a VARCHAR string, not an FK** → managed list and stored strings can drift;
  `getCategoryOptionsRich()` appends distinct-but-unmanaged values (neutral gray) and `CategoryCell`
  injects the current value so nothing disappears.
- **Rename/delete are atomic and propagate** across categories + transactions + rules
  (`config.ts`); delete validates the reassign target.
- **Case sensitivity**: matching is case-insensitive, but category equality in options/counts is
  case-sensitive ('Rent' vs 'rent' split — deferred data hygiene).
- Inline single-assign does **not** `router.refresh()` (keeps the row under an "uncategorized only"
  filter); bulk apply and rule edit/delete do.
- **Editing a rule with re-apply** reconciles only rows *stamped* with that rule (still matches →
  new category; no longer matches → uncategorized) then picks up uncategorized matches. Rows
  categorized by hand are never touched. Without re-apply nothing but the rule changes.
- **Saving the same pattern twice** (same field + match type + pattern) updates the existing rule's
  category instead of inserting a duplicate.

## How to extend it
- **Add a category**: `TXN_CATEGORIES` + `CATEGORY_DEFAULTS` in `enums.ts` (no migration — VARCHAR),
  or at runtime via Settings → Categories. Both feed `getCategoryOptionsRich()` (drives every
  dropdown).
- **Add a match type**: extend the `matchType` union (`categorize-dto.ts`), add a `case` in
  `matches()`, add the SQL branch in `matchWhere()` + `applySavedRules()`, add the `<option>` in
  `MassCategorize.tsx`. Column is VARCHAR(12) — no migration if the name fits.

## Related
- Applied by [csv-import.md](csv-import.md) and [pdf-import.md](pdf-import.md); the `Transfer`
  category powers [transfers.md](transfers.md); rollups in [dashboard.md](dashboard.md)

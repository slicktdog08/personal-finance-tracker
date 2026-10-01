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
  `suggestRuleForDescription`.
- **Rule provenance** (2026-09-09): `transactions.category_rule_id` is stamped by every path that
  applies a rule (import commit, `applySavedRules`, rule-saving bulk categorize) and **cleared by
  every manual set** (`updateTransactionCategory`, `updateTransaction` on category change,
  `bulkSetCategory`, transfer linking). `explainCategory()` in `lib/categorize.ts` resolves the
  rule behind a row: the stamp first, else the first matching rule that agrees with the current
  category (so pre-stamp rows still show one).
- **Rule editor (shared)**: `src/components/transactions/RuleEditor.tsx` — one Sheet for create /
  edit / delete (field, match type, pattern, category, live "N uncategorized match" preview,
  "re-apply" on edit, "also clear categories" on delete). `RuleBadge.tsx` is the `⚙ rule "X"` chip
  next to a category that opens it; it turns amber ("still active") when the row's category no
  longer agrees with the rule — i.e. right after you re-categorized an auto-categorized row by
  hand, which is exactly when you'd want to fix or remove the rule.
- **Import review** (`src/components/import/ImportCategoryCell.tsx`): same chip + the same
  "save rule" offer as the ledger. The phrase is computed client-side
  (`bestPhraseForDescription`, seeded with the row itself so there's always an offer) with counts
  for rows on screen and uncategorized rows in the DB. Saving/editing/deleting a rule mid-review
  re-applies it to the on-screen rows via pure helpers in `src/components/import/rule-helpers.ts`
  (stamped rows follow the rule; hand-picked rows never move; `raw_category` rules only apply at
  analyze time).
- **Mass-categorize**: `src/app/transactions/categorize/page.tsx` +
  `src/components/transactions/MassCategorize.tsx` — Suggested rules, Auto-apply, Bulk-by-match
  builder w/ Preview, Saved-rules table.
- **Inline cell**: `src/components/transactions/CategoryCell.tsx` — assign → offer
  `+N like "PHRASE"` rule save (one click) or ✎ to customize in the editor first; shows the
  `RuleBadge` for the rule that set the current category.
- **Suggestion engine (pure)**: `src/server/lib/suggest.ts` — n-grams + longest-specific-phrase
  ("UBER TRIP" beats bare "UBER"), auto-infers a category when past matches agree.
- **Category management**: `src/app/settings/categories/` + `src/server/actions/config.ts`
  (`addCategory`, `updateCategoryColor/Emoji`, `reorderCategories`, `renameCategory`,
  `deleteCategory`).
- **Import application**: `import.ts` / `pdf-import.ts` load rules and call `categorize()` per row.

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

// Pure helpers for keeping an import review in sync with rules saved mid-review.
// Rows on screen aren't in the database yet, so the server can't touch them —
// the wizard applies the same rule semantics locally with these.
import { matchesRule, type CategoryRule } from "@/server/lib/categorize";
import type { PreviewRow } from "@/server/lib/import-types";

type Conditions = Pick<
  CategoryRule,
  "matchType" | "pattern" | "field" | "accountId" | "direction" | "amountMin" | "amountMax"
>;

// Rules on the bank's own category column can't be evaluated on the client (the review row
// doesn't carry it), and neither can account-locked ones (the row knows only an account
// number) — those apply at analyze time, and again to whatever is still uncategorized when the
// import is committed. Only the category action is mirrored here; bill links happen on commit.
function hits(rule: Conditions, r: PreviewRow): boolean {
  if (rule.field === "raw_category" || rule.accountId != null) return false;
  return matchesRule(rule, { description: r.description, amount: r.amount, direction: r.direction });
}

const canAutoSet = (r: PreviewRow) => r.status === "new" && !r.category;

// A freshly saved rule: categorize the uncategorized rows it matches.
export function applyRuleToRows(rows: PreviewRow[], rule: CategoryRule): PreviewRow[] {
  if (!rule.category) return rows;
  return rows.map((r) =>
    canAutoSet(r) && hits(rule, r) ? { ...r, category: rule.category, categoryRuleId: rule.id } : r,
  );
}

// An edited rule: rows it had set follow the new definition (still matches → new
// category, otherwise back to uncategorized), then it picks up new matches.
// Rows the user categorized by hand (no stamp) are left alone.
export function reconcileRuleInRows(rows: PreviewRow[], rule: CategoryRule): PreviewRow[] {
  return rows.map((r) => {
    if (r.categoryRuleId === rule.id) {
      return rule.category && hits(rule, r)
        ? { ...r, category: rule.category }
        : { ...r, category: null, categoryRuleId: null };
    }
    return rule.category && canAutoSet(r) && hits(rule, r)
      ? { ...r, category: rule.category, categoryRuleId: rule.id }
      : r;
  });
}

// A deleted rule: whatever it set goes back to uncategorized.
export function clearRuleFromRows(rows: PreviewRow[], ruleId: number): PreviewRow[] {
  return rows.map((r) =>
    r.categoryRuleId === ruleId ? { ...r, category: null, categoryRuleId: null } : r,
  );
}

export function upsertRuleInList(rules: CategoryRule[], rule: CategoryRule): CategoryRule[] {
  return rules.some((r) => r.id === rule.id)
    ? rules.map((r) => (r.id === rule.id ? rule : r))
    : [...rules, rule];
}

// How many on-screen rows a draft rule would newly categorize — the import
// review's answer to "N uncategorized transactions match" for the database.
export function countLocalMatches(
  rows: PreviewRow[],
  draft: Conditions & Pick<CategoryRule, "category">,
): number {
  if (!draft.category) return 0;
  return rows.filter((r) => canAutoSet(r) && hits(draft, r)).length;
}

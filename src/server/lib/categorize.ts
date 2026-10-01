import { TXN_CATEGORIES } from "../../constants/enums";

export interface CategoryRule {
  id: number;
  matchType: string; // contains | equals | regex
  pattern: string;
  field: string; // description | raw_category
  category: string;
  billId: number | null;
  priority: number;
}

// The editable half of a rule — what the rule editor sends to create/update one.
export interface RuleInput {
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  field: "description" | "raw_category";
  category: string;
}

export interface CategorizeInput {
  description: string;
  rawCategory?: string | null;
}

export interface CategorizeResult {
  category: string | null;
  billId: number | null;
  matchedRuleId: number | null;
}

const KNOWN = new Set(TXN_CATEGORIES.map((c) => c.toLowerCase()));

function fieldValue(input: CategorizeInput, field: string): string {
  return (field === "raw_category" ? input.rawCategory ?? "" : input.description) ?? "";
}

function matches(rule: Pick<CategoryRule, "matchType" | "pattern">, value: string): boolean {
  const v = value.toLowerCase();
  const p = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case "equals":
      return v === p;
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(value);
      } catch {
        return false;
      }
    case "contains":
    default:
      return v.includes(p);
  }
}

// Does one rule hit this transaction? Pure, so the import review can apply a
// freshly saved rule to the rows still on screen without a round trip.
export function matchesRule(
  rule: Pick<CategoryRule, "matchType" | "pattern" | "field">,
  input: CategorizeInput,
): boolean {
  return matches(rule, fieldValue(input, rule.field));
}

export function categorize(
  input: CategorizeInput,
  rules: CategoryRule[],
): CategorizeResult {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (matches(rule, fieldValue(input, rule.field))) {
      return { category: rule.category, billId: rule.billId, matchedRuleId: rule.id };
    }
  }
  // Fallback: trust an already-valid system category from the source file.
  const raw = (input.rawCategory ?? "").trim();
  if (raw && KNOWN.has(raw.toLowerCase())) {
    return { category: raw, billId: null, matchedRuleId: null };
  }
  return { category: raw || null, billId: null, matchedRuleId: null };
}

// Which rule is responsible for a row's category. Prefers the persisted stamp
// (`categoryRuleId`); for rows categorized before stamping existed, falls back to
// the first rule that matches AND agrees with the current category — that's the
// rule that would re-apply it, which is what someone recategorizing wants to see.
export function explainCategory(
  input: CategorizeInput & { category: string | null; categoryRuleId?: number | null },
  rules: CategoryRule[],
): CategoryRule | null {
  if (input.categoryRuleId != null) {
    const stamped = rules.find((r) => r.id === input.categoryRuleId);
    if (stamped) return stamped;
  }
  if (!input.category) return null;
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (rule.category === input.category && matches(rule, fieldValue(input, rule.field))) {
      return rule;
    }
  }
  return null;
}

// Human-readable one-liner for a rule's match clause, e.g. `contains "UBER"`.
export function describeRuleMatch(rule: Pick<CategoryRule, "matchType" | "pattern" | "field">): string {
  const what = rule.field === "raw_category" ? "bank category" : "description";
  const how = rule.matchType === "equals" ? "is" : rule.matchType === "regex" ? "matches" : "contains";
  return `${what} ${how} “${rule.pattern}”`;
}

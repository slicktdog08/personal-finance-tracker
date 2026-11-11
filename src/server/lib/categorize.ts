import { TXN_CATEGORIES } from "../../constants/enums";

// Saved transaction rules (table `category_mappings`).
//
// A rule is CONDITIONS → ACTIONS:
//   conditions — a text match (description or bank category) plus optional extra filters:
//                account, direction, amount range. Every active condition must hold.
//   actions    — each optional, at least one set: set the category, link a recurring bill.
//
// Each action slot is filled independently by the highest-priority matching rule that sets it,
// so a broad "UBER → Rideshare" rule and a narrower "CARD A EPAY $1,000–$1,200 → link Card A"
// rule can both apply to the same row.
//
// Adding a condition: a nullable column on category_mappings + the field below + one entry in
// RULE_CONDITIONS (and its SQL prefilter in src/server/lib/rules.ts, optional) + a control in
// RuleEditor. Adding an action: a column + a slot in `categorize` + the writer in rules.ts.

export type RuleField = "description" | "raw_category";
export type RuleMatchType = "contains" | "equals" | "regex";
export type RuleDirection = "Debit" | "Credit";

export interface CategoryRule {
  id: number;
  matchType: string; // contains | equals | regex
  pattern: string;
  field: string; // description | raw_category
  accountId: number | null;
  direction: string | null; // Debit | Credit | null (either)
  amountMin: number | null;
  amountMax: number | null;
  category: string | null;
  billId: number | null;
  priority: number;
}

// The editable half of a rule — what the rule editor sends to create/update one.
export interface RuleInput {
  matchType: RuleMatchType;
  pattern: string;
  field: RuleField;
  accountId: number | null;
  direction: RuleDirection | null;
  amountMin: number | null;
  amountMax: number | null;
  category: string | null;
  billId: number | null;
}

export interface CategorizeInput {
  description: string;
  rawCategory?: string | null;
  /** Unknown (undefined) fails any account-locked rule — conservative on purpose. */
  accountId?: number | null;
  /** Absolute amount, as stored. Unknown fails any amount-limited rule. */
  amount?: number | null;
  direction?: string | null;
}

export interface CategorizeResult {
  category: string | null;
  billId: number | null;
  /** The rule that set `category` (null = none; category may still come from the bank). */
  matchedRuleId: number | null;
  /** The rule that set `billId`. */
  billRuleId: number | null;
}

const KNOWN = new Set(TXN_CATEGORIES.map((c) => c.toLowerCase()));

type RuleConditions = Pick<
  CategoryRule,
  "matchType" | "pattern" | "field" | "accountId" | "direction" | "amountMin" | "amountMax"
>;

/** Names for ids, so a rule can be described in words. All optional. */
export interface RuleNames {
  account?: (id: number) => string | undefined;
  bill?: (id: number) => string | undefined;
}

interface RuleCondition {
  key: string;
  /** Does this rule use the condition at all? Inactive conditions always pass. */
  active: (r: RuleConditions) => boolean;
  test: (r: RuleConditions, t: CategorizeInput) => boolean;
  describe: (r: RuleConditions, names: RuleNames) => string;
}

function textValue(input: CategorizeInput, field: string): string {
  return (field === "raw_category" ? input.rawCategory ?? "" : input.description) ?? "";
}

function textMatches(rule: Pick<CategoryRule, "matchType" | "pattern">, value: string): boolean {
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

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const RULE_CONDITIONS: RuleCondition[] = [
  {
    key: "text",
    active: () => true,
    test: (r, t) => textMatches(r, textValue(t, r.field)),
    describe: (r) => {
      const what = r.field === "raw_category" ? "bank category" : "description";
      const how = r.matchType === "equals" ? "is" : r.matchType === "regex" ? "matches" : "contains";
      return `${what} ${how} “${r.pattern}”`;
    },
  },
  {
    key: "account",
    active: (r) => r.accountId != null,
    test: (r, t) => t.accountId != null && t.accountId === r.accountId,
    describe: (r, n) => `on ${n.account?.(r.accountId!) ?? `account #${r.accountId}`}`,
  },
  {
    key: "direction",
    active: (r) => r.direction === "Debit" || r.direction === "Credit",
    test: (r, t) => t.direction === r.direction,
    describe: (r) => (r.direction === "Credit" ? "money in" : "money out"),
  },
  {
    key: "amount",
    active: (r) => r.amountMin != null || r.amountMax != null,
    test: (r, t) => {
      if (t.amount == null || !Number.isFinite(t.amount)) return false;
      const a = Math.abs(t.amount);
      // Half a cent of slack so 12.30 stored as 12.3 never misses an exact bound.
      if (r.amountMin != null && a < r.amountMin - 0.005) return false;
      if (r.amountMax != null && a > r.amountMax + 0.005) return false;
      return true;
    },
    describe: (r) => {
      const lo = r.amountMin;
      const hi = r.amountMax;
      if (lo != null && hi != null) return Math.abs(lo - hi) < 0.005 ? `exactly ${money(lo)}` : `${money(lo)}–${money(hi)}`;
      return lo != null ? `at least ${money(lo)}` : `at most ${money(hi!)}`;
    },
  },
];

// Does one rule's conditions hit this transaction? Pure, so the import review can apply a
// freshly saved rule to the rows still on screen without a round trip.
export function matchesRule(rule: RuleConditions, input: CategorizeInput): boolean {
  for (const c of RULE_CONDITIONS) if (c.active(rule) && !c.test(rule, input)) return false;
  return true;
}

/** A rule with no action does nothing — e.g. a bill-only rule whose bill was merged away. */
export function ruleHasAction(rule: Pick<CategoryRule, "category" | "billId">): boolean {
  return !!rule.category || rule.billId != null;
}

// How narrow a rule is: more active conditions = more specific.
const specificity = (r: RuleConditions) => RULE_CONDITIONS.filter((c) => c.active(r)).length;

// Lower priority number first; at equal priority the more specific rule wins (a rule locked to
// one account beats the same text rule for every account), then the older rule.
const byPriority = (a: CategoryRule, b: CategoryRule) =>
  a.priority - b.priority || specificity(b) - specificity(a) || a.id - b.id;

export function categorize(input: CategorizeInput, rules: CategoryRule[]): CategorizeResult {
  let category: string | null = null;
  let matchedRuleId: number | null = null;
  let billId: number | null = null;
  let billRuleId: number | null = null;
  for (const rule of [...rules].sort(byPriority)) {
    const wantsCategory = !!rule.category && matchedRuleId == null;
    const wantsBill = rule.billId != null && billRuleId == null;
    if (!wantsCategory && !wantsBill) continue;
    if (!matchesRule(rule, input)) continue;
    if (wantsCategory) {
      category = rule.category;
      matchedRuleId = rule.id;
    }
    if (wantsBill) {
      billId = rule.billId;
      billRuleId = rule.id;
    }
    if (matchedRuleId != null && billRuleId != null) break;
  }
  if (matchedRuleId == null) {
    // Fallback: trust an already-valid system category from the source file.
    const raw = (input.rawCategory ?? "").trim();
    category = raw && KNOWN.has(raw.toLowerCase()) ? raw : raw || null;
  }
  return { category, billId, matchedRuleId, billRuleId };
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
  for (const rule of [...rules].sort(byPriority)) {
    if (rule.category === input.category && matchesRule(rule, input)) return rule;
  }
  return null;
}

// Human-readable one-liner for a rule's conditions, e.g. `description contains “UBER” · on Card A`.
export function describeRuleMatch(rule: RuleConditions, names: RuleNames = {}): string {
  return RULE_CONDITIONS.filter((c) => c.active(rule))
    .map((c) => c.describe(rule, names))
    .join(" · ");
}

// …and for its actions, e.g. `Rideshare` or `Utilities + link “Power bill”`.
export function describeRuleActions(rule: Pick<CategoryRule, "category" | "billId">, names: RuleNames = {}): string {
  const parts: string[] = [];
  if (rule.category) parts.push(rule.category);
  if (rule.billId != null) parts.push(`link “${names.bill?.(rule.billId) ?? `bill #${rule.billId}`}”`);
  return parts.length ? parts.join(" + ") : "no action";
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

// One mapper for every place that loads rules from the database (decimals arrive as strings).
export function ruleFromRow(r: {
  id: number;
  matchType: string;
  pattern: string;
  field: string;
  accountId?: number | null;
  direction?: string | null;
  amountMin?: string | number | null;
  amountMax?: string | number | null;
  category: string | null;
  billId: number | null;
  priority: number;
}): CategoryRule {
  return {
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    accountId: r.accountId ?? null,
    direction: r.direction === "Debit" || r.direction === "Credit" ? r.direction : null,
    amountMin: num(r.amountMin),
    amountMax: num(r.amountMax),
    category: r.category || null,
    billId: r.billId,
    priority: r.priority,
  };
}

// Normalize/validate what the editor sent. Throws a user-facing message.
export function cleanRuleInput(input: RuleInput): RuleInput {
  const pattern = input.pattern.trim();
  if (!pattern) throw new Error("A pattern is required.");
  if (input.matchType === "regex") {
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new Error("That regex doesn't parse.");
    }
  }
  const category = input.category?.trim() || null;
  const billId = input.billId ?? null;
  if (!category && billId == null) throw new Error("Pick a category, a bill to link, or both.");
  const amt = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.abs(Math.round(v * 100) / 100));
  let amountMin = amt(input.amountMin);
  let amountMax = amt(input.amountMax);
  if (amountMin != null && amountMax != null && amountMin > amountMax) [amountMin, amountMax] = [amountMax, amountMin];
  return {
    matchType: input.matchType === "equals" || input.matchType === "regex" ? input.matchType : "contains",
    pattern,
    field: input.field === "raw_category" ? "raw_category" : "description",
    accountId: input.accountId ?? null,
    direction: input.direction === "Debit" || input.direction === "Credit" ? input.direction : null,
    amountMin,
    amountMax,
    category,
    billId,
  };
}

// A starting pattern for "make a rule from this transaction": the description's leading words
// up to the first one carrying a digit (store numbers, dates, reference codes), so
// "NETFLIX.COM 8663 CA" → "NETFLIX.COM". Falls back to the whole trimmed description.
export function ruleSeedPattern(description: string): string {
  const toks = description.trim().split(/\s+/);
  const lead: string[] = [];
  for (const t of toks) {
    if (/\d/.test(t)) break;
    lead.push(t);
  }
  return (lead.length ? lead.join(" ") : description.trim()).slice(0, 255);
}

"use server";

import { db } from "@/server/db";
import { transactions, categoryMappings, accounts, bills } from "@/server/db/schema";
import { and, eq, isNull, like, or, inArray, asc, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { MatchParams } from "@/server/lib/categorize-dto";
import { cleanRuleInput, ruleFromRow, type CategoryRule, type RuleInput } from "@/server/lib/categorize";
import {
  applyRules,
  getRuleById,
  previewRule,
  reapplyRule,
  ruleUsage,
  ruleWhere,
  undoRule,
  type ApplyRulesResult,
  type ReapplyResult,
  type RulePreview,
} from "@/server/lib/rules";
import { requireSession } from "@/server/auth/session";

function affected(res: unknown): number {
  return (res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}

function uncategorizedCond(): SQL {
  return or(isNull(transactions.category), eq(transactions.category, "")) as SQL;
}

// The bulk screen's field vocabulary (description | category) vs the rule's (description |
// raw_category): a raw_category rule matches the current category column.
function toRuleField(field: MatchParams["field"]): RuleInput["field"] {
  return field === "category" ? "raw_category" : "description";
}

function matchWhere(p: MatchParams): SQL | undefined {
  const col = p.field === "category" ? transactions.category : transactions.description;
  let cond: SQL;
  if (p.matchType === "equals") cond = eq(col, p.pattern) as SQL;
  else if (p.matchType === "regex") cond = sql`${col} REGEXP ${p.pattern}`;
  else cond = like(col, `%${p.pattern}%`) as SQL;
  const conds: SQL[] = [cond];
  if (p.onlyUncategorized) conds.push(uncategorizedCond());
  return and(...conds);
}

function revalidateAll() {
  revalidatePath("/transactions");
  revalidatePath("/transactions/categorize");
  revalidatePath("/dashboard");
  revalidatePath("/months");
  revalidatePath("/import");
  revalidatePath("/settings/bills");
}

// Null-safe equality (MySQL `<=>`), so "no account" only matches "no account".
const same = (col: AnyColumn, v: unknown) => sql`${col} <=> ${v}`;

// Save a rule, reusing an existing one with the same CONDITIONS so clicking the same suggestion
// twice (or from two screens) can't pile up duplicates. The actions given are written onto the
// existing rule; an action left empty keeps whatever the rule already had.
async function upsertRule(raw: RuleInput): Promise<CategoryRule> {
  const input = cleanRuleInput(raw);
  const [existing] = await db
    .select({ id: categoryMappings.id })
    .from(categoryMappings)
    .where(
      and(
        eq(categoryMappings.field, input.field),
        eq(categoryMappings.matchType, input.matchType),
        eq(categoryMappings.pattern, input.pattern),
        same(categoryMappings.accountId, input.accountId),
        same(categoryMappings.direction, input.direction),
        same(categoryMappings.amountMin, input.amountMin?.toFixed(2) ?? null),
        same(categoryMappings.amountMax, input.amountMax?.toFixed(2) ?? null),
      ),
    )
    .limit(1);
  let id: number;
  if (existing) {
    id = existing.id;
    const set: Record<string, unknown> = {};
    if (input.category) set.category = input.category;
    if (input.billId != null) set.billId = input.billId;
    if (Object.keys(set).length) await db.update(categoryMappings).set(set).where(eq(categoryMappings.id, id));
  } else {
    const res = await db.insert(categoryMappings).values(toRow(input));
    id = (res as unknown as [{ insertId?: number }])[0]?.insertId ?? 0;
  }
  const rule = await getRuleById(id);
  if (!rule) throw new Error("Rule could not be saved.");
  return rule;
}

function toRow(input: RuleInput) {
  return {
    matchType: input.matchType,
    pattern: input.pattern,
    field: input.field,
    accountId: input.accountId,
    direction: input.direction,
    amountMin: input.amountMin == null ? null : input.amountMin.toFixed(2),
    amountMax: input.amountMax == null ? null : input.amountMax.toFixed(2),
    category: input.category,
    billId: input.billId,
  };
}

// A draft rule as if saved (id 0 never matches a stamp).
function draftRule(input: RuleInput): CategoryRule {
  return ruleFromRow({ id: 0, priority: 100, ...toRow(input) });
}

// ---------------------------------------------------------------------------
// The quick bulk tool on /transactions/categorize and the inline "+N like X" offers
// ---------------------------------------------------------------------------

export async function previewCategorizeMatch(
  p: MatchParams,
): Promise<{ count: number; samples: string[] }> {
  await requireSession();
  if (!p.pattern.trim()) return { count: 0, samples: [] };
  const where = matchWhere(p);
  const c = await db.select({ c: sql<number>`COUNT(*)` }).from(transactions).where(where);
  const samples = await db
    .select({ d: transactions.description })
    .from(transactions)
    .where(where)
    .limit(8);
  return { count: Number(c[0]?.c ?? 0), samples: samples.map((s) => s.d) };
}

export interface BulkCategorizeResult {
  updated: number;
  /** The saved rule when `saveRule` was set (reused if an identical one existed). */
  rule: CategoryRule | null;
}

// Categorize every transaction matching the pattern. With `saveRule`, the rule is
// saved first and the rows are stamped with it, so each one can later show which
// rule set its category. Without it this is a manual bulk edit and the stamp clears.
export async function bulkCategorizeByMatch(
  p: MatchParams & { category: string; saveRule: boolean },
): Promise<BulkCategorizeResult> {
  await requireSession();
  if (!p.pattern.trim() || !p.category) return { updated: 0, rule: null };
  const rule = p.saveRule
    ? await upsertRule({
        matchType: p.matchType,
        pattern: p.pattern,
        field: toRuleField(p.field),
        accountId: null,
        direction: null,
        amountMin: null,
        amountMax: null,
        category: p.category,
        billId: null,
      })
    : null;
  const res = await db
    .update(transactions)
    .set({ category: p.category, categoryRuleId: rule?.id ?? null })
    .where(matchWhere(p));
  revalidateAll();
  return { updated: affected(res), rule };
}

// Apply every saved rule (by priority) to open transactions: categories onto uncategorized
// rows, bill links onto unlinked posted rows.
export async function applySavedRules(): Promise<ApplyRulesResult> {
  await requireSession();
  const res = await applyRules({});
  revalidateAll();
  return res;
}

export async function bulkSetCategory(ids: number[], category: string | null): Promise<number> {
  await requireSession();
  if (!ids.length) return 0;
  const res = await db
    .update(transactions)
    .set({ category: category || null, categoryRuleId: null })
    .where(inArray(transactions.id, ids));
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return affected(res);
}

// ---------------------------------------------------------------------------
// The full rule editor
// ---------------------------------------------------------------------------

export interface RuleEditorOptions {
  accounts: { id: number; name: string }[];
  bills: { id: number; name: string }[];
}

// Pick-lists for the editor's account lock and bill link. Fetched when the editor opens, so
// the many places that host it don't each have to thread them through.
export async function getRuleEditorOptions(): Promise<RuleEditorOptions> {
  await requireSession();
  const [a, b] = await Promise.all([
    db
      .select({ id: accounts.id, label: accounts.label, institution: accounts.institution, num: accounts.accountNumber, active: accounts.active })
      .from(accounts)
      .orderBy(asc(accounts.label)),
    db.select({ id: bills.id, name: bills.name, active: bills.active }).from(bills).orderBy(asc(bills.name)),
  ]);
  return {
    accounts: a
      .sort((x, y) => Number(y.active) - Number(x.active))
      .map((x) => ({ id: x.id, name: x.label || [x.institution, x.num].filter(Boolean).join(" ") || `Account ${x.id}` })),
    bills: b
      .sort((x, y) => Number(y.active) - Number(x.active))
      .map((x) => ({ id: x.id, name: x.active ? x.name : `${x.name} (inactive)` })),
  };
}

// What saving this draft would do right now: uncategorized rows it would categorize, unlinked
// rows it would link to the bill.
export async function previewRuleDraft(input: RuleInput): Promise<RulePreview> {
  await requireSession();
  if (!input.pattern.trim()) return { categorized: 0, linked: 0, samples: [] };
  const draft = draftRule({ ...input, pattern: input.pattern.trim() });
  return previewRule(draft);
}

export interface CreateRuleResult extends ApplyRulesResult {
  rule: CategoryRule;
}

// Save a rule (reusing one with identical conditions) and apply it to what's open now.
export async function createRule(input: RuleInput): Promise<CreateRuleResult> {
  await requireSession();
  const rule = await upsertRule(input);
  const res = await applyRules({ rules: [rule], where: ruleWhere(rule) });
  revalidateAll();
  return { rule, ...res };
}

// How many transactions currently carry this rule's stamps — shown before deleting
// or re-applying so the blast radius is visible.
export async function getRuleUsage(id: number): Promise<{ categories: number; bills: number }> {
  await requireSession();
  return ruleUsage(id);
}

// Remove a rule. The FKs clear its stamps; with the clear options, what it set is undone too
// (for "this rule was wrong, undo what it did").
export async function deleteCategoryRule(
  id: number,
  opts: { clearCategories?: boolean; clearBillLinks?: boolean } = {},
): Promise<{ cleared: number; unlinked: number }> {
  await requireSession();
  const r = await undoRule(id, { categories: !!opts.clearCategories, bills: !!opts.clearBillLinks });
  await db.delete(categoryMappings).where(eq(categoryMappings.id, id));
  revalidateAll();
  return { cleared: r.categorized, unlinked: r.linked };
}

export interface UpdateRuleResult extends Partial<ReapplyResult> {
  rule: CategoryRule;
}

// Edit a rule in place. With `reapply`, everything the rule previously set is reconciled
// against the new definition (still matches → new category / bill; no longer matches → undone)
// and open rows it now matches are picked up. Values set by hand are never touched.
export async function updateCategoryRule(id: number, raw: RuleInput, reapply: boolean): Promise<UpdateRuleResult> {
  await requireSession();
  const input = cleanRuleInput(raw);
  await db.update(categoryMappings).set(toRow(input)).where(eq(categoryMappings.id, id));
  const rule = await getRuleById(id);
  if (!rule) throw new Error("Rule not found.");
  const res = reapply ? await reapplyRule(rule) : {};
  revalidateAll();
  return { rule, ...res };
}

// For inline "suggest a rule as you categorize": given a description, return the best
// phrase + how many OTHER uncategorized transactions it would move.
export async function suggestRuleForDescription(
  description: string,
): Promise<{ pattern: string; matchCount: number } | null> {
  await requireSession();
  const { bestPhraseForDescription } = await import("@/server/lib/suggest");
  const un = await db
    .select({ d: transactions.description })
    .from(transactions)
    .where(uncategorizedCond());
  return bestPhraseForDescription(description, un.map((x) => x.d));
}

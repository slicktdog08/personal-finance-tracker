"use server";

import { db } from "@/server/db";
import { transactions, categoryMappings } from "@/server/db/schema";
import { and, eq, isNull, like, or, inArray, asc, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { MatchParams } from "@/server/lib/categorize-dto";
import { matchesRule, type CategoryRule, type RuleInput } from "@/server/lib/categorize";
import { requireSession } from "@/server/auth/session";

function affected(res: unknown): number {
  return (res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}

function uncategorizedCond(): SQL {
  return or(isNull(transactions.category), eq(transactions.category, "")) as SQL;
}

// Rules store the field as description | raw_category; the SQL matcher takes
// description | category (a raw_category rule matches the current category column,
// since imported rows keep the bank's category there when nothing else claimed it).
function toMatchField(field: string): MatchParams["field"] {
  return field === "raw_category" ? "category" : "description";
}
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
}

async function getRule(id: number): Promise<CategoryRule | null> {
  const [r] = await db.select().from(categoryMappings).where(eq(categoryMappings.id, id)).limit(1);
  if (!r) return null;
  return {
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    category: r.category,
    billId: r.billId,
    priority: r.priority,
  };
}

// Save a rule, reusing an existing one with the same field + match + pattern so
// clicking the same suggestion twice (or from two screens) can't pile up duplicates.
// The category is updated in place when the rule already exists.
async function upsertRule(input: RuleInput): Promise<CategoryRule> {
  const pattern = input.pattern.trim();
  const [existing] = await db
    .select({ id: categoryMappings.id })
    .from(categoryMappings)
    .where(
      and(
        eq(categoryMappings.field, input.field),
        eq(categoryMappings.matchType, input.matchType),
        eq(categoryMappings.pattern, pattern),
      ),
    )
    .limit(1);
  let id: number;
  if (existing) {
    id = existing.id;
    await db.update(categoryMappings).set({ category: input.category }).where(eq(categoryMappings.id, id));
  } else {
    const res = await db.insert(categoryMappings).values({
      matchType: input.matchType,
      pattern,
      field: input.field,
      category: input.category,
    });
    id = (res as unknown as [{ insertId?: number }])[0]?.insertId ?? 0;
  }
  const rule = await getRule(id);
  if (!rule) throw new Error("Rule could not be saved.");
  return rule;
}

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
        category: p.category,
      })
    : null;
  const res = await db
    .update(transactions)
    .set({ category: p.category, categoryRuleId: rule?.id ?? null })
    .where(matchWhere(p));
  revalidateAll();
  return { updated: affected(res), rule };
}

// Apply every saved rule (by priority) to uncategorized transactions.
export async function applySavedRules(onlyUncategorized = true): Promise<number> {
  await requireSession();
  const rules = await db.select().from(categoryMappings).orderBy(asc(categoryMappings.priority));
  let total = 0;
  for (const r of rules) {
    const res = await db
      .update(transactions)
      .set({ category: r.category, categoryRuleId: r.id })
      .where(
        matchWhere({
          field: toMatchField(r.field),
          matchType: r.matchType as MatchParams["matchType"],
          pattern: r.pattern,
          onlyUncategorized,
        }),
      );
    total += affected(res);
  }
  revalidateAll();
  return total;
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

// How many transactions currently carry this rule's stamp — shown before deleting
// or re-applying so the blast radius is visible.
export async function getRuleUsage(id: number): Promise<number> {
  await requireSession();
  const r = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(eq(transactions.categoryRuleId, id));
  return Number(r[0]?.c ?? 0);
}

// Remove a rule. The FK clears the stamp on its transactions; with `clearCategories`
// their category is cleared too (for "this rule was wrong, undo what it did").
export async function deleteCategoryRule(
  id: number,
  opts: { clearCategories?: boolean } = {},
): Promise<{ cleared: number }> {
  await requireSession();
  let cleared = 0;
  if (opts.clearCategories) {
    const res = await db
      .update(transactions)
      .set({ category: null, categoryRuleId: null })
      .where(eq(transactions.categoryRuleId, id));
    cleared = affected(res);
  }
  await db.delete(categoryMappings).where(eq(categoryMappings.id, id));
  revalidateAll();
  return { cleared };
}

export interface UpdateRuleResult {
  rule: CategoryRule;
  /** Stamped rows that still match and were moved to the (possibly new) category. */
  recategorized: number;
  /** Stamped rows the edited rule no longer matches — category and stamp cleared. */
  cleared: number;
  /** Uncategorized rows the edited rule newly picked up. */
  applied: number;
}

// Edit a rule in place. With `reapply`, everything the rule previously set is
// reconciled against the new definition (still matches → new category; no longer
// matches → uncategorized) and uncategorized rows it now matches are categorized.
// Rows set by hand are never touched — only rows stamped with this rule.
export async function updateCategoryRule(
  id: number,
  input: RuleInput,
  reapply: boolean,
): Promise<UpdateRuleResult> {
  await requireSession();
  const pattern = input.pattern.trim();
  if (!pattern || !input.category) throw new Error("A pattern and category are required.");
  await db
    .update(categoryMappings)
    .set({
      matchType: input.matchType,
      pattern,
      field: input.field,
      category: input.category,
    })
    .where(eq(categoryMappings.id, id));
  const rule = await getRule(id);
  if (!rule) throw new Error("Rule not found.");

  let recategorized = 0;
  let cleared = 0;
  let applied = 0;
  if (reapply) {
    const stamped = await db
      .select({
        id: transactions.id,
        description: transactions.description,
        category: transactions.category,
      })
      .from(transactions)
      .where(eq(transactions.categoryRuleId, id));
    const keep: number[] = [];
    const drop: number[] = [];
    for (const t of stamped) {
      // A raw_category rule is matched against the current category column (same as SQL).
      const hit = matchesRule(rule, { description: t.description, rawCategory: t.category });
      (hit ? keep : drop).push(t.id);
    }
    for (let i = 0; i < keep.length; i += 500) {
      const res = await db
        .update(transactions)
        .set({ category: rule.category })
        .where(inArray(transactions.id, keep.slice(i, i + 500)));
      recategorized += affected(res);
    }
    for (let i = 0; i < drop.length; i += 500) {
      const res = await db
        .update(transactions)
        .set({ category: null, categoryRuleId: null })
        .where(inArray(transactions.id, drop.slice(i, i + 500)));
      cleared += affected(res);
    }
    const res = await db
      .update(transactions)
      .set({ category: rule.category, categoryRuleId: rule.id })
      .where(
        matchWhere({
          field: toMatchField(rule.field),
          matchType: rule.matchType as MatchParams["matchType"],
          pattern: rule.pattern,
          onlyUncategorized: true,
        }),
      );
    applied = affected(res);
  }
  revalidateAll();
  return { rule, recategorized, cleared, applied };
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

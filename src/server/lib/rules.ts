import "server-only";
import { db } from "@/server/db";
import { transactions, categoryMappings, billInstances, accounts } from "@/server/db/schema";
import { and, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import {
  categorize,
  matchesRule,
  ruleFromRow,
  ruleHasAction,
  type CategoryRule,
  type CategorizeInput,
} from "@/server/lib/categorize";

// Server half of the rule engine: load rules, turn their conditions into a SQL prefilter, and
// write their actions (category + bill link) onto transactions. The pure matcher in
// categorize.ts always has the final say — SQL only narrows the rows worth looking at, so a
// condition without a SQL form still works, just with a wider scan.
//
// Ground rules every writer here follows:
//   * a category is only set on an uncategorized row; a bill only on an unlinked, posted row —
//     rules never overwrite something set by hand (or by another rule);
//   * every write is stamped (categoryRuleId / billRuleId) so editing or deleting the rule can
//     undo exactly what it did;
//   * a bill link also points billInstanceId at the bill's instance on the row's own month when
//     that month's sheet has one (never creates one) — same as linking by hand.

export async function loadRules(): Promise<CategoryRule[]> {
  const rows = await db.select().from(categoryMappings);
  return rows.map(ruleFromRow);
}

export async function getRuleById(id: number): Promise<CategoryRule | null> {
  const [r] = await db.select().from(categoryMappings).where(eq(categoryMappings.id, id)).limit(1);
  return r ? ruleFromRow(r) : null;
}

// SQL narrowing for a rule's conditions. A raw_category rule matches the current category
// column, since imported rows keep the bank's category there when nothing else claimed it.
export function ruleWhere(rule: CategoryRule): SQL {
  const col = rule.field === "raw_category" ? transactions.category : transactions.description;
  const conds: SQL[] = [];
  if (rule.matchType === "equals") conds.push(eq(col, rule.pattern) as SQL);
  else if (rule.matchType === "contains") conds.push(like(col, `%${rule.pattern}%`) as SQL);
  // regex: JS and MySQL dialects differ — leave it to the JS matcher.
  if (rule.accountId != null) conds.push(eq(transactions.accountId, rule.accountId) as SQL);
  if (rule.direction) conds.push(eq(transactions.direction, rule.direction) as SQL);
  if (rule.amountMin != null) conds.push(gte(transactions.amount, (rule.amountMin - 0.005).toFixed(3)) as SQL);
  if (rule.amountMax != null) conds.push(lte(transactions.amount, (rule.amountMax + 0.005).toFixed(3)) as SQL);
  return and(...conds) ?? sql`1=1`;
}

// Any of these rules could match (OR of their prefilters) — for a whole-table pass.
function anyRuleWhere(rules: CategoryRule[]): SQL {
  if (!rules.length) return sql`0=1`;
  return or(...rules.map(ruleWhere)) ?? sql`0=1`;
}

const uncategorized = () => or(isNull(transactions.category), eq(transactions.category, "")) as SQL;

const txnCols = {
  id: transactions.id,
  description: transactions.description,
  category: transactions.category,
  categoryRuleId: transactions.categoryRuleId,
  accountId: transactions.accountId,
  amount: transactions.amount,
  direction: transactions.direction,
  billId: transactions.billId,
  billRuleId: transactions.billRuleId,
  periodId: transactions.periodId,
  pending: transactions.pending,
};
type TxnRow = {
  id: number;
  description: string;
  category: string | null;
  categoryRuleId: number | null;
  accountId: number | null;
  amount: string;
  direction: string;
  billId: number | null;
  billRuleId: number | null;
  periodId: number | null;
  pending: boolean;
};

export function txnInput(t: Pick<TxnRow, "description" | "category" | "accountId" | "amount" | "direction">): CategorizeInput {
  return {
    description: t.description,
    rawCategory: t.category,
    accountId: t.accountId,
    amount: Number(t.amount),
    direction: t.direction,
  };
}

// Latest instance per (period, bill) for the given bills — what a new bill link points at.
async function instanceLookup(billIds: number[]): Promise<(billId: number, periodId: number | null) => number | null> {
  const map = new Map<string, number>();
  if (billIds.length) {
    const rows = await db
      .select({ id: billInstances.id, billId: billInstances.billId, periodId: billInstances.periodId })
      .from(billInstances)
      .where(inArray(billInstances.billId, [...new Set(billIds)]));
    for (const r of rows) {
      const k = `${r.periodId}|${r.billId}`;
      if ((map.get(k) ?? -1) < r.id) map.set(k, r.id);
    }
  }
  return (billId, periodId) => (periodId == null ? null : (map.get(`${periodId}|${billId}`) ?? null));
}

function affected(res: unknown): number {
  return (res as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}

// Group ids by a key and run one UPDATE per (group, 500-id chunk).
async function writeGrouped<T>(groups: Map<string, { set: T; ids: number[] }>, extra?: SQL): Promise<number> {
  let n = 0;
  for (const { set, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const where = extra ? and(inArray(transactions.id, chunk), extra) : inArray(transactions.id, chunk);
      n += affected(await db.update(transactions).set(set as Record<string, unknown>).where(where));
    }
  }
  return n;
}

function push<T>(groups: Map<string, { set: T; ids: number[] }>, key: string, set: T, id: number) {
  const g = groups.get(key);
  if (g) g.ids.push(id);
  else groups.set(key, { set, ids: [id] });
}

export interface ApplyRulesResult {
  categorized: number;
  linked: number;
}

/** What a pass would do, without writing — the editor's live preview. */
export interface RulePreview extends ApplyRulesResult {
  samples: string[];
}

interface PlannedRow {
  row: TxnRow;
  category?: { category: string; ruleId: number };
  bill?: { billId: number; ruleId: number };
}

async function plan(opts: {
  rules: CategoryRule[];
  where?: SQL;
  categories: boolean;
  bills: boolean;
}): Promise<PlannedRow[]> {
  const rules = opts.rules.filter(ruleHasAction);
  if (!rules.length || (!opts.categories && !opts.bills)) return [];
  const open: SQL[] = [];
  if (opts.categories) open.push(uncategorized());
  if (opts.bills) open.push(and(isNull(transactions.billId), eq(transactions.pending, false)) as SQL);
  const rows: TxnRow[] = await db
    .select(txnCols)
    .from(transactions)
    .where(and(or(...open), anyRuleWhere(rules), opts.where));
  const out: PlannedRow[] = [];
  for (const row of rows) {
    const res = categorize(txnInput(row), rules);
    const p: PlannedRow = { row };
    const isUncat = !row.category;
    if (opts.categories && isUncat && res.matchedRuleId != null && res.category) {
      p.category = { category: res.category, ruleId: res.matchedRuleId };
    }
    if (opts.bills && row.billId == null && !row.pending && res.billRuleId != null && res.billId != null) {
      p.bill = { billId: res.billId, ruleId: res.billRuleId };
    }
    if (p.category || p.bill) out.push(p);
  }
  return out;
}

// Run rules over transactions and write what they decide. `rules` defaults to every saved rule;
// `where` scopes the rows (an import batch, a sync's new rows, one rule's matches…).
export async function applyRules(opts: {
  rules?: CategoryRule[];
  where?: SQL;
  categories?: boolean;
  bills?: boolean;
}): Promise<ApplyRulesResult> {
  const rules = opts.rules ?? (await loadRules());
  const planned = await plan({
    rules,
    where: opts.where,
    categories: opts.categories ?? true,
    bills: opts.bills ?? true,
  });
  if (!planned.length) return { categorized: 0, linked: 0 };

  const cats = new Map<string, { set: { category: string; categoryRuleId: number }; ids: number[] }>();
  const links = new Map<string, { set: { billId: number; billInstanceId: number | null; billRuleId: number }; ids: number[] }>();
  const instanceOf = await instanceLookup(planned.flatMap((p) => (p.bill ? [p.bill.billId] : [])));
  for (const p of planned) {
    if (p.category) {
      const { category, ruleId } = p.category;
      push(cats, `${ruleId}|${category}`, { category, categoryRuleId: ruleId }, p.row.id);
    }
    if (p.bill) {
      const { billId, ruleId } = p.bill;
      const inst = instanceOf(billId, p.row.periodId);
      push(links, `${ruleId}|${billId}|${inst}`, { billId, billInstanceId: inst, billRuleId: ruleId }, p.row.id);
    }
  }
  // Re-check the "still open" condition in the UPDATE so a row changed by hand between the
  // read and the write is left alone.
  const categorized = await writeGrouped(cats, uncategorized());
  const linked = await writeGrouped(links, isNull(transactions.billId));
  return { categorized, linked };
}

export async function previewRule(rule: CategoryRule): Promise<RulePreview> {
  const planned = await plan({ rules: [rule], categories: true, bills: true });
  return {
    categorized: planned.filter((p) => p.category).length,
    linked: planned.filter((p) => p.bill).length,
    samples: planned.slice(0, 8).map((p) => p.row.description),
  };
}

export interface ReapplyResult extends ApplyRulesResult {
  /** Rows this rule had categorized that still match — moved to the (possibly new) category. */
  recategorized: number;
  /** Rows this rule had categorized that no longer match — uncategorized again. */
  cleared: number;
  /** Bill links this rule made that still match — re-pointed if the bill changed. */
  relinked: number;
  /** Bill links this rule made that no longer match — unlinked. */
  unlinked: number;
}

// Reconcile everything a rule previously did with its (edited) definition, then pick up new
// matches. Only rows stamped with this rule are touched; hand-set values never are.
export async function reapplyRule(rule: CategoryRule): Promise<ReapplyResult> {
  const stamped: TxnRow[] = await db
    .select(txnCols)
    .from(transactions)
    .where(or(eq(transactions.categoryRuleId, rule.id), eq(transactions.billRuleId, rule.id)));

  const keepCat: number[] = [];
  const dropCat: number[] = [];
  const keepBill = new Map<string, { set: { billId: number; billInstanceId: number | null }; ids: number[] }>();
  const dropBill: number[] = [];
  const instanceOf = await instanceLookup(rule.billId != null ? [rule.billId] : []);
  for (const t of stamped) {
    const hit = matchesRule(rule, txnInput(t));
    if (t.categoryRuleId === rule.id) (hit && rule.category ? keepCat : dropCat).push(t.id);
    if (t.billRuleId === rule.id) {
      if (hit && rule.billId != null) {
        if (t.billId !== rule.billId) {
          const inst = instanceOf(rule.billId, t.periodId);
          push(keepBill, `${inst}`, { billId: rule.billId, billInstanceId: inst }, t.id);
        }
      } else dropBill.push(t.id);
    }
  }

  const one = <T>(set: T, ids: number[]) => new Map([["x", { set, ids }]]);
  const recategorized = rule.category ? await writeGrouped(one({ category: rule.category }, keepCat)) : 0;
  const cleared = await writeGrouped(one({ category: null, categoryRuleId: null }, dropCat));
  const relinked = await writeGrouped(keepBill);
  const unlinked = await writeGrouped(one({ billId: null, billInstanceId: null, billRuleId: null }, dropBill));
  const applied = await applyRules({ rules: [rule], where: ruleWhere(rule) });
  return { recategorized, cleared, relinked, unlinked, ...applied };
}

// Undo what a rule did (before deleting it, or when it was just wrong).
export async function undoRule(id: number, opts: { categories: boolean; bills: boolean }): Promise<ApplyRulesResult> {
  let categorized = 0;
  let linked = 0;
  if (opts.categories) {
    categorized = affected(
      await db
        .update(transactions)
        .set({ category: null, categoryRuleId: null })
        .where(eq(transactions.categoryRuleId, id)),
    );
  }
  if (opts.bills) {
    linked = affected(
      await db
        .update(transactions)
        .set({ billId: null, billInstanceId: null, billRuleId: null })
        .where(eq(transactions.billRuleId, id)),
    );
  }
  return { categorized, linked };
}

export async function ruleUsage(id: number): Promise<{ categories: number; bills: number }> {
  const [r] = await db
    .select({
      categories: sql<number>`SUM(${transactions.categoryRuleId} = ${id})`,
      bills: sql<number>`SUM(${transactions.billRuleId} = ${id})`,
    })
    .from(transactions)
    .where(or(eq(transactions.categoryRuleId, id), eq(transactions.billRuleId, id)));
  return { categories: Number(r?.categories ?? 0), bills: Number(r?.bills ?? 0) };
}

// A month's sheet just gained bill instances: rows already linked to those bills (by a rule or by
// hand) but with no instance in that month — because the instance didn't exist yet — now point
// at it. Never re-points a row that already has an instance.
export async function adoptBillInstances(periodId: number): Promise<number> {
  const res = await db.execute(sql`
    UPDATE ${transactions} t
    JOIN (
      SELECT bill_id, MAX(id) AS id FROM ${billInstances}
      WHERE period_id = ${periodId} AND bill_id IS NOT NULL
      GROUP BY bill_id
    ) bi ON bi.bill_id = t.bill_id
    SET t.bill_instance_id = bi.id
    WHERE t.period_id = ${periodId} AND t.bill_id IS NOT NULL AND t.bill_instance_id IS NULL
  `);
  return affected(res);
}

// Import previews know an account only by its number; account-locked rules need the id.
export async function accountIdsByNumber(): Promise<Map<string, number>> {
  const rows = await db.select({ id: accounts.id, n: accounts.accountNumber }).from(accounts);
  return new Map(rows.map((r) => [r.n, r.id]));
}

"use server";

import { db } from "@/server/db";
import { budgets, budgetLines, periods, accountBalances } from "@/server/db/schema";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  BUDGET_MODES,
  DEBT_STRATEGIES,
  BUDGET_LINE_KINDS,
  type BudgetMode,
  type DebtStrategy,
} from "@/constants/enums";
import type { PlannedLine } from "@/server/lib/budget";
import { round2, absorbDelta } from "@/server/lib/budget";
import { toNum } from "@/server/lib/money";
import { requireSession } from "@/server/auth/session";

// A budget shows on its own page and in the dashboard panel — refresh both on every write.
function revalidateBudget() {
  revalidatePath("/budget");
  revalidatePath("/dashboard");
}

type Result = { ok: boolean; error?: string; id?: number };

const money = (n: unknown): number | null => {
  const v = typeof n === "number" ? n : toNum(n as string);
  return v == null || Number.isNaN(v) ? null : round2(v);
};

/**
 * Create the month's budget with its first draft of lines (the wizard already built them with
 * the pure planner; the server only validates shape and writes). One budget per period —
 * a second create for the same month is refused rather than silently replacing the plan.
 */
export async function createBudget(input: {
  periodLabel: string;
  mode: string;
  strategy?: string | null;
  plannedIncome?: number | null;
  autoRebalance?: boolean;
  lines: PlannedLine[];
}): Promise<Result> {
  await requireSession();
  if (!BUDGET_MODES.includes(input.mode as BudgetMode)) return { ok: false, error: "Pick a budget mode." };
  const strategy =
    input.strategy && DEBT_STRATEGIES.includes(input.strategy as DebtStrategy)
      ? (input.strategy as DebtStrategy)
      : null;

  const [period] = await db
    .select({ id: periods.id })
    .from(periods)
    .where(eq(periods.label, input.periodLabel))
    .limit(1);
  if (!period) return { ok: false, error: `No month ${input.periodLabel} exists yet.` };

  const [existing] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(eq(budgets.periodId, period.id))
    .limit(1);
  if (existing) return { ok: false, error: "This month already has a budget." };

  const lines = (input.lines ?? []).filter(
    (l) => BUDGET_LINE_KINDS.includes(l.kind) && l.label?.trim() && money(l.planned) != null,
  );
  // Exactly one target at most; the first flagged wins.
  let sawTarget = false;

  const id = await db.transaction(async (tx) => {
    const [res] = await tx.insert(budgets).values({
      periodId: period.id,
      mode: input.mode,
      strategy,
      plannedIncome: money(input.plannedIncome) != null ? String(money(input.plannedIncome)) : null,
      autoRebalance: !!input.autoRebalance,
    });
    const budgetId = Number(res.insertId);
    if (lines.length) {
      await tx.insert(budgetLines).values(
        lines.map((l, i) => {
          const isTarget = l.kind === "debt" && l.isTarget && !sawTarget;
          if (isTarget) sawTarget = true;
          return {
            budgetId,
            kind: l.kind,
            label: l.label.trim(),
            category: l.kind !== "debt" ? l.category ?? l.label.trim() : null,
            accountId: l.kind === "debt" ? l.accountId ?? null : null,
            planned: String(money(l.planned) ?? 0),
            minimum: l.kind === "debt" && money(l.minimum) != null ? String(money(l.minimum)) : null,
            isTarget,
            locked: l.locked ?? true, // lines start locked
            sortOrder: i,
          };
        }),
      );
    }
    return budgetId;
  });

  revalidateBudget();
  return { ok: true, id };
}

export async function updateBudget(
  id: number,
  patch: {
    plannedIncome?: number | null;
    notes?: string | null;
    strategy?: string | null;
    autoRebalance?: boolean;
  },
): Promise<void> {
  await requireSession();
  const set: Record<string, unknown> = {};
  if (patch.plannedIncome !== undefined)
    set.plannedIncome = patch.plannedIncome == null ? null : String(money(patch.plannedIncome) ?? 0);
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.strategy !== undefined)
    set.strategy = DEBT_STRATEGIES.includes(patch.strategy as DebtStrategy) ? patch.strategy : null;
  if (patch.autoRebalance !== undefined) set.autoRebalance = !!patch.autoRebalance;
  if (Object.keys(set).length) await db.update(budgets).set(set).where(eq(budgets.id, id));
  // Income moved, or auto was just switched on → sweep the leftover onto the target now.
  if (patch.plannedIncome !== undefined || patch.autoRebalance) await autoRebalanceIfOn(id);
  revalidateBudget();
}

/** Delete the month's plan. Lines cascade. The transactions it was measured against are untouched. */
export async function deleteBudget(id: number): Promise<void> {
  await requireSession();
  await db.delete(budgets).where(eq(budgets.id, id));
  revalidateBudget();
}

export async function addBudgetLine(
  budgetId: number,
  input: {
    kind: string;
    label: string;
    category?: string | null;
    accountId?: number | null;
    planned: number;
    minimum?: number | null;
  },
): Promise<Result> {
  await requireSession();
  if (!BUDGET_LINE_KINDS.includes(input.kind as (typeof BUDGET_LINE_KINDS)[number]))
    return { ok: false, error: "Unknown line kind." };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Give the line a name." };
  const planned = money(input.planned);
  if (planned == null || planned < 0) return { ok: false, error: "Planned amount can't be negative." };
  if (input.kind === "debt" && input.accountId == null)
    return { ok: false, error: "Pick which debt this line is for." };

  // No two lines may measure the same thing — the actual would be counted twice.
  const dupCond =
    input.kind === "debt"
      ? and(eq(budgetLines.budgetId, budgetId), eq(budgetLines.accountId, input.accountId!))
      : and(eq(budgetLines.budgetId, budgetId), eq(budgetLines.category, input.category ?? label));
  const [dup] = await db.select({ id: budgetLines.id }).from(budgetLines).where(dupCond).limit(1);
  if (dup) return { ok: false, error: "This budget already has a line for that." };

  const [nextRow] = await db
    .select({ next: sql<number>`COALESCE(MAX(${budgetLines.sortOrder}), -1) + 1` })
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, budgetId));

  const [res] = await db.insert(budgetLines).values({
    budgetId,
    kind: input.kind,
    label,
    category: input.kind !== "debt" ? input.category ?? label : null,
    accountId: input.kind === "debt" ? input.accountId ?? null : null,
    planned: String(planned),
    minimum: input.kind === "debt" && money(input.minimum) != null ? String(money(input.minimum)) : null,
    locked: true,
    sortOrder: Number(nextRow?.next ?? 0),
  });
  await autoRebalanceIfOn(budgetId);
  revalidateBudget();
  return { ok: true, id: Number(res.insertId) };
}

export async function updateBudgetLine(
  id: number,
  patch: { planned?: number; label?: string; notes?: string | null; locked?: boolean },
): Promise<Result> {
  await requireSession();
  const set: Record<string, unknown> = {};
  if (patch.locked !== undefined) set.locked = !!patch.locked;
  if (patch.planned !== undefined && patch.locked === undefined) {
    // A locked line keeps its amount until it's unlocked — the guard that makes locks mean something.
    const [cur] = await db.select({ locked: budgetLines.locked }).from(budgetLines).where(eq(budgetLines.id, id)).limit(1);
    if (cur?.locked) return { ok: false, error: "This line is locked. Unlock it to change the amount." };
  }
  if (patch.planned !== undefined) {
    const v = money(patch.planned);
    if (v == null || v < 0) return { ok: false, error: "Planned amount can't be negative." };
    set.planned = String(v);
  }
  if (patch.label !== undefined) {
    const l = patch.label.trim();
    if (!l) return { ok: false, error: "Give the line a name." };
    set.label = l;
  }
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (Object.keys(set).length) await db.update(budgetLines).set(set).where(eq(budgetLines.id, id));
  // Editing the target's own payment is a deliberate override — don't immediately undo it.
  const [line] = await db
    .select({ budgetId: budgetLines.budgetId, isTarget: budgetLines.isTarget })
    .from(budgetLines)
    .where(eq(budgetLines.id, id))
    .limit(1);
  if (line && patch.planned !== undefined && !line.isTarget) await autoRebalanceIfOn(line.budgetId);
  revalidateBudget();
  return { ok: true };
}

export async function deleteBudgetLine(id: number): Promise<void> {
  await requireSession();
  const [line] = await db
    .select({ budgetId: budgetLines.budgetId })
    .from(budgetLines)
    .where(eq(budgetLines.id, id))
    .limit(1);
  await db.delete(budgetLines).where(eq(budgetLines.id, id));
  if (line) await autoRebalanceIfOn(line.budgetId);
  revalidateBudget();
}

/** Move the snowball focus to another debt line. Exactly one line carries the flag. */
export async function setBudgetTarget(budgetId: number, lineId: number): Promise<Result> {
  await requireSession();
  const [line] = await db
    .select({ id: budgetLines.id, kind: budgetLines.kind })
    .from(budgetLines)
    .where(and(eq(budgetLines.id, lineId), eq(budgetLines.budgetId, budgetId)))
    .limit(1);
  if (!line || line.kind !== "debt") return { ok: false, error: "Only a debt line can be the target." };
  await db.transaction(async (tx) => {
    await tx
      .update(budgetLines)
      .set({ isTarget: false })
      .where(and(eq(budgetLines.budgetId, budgetId), ne(budgetLines.id, lineId)));
    await tx.update(budgetLines).set({ isTarget: true }).where(eq(budgetLines.id, lineId));
  });
  await autoRebalanceIfOn(budgetId);
  revalidateBudget();
  return { ok: true };
}

/**
 * Re-derive the target's planned payment from everything else: income − every other line's
 * planned − the target's own minimum = the extra. Never plans above the debt's current balance
 * when one is known. Returns what happened so callers can report it; writes nothing when the
 * budget has no income or no target.
 */
async function applyRebalance(
  budgetId: number,
  targetBalance?: number | null,
): Promise<Result & { planned?: number }> {
  const [b] = await db.select().from(budgets).where(eq(budgets.id, budgetId)).limit(1);
  if (!b) return { ok: false, error: "Budget not found." };
  const income = toNum(b.plannedIncome);
  if (income == null) return { ok: false, error: "Set the month's income first." };
  const lines = await db.select().from(budgetLines).where(eq(budgetLines.budgetId, budgetId));
  const target = lines.find((l) => l.isTarget);
  if (!target) return { ok: false, error: "Pick a target debt first." };
  const others = lines
    .filter((l) => l.id !== target.id)
    .reduce((s, l) => s + (toNum(l.planned) ?? 0), 0);
  const min = toNum(target.minimum) ?? 0;
  let planned = Math.max(min, round2(income - others));
  // Balance not passed in → look up the account's latest snapshot ourselves.
  let bal = targetBalance;
  if (bal === undefined && target.accountId != null) {
    const [snap] = await db
      .select({ balance: accountBalances.balance })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, target.accountId))
      .orderBy(desc(accountBalances.asOf), desc(accountBalances.id))
      .limit(1);
    bal = toNum(snap?.balance);
  }
  if (bal != null && bal > 0) planned = Math.min(planned, Math.max(min, bal));
  await db.update(budgetLines).set({ planned: String(planned) }).where(eq(budgetLines.id, target.id));
  return { ok: true, planned };
}

/** The auto-rebalance hook every write calls: a no-op unless the budget opted in. */
async function autoRebalanceIfOn(budgetId: number): Promise<void> {
  const [b] = await db
    .select({ auto: budgets.autoRebalance })
    .from(budgets)
    .where(eq(budgets.id, budgetId))
    .limit(1);
  if (b?.auto) await applyRebalance(budgetId);
}

/** The manual "Rebalance extra →" button. */
export async function rebalanceBudget(budgetId: number, targetBalance?: number | null): Promise<Result> {
  await requireSession();
  const r = await applyRebalance(budgetId, targetBalance);
  revalidateBudget();
  return { ok: r.ok, error: r.error };
}

/**
 * Envelope transfer: take `amount` from one line and give it to another, in one write. The
 * everyday act of balancing — "$50 less on dining, $50 more on gas" — without touching two
 * inputs and hoping the math lands. Refuses locked lines on either side and never drives the
 * source below zero. Doesn't trigger auto-rebalance: the total is unchanged by construction.
 */
export async function moveBudgetAmount(
  budgetId: number,
  fromLineId: number,
  toLineId: number,
  amount: number,
): Promise<Result> {
  await requireSession();
  const amt = money(amount);
  if (amt == null || amt <= 0) return { ok: false, error: "Enter an amount to move." };
  if (fromLineId === toLineId) return { ok: false, error: "Pick two different lines." };
  const rows = await db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.budgetId, budgetId), inArray(budgetLines.id, [fromLineId, toLineId])));
  const from = rows.find((r) => r.id === fromLineId);
  const to = rows.find((r) => r.id === toLineId);
  if (!from || !to) return { ok: false, error: "Line not found." };
  if (from.locked) return { ok: false, error: `${from.label} is locked.` };
  if (to.locked) return { ok: false, error: `${to.label} is locked.` };
  const fromPlanned = toNum(from.planned) ?? 0;
  if (amt > fromPlanned) return { ok: false, error: `${from.label} only has ${fromPlanned.toFixed(2)} to give.` };
  await db.transaction(async (tx) => {
    await tx.update(budgetLines).set({ planned: String(round2(fromPlanned - amt)) }).where(eq(budgetLines.id, from.id));
    await tx.update(budgetLines).set({ planned: String(round2((toNum(to.planned) ?? 0) + amt)) }).where(eq(budgetLines.id, to.id));
  });
  revalidateBudget();
  return { ok: true };
}

/**
 * The plan view's amount edit. The line must be unlocked. Its change is absorbed by the OTHER
 * unlocked lines (the pool); whatever they can't take — or all of it, when nothing else is
 * unlocked — falls to the leftover, which the auto-rebalance target then sweeps if that's on.
 * One transaction so a pair edit can't half-apply. Returns what moved so the UI can say it.
 */
export async function setBudgetLinePlanned(
  budgetId: number,
  lineId: number,
  planned: number,
): Promise<Result & { absorbed?: { id: number; label: string; from: number; to: number }[] }> {
  await requireSession();
  const v = money(planned);
  if (v == null || v < 0) return { ok: false, error: "Planned amount can't be negative." };
  const lines = await db.select().from(budgetLines).where(eq(budgetLines.budgetId, budgetId));
  const line = lines.find((l) => l.id === lineId);
  if (!line) return { ok: false, error: "Line not found." };
  if (line.locked) return { ok: false, error: "This line is locked. Unlock it to change the amount." };
  const [b] = await db.select({ auto: budgets.autoRebalance }).from(budgets).where(eq(budgets.id, budgetId)).limit(1);
  const old = toNum(line.planned) ?? 0;
  const delta = round2(v - old);
  if (delta === 0) return { ok: true, absorbed: [] };
  // With auto-rebalance on, the target is the sink, not a pool member — it takes the leftover.
  const others = lines
    .filter((l) => l.id !== lineId && !l.locked && !(b?.auto && l.isTarget))
    .map((l) => ({ id: l.id, planned: toNum(l.planned) ?? 0 }));
  const { updates } = absorbDelta(others, delta);
  await db.transaction(async (tx) => {
    await tx.update(budgetLines).set({ planned: String(v) }).where(eq(budgetLines.id, lineId));
    for (const [id, p] of updates) await tx.update(budgetLines).set({ planned: String(p) }).where(eq(budgetLines.id, id));
  });
  if (b?.auto) await applyRebalance(budgetId);
  revalidateBudget();
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    ok: true,
    absorbed: [...updates].map(([id, to]) => ({ id, label: byId.get(id)!.label, from: toNum(byId.get(id)!.planned) ?? 0, to })),
  };
}

import "server-only";
import { db } from "@/server/db";
import {
  accounts,
  accountAliases,
  accountBalances,
  budgetLines,
  categoryMappings,
  importBatches,
  investmentPositions,
  investmentTrades,
  savingsGoals,
  syncAccounts,
  transactions,
} from "@/server/db/schema";
import { count, eq, inArray, type SQL } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";

// Folding one account into another: a reissued card (new last four, same account) shows up as
// a second account the first time an old statement is imported. Merging moves everything the
// old account owns onto the one being kept, records the old number as an alias so later
// imports of old statements land on the kept account (lib/account-aliases.ts), and deletes
// the old row.
//
// It cannot be undone, so the plan is computed first and shown to the user; `mergeAccounts`
// re-computes the same plan inside its transaction and acts on that.

export interface MergeSide {
  id: number;
  name: string;
  accountNumber: string;
  accountType: string | null;
  institution: string | null;
}

export interface MergePlan {
  from: MergeSide; // goes away
  into: MergeSide; // is kept
  transactions: number;
  /** Balance snapshots that move. */
  balances: number;
  /** Snapshots dropped because the kept account already has one for that date. */
  balancesDropped: number;
  importBatches: number;
  trades: number;
  /** Holdings rows that move / are dropped (the kept account already has that date's snapshot). */
  positions: number;
  positionsDropped: number;
  goals: number;
  rules: number;
  budgetLines: number;
  /** Budget lines left without an account: that month already has a line for the kept one. */
  budgetLinesUnlinked: number;
  /** What happens to the bank-sync feed of the account going away. */
  sync: "none" | "moves" | "unlinked";
  /** What happens to its bill link. */
  bill: "none" | "moves" | "dropped";
  /** Every former number the kept account answers to afterwards. */
  aliases: string[];
  /** Why this merge is refused, if it is. */
  blocked: string | null;
  warnings: string[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = typeof db | Tx;

const nameOf = (a: typeof accounts.$inferSelect) => a.label || a.institution || `··${a.accountNumber}`;
const side = (a: typeof accounts.$inferSelect): MergeSide => ({
  id: a.id,
  name: nameOf(a),
  accountNumber: a.accountNumber,
  accountType: a.accountType,
  institution: a.institution,
});

interface Loaded {
  plan: MergePlan;
  from: typeof accounts.$inferSelect;
  into: typeof accounts.$inferSelect;
  dropBalanceIds: number[];
  dropPositionIds: number[];
  unlinkBudgetLineIds: number[];
}

async function load(q: Q, fromId: number, intoId: number): Promise<Loaded | { error: string }> {
  if (fromId === intoId) return { error: "Pick two different accounts." };
  const rows = await q.select().from(accounts).where(inArray(accounts.id, [fromId, intoId]));
  const from = rows.find((r) => r.id === fromId);
  const into = rows.find((r) => r.id === intoId);
  if (!from || !into) return { error: "One of those accounts no longer exists." };

  const n = async (table: MySqlTable, where: SQL): Promise<number> => {
    const [r] = await q.select({ c: count() }).from(table).where(where);
    return Number(r?.c ?? 0);
  };

  // Same-date balance snapshots: the kept account's reading stands.
  const [fromBal, intoBal] = await Promise.all([
    q.select({ id: accountBalances.id, asOf: accountBalances.asOf }).from(accountBalances).where(eq(accountBalances.accountId, fromId)),
    q.select({ asOf: accountBalances.asOf }).from(accountBalances).where(eq(accountBalances.accountId, intoId)),
  ]);
  const intoBalDates = new Set(intoBal.map((b) => b.asOf));
  const dropBalanceIds = fromBal.filter((b) => intoBalDates.has(b.asOf)).map((b) => b.id);

  // Holdings are one whole snapshot per date, so a date both accounts have keeps the kept one's.
  const [fromPos, intoPos] = await Promise.all([
    q.select({ id: investmentPositions.id, asOf: investmentPositions.asOf }).from(investmentPositions).where(eq(investmentPositions.accountId, fromId)),
    q.select({ asOf: investmentPositions.asOf }).from(investmentPositions).where(eq(investmentPositions.accountId, intoId)),
  ]);
  const intoPosDates = new Set(intoPos.map((p) => p.asOf));
  const dropPositionIds = fromPos.filter((p) => intoPosDates.has(p.asOf)).map((p) => p.id);

  // A budget with a debt line for each account would count the kept account's payments twice.
  const [fromLines, intoLines] = await Promise.all([
    q.select({ id: budgetLines.id, budgetId: budgetLines.budgetId }).from(budgetLines).where(eq(budgetLines.accountId, fromId)),
    q.select({ budgetId: budgetLines.budgetId }).from(budgetLines).where(eq(budgetLines.accountId, intoId)),
  ]);
  const intoBudgets = new Set(intoLines.map((l) => l.budgetId));
  const unlinkBudgetLineIds = fromLines.filter((l) => intoBudgets.has(l.budgetId)).map((l) => l.id);

  const [fromSync, intoSync, fromAliases, intoAliases] = await Promise.all([
    q.select({ id: syncAccounts.id }).from(syncAccounts).where(eq(syncAccounts.accountId, fromId)),
    q.select({ id: syncAccounts.id }).from(syncAccounts).where(eq(syncAccounts.accountId, intoId)),
    q.select({ n: accountAliases.accountNumber }).from(accountAliases).where(eq(accountAliases.accountId, fromId)),
    q.select({ n: accountAliases.accountNumber }).from(accountAliases).where(eq(accountAliases.accountId, intoId)),
  ]);

  const [txns, batches, trades, goals, rules] = await Promise.all([
    n(transactions, eq(transactions.accountId, fromId)),
    n(importBatches, eq(importBatches.accountId, fromId)),
    n(investmentTrades, eq(investmentTrades.accountId, fromId)),
    n(savingsGoals, eq(savingsGoals.fundingAccountId, fromId)),
    n(categoryMappings, eq(categoryMappings.accountId, fromId)),
  ]);

  const sync: MergePlan["sync"] = !fromSync.length ? "none" : intoSync.length ? "unlinked" : "moves";
  const bill: MergePlan["bill"] =
    from.billId == null ? "none" : into.billId == null ? "moves" : into.billId === from.billId ? "none" : "dropped";

  const warnings: string[] = [];
  if (from.institution && into.institution && from.institution.toLowerCase() !== into.institution.toLowerCase()) {
    warnings.push(`These are at different institutions (${from.institution} and ${into.institution}).`);
  }
  if (sync === "unlinked") {
    warnings.push(`Both accounts have a bank-sync feed. ${nameOf(from)}'s feed will be switched off and left unmapped.`);
  }
  if (bill === "dropped") {
    warnings.push(`Both accounts are tied to a bill. ${nameOf(into)} keeps its own; payments made to the other bill will not count toward it.`);
  }
  if (dropBalanceIds.length) {
    warnings.push(
      `${dropBalanceIds.length} balance snapshot${dropBalanceIds.length === 1 ? "" : "s"} fall on a date ${nameOf(into)} already has a balance for, and will be discarded.`,
    );
  }
  if (dropPositionIds.length) {
    warnings.push(`Holdings recorded on a date ${nameOf(into)} already has holdings for will be discarded.`);
  }
  if (unlinkBudgetLineIds.length) {
    warnings.push(
      `${unlinkBudgetLineIds.length} budget line${unlinkBudgetLineIds.length === 1 ? "" : "s"} will lose the account link: that month already has a line for ${nameOf(into)}.`,
    );
  }

  const blocked =
    from.accountType && into.accountType && from.accountType !== into.accountType
      ? `These are different kinds of account (${from.accountType} and ${into.accountType}). Change one's type first if they really are the same account.`
      : null;

  return {
    from,
    into,
    dropBalanceIds,
    dropPositionIds,
    unlinkBudgetLineIds,
    plan: {
      from: side(from),
      into: side(into),
      transactions: txns,
      balances: fromBal.length - dropBalanceIds.length,
      balancesDropped: dropBalanceIds.length,
      importBatches: batches,
      trades,
      positions: fromPos.length - dropPositionIds.length,
      positionsDropped: dropPositionIds.length,
      goals,
      rules,
      budgetLines: fromLines.length - unlinkBudgetLineIds.length,
      budgetLinesUnlinked: unlinkBudgetLineIds.length,
      sync,
      bill,
      aliases: [...new Set([...intoAliases.map((a) => a.n), ...fromAliases.map((a) => a.n), from.accountNumber])],
      blocked,
      warnings,
    },
  };
}

export type MergeResult = { ok: true; plan: MergePlan } | { ok: false; error: string };

/** What merging `fromId` into `intoId` would do. Reads only. */
export async function planAccountMerge(fromId: number, intoId: number): Promise<MergeResult> {
  const l = await load(db, fromId, intoId);
  if ("error" in l) return { ok: false, error: l.error };
  return { ok: true, plan: l.plan };
}

/**
 * Merge `fromId` into `intoId`, all or nothing. Returns the plan that was carried out.
 * Not reversible: the account going away is deleted.
 */
export async function mergeAccounts(fromId: number, intoId: number): Promise<MergeResult> {
  try {
    return await db.transaction(async (tx): Promise<MergeResult> => {
      const l = await load(tx, fromId, intoId);
      if ("error" in l) return { ok: false, error: l.error };
      if (l.plan.blocked) return { ok: false, error: l.plan.blocked };
      const { from, into, plan } = l;

      // Rows that can't coexist with the kept account's own go first; the rest are repointed.
      if (l.dropBalanceIds.length) await tx.delete(accountBalances).where(inArray(accountBalances.id, l.dropBalanceIds));
      if (l.dropPositionIds.length) await tx.delete(investmentPositions).where(inArray(investmentPositions.id, l.dropPositionIds));
      if (l.unlinkBudgetLineIds.length) await tx.update(budgetLines).set({ accountId: null }).where(inArray(budgetLines.id, l.unlinkBudgetLineIds));

      await tx.update(transactions).set({ accountId: intoId }).where(eq(transactions.accountId, fromId));
      await tx.update(accountBalances).set({ accountId: intoId }).where(eq(accountBalances.accountId, fromId));
      await tx.update(importBatches).set({ accountId: intoId }).where(eq(importBatches.accountId, fromId));
      await tx.update(investmentTrades).set({ accountId: intoId }).where(eq(investmentTrades.accountId, fromId));
      await tx.update(investmentPositions).set({ accountId: intoId }).where(eq(investmentPositions.accountId, fromId));
      await tx.update(savingsGoals).set({ fundingAccountId: intoId }).where(eq(savingsGoals.fundingAccountId, fromId));
      await tx.update(budgetLines).set({ accountId: intoId }).where(eq(budgetLines.accountId, fromId));
      // Account-locked rules cascade-delete with their account, so they must move before it goes.
      await tx.update(categoryMappings).set({ accountId: intoId }).where(eq(categoryMappings.accountId, fromId));

      if (plan.sync === "moves") {
        await tx.update(syncAccounts).set({ accountId: intoId }).where(eq(syncAccounts.accountId, fromId));
      } else if (plan.sync === "unlinked") {
        await tx.update(syncAccounts).set({ accountId: null, enabled: false }).where(eq(syncAccounts.accountId, fromId));
      }

      // The old number, and any numbers the old account itself answered to, now mean the kept one.
      await tx.update(accountAliases).set({ accountId: intoId }).where(eq(accountAliases.accountId, fromId));
      await tx
        .insert(accountAliases)
        .values({ accountId: intoId, accountNumber: from.accountNumber })
        .onDuplicateKeyUpdate({ set: { accountId: intoId } });

      // Anything still pointing at the old account makes this delete fail, which rolls the
      // whole merge back — better than orphaning rows a later table was added for.
      await tx.delete(accounts).where(eq(accounts.id, fromId));

      // Facts the kept account lacks are taken from the one that went away. The bill link is
      // unique per account, so it can only be claimed once the old row is gone.
      const fill: Partial<typeof accounts.$inferInsert> = {};
      if (!into.label && from.label) fill.label = from.label;
      if (!into.institution && from.institution) fill.institution = from.institution;
      if (!into.accountType && from.accountType) fill.accountType = from.accountType;
      if (into.originalPrincipal == null && from.originalPrincipal != null) fill.originalPrincipal = from.originalPrincipal;
      if (!into.notes && from.notes) fill.notes = from.notes;
      if (from.openedOn && (!into.openedOn || from.openedOn < into.openedOn)) fill.openedOn = from.openedOn;
      if (plan.bill === "moves") fill.billId = from.billId;
      if (Object.keys(fill).length) await tx.update(accounts).set(fill).where(eq(accounts.id, intoId));

      return { ok: true, plan };
    });
  } catch (e) {
    return { ok: false, error: `Nothing was changed. The merge failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Stop treating `accountNumber` as a former number of anything (it is becoming its own account). */
export async function dropAlias(accountNumber: string): Promise<void> {
  await db.delete(accountAliases).where(eq(accountAliases.accountNumber, accountNumber));
}

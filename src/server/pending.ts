import "server-only";
import { db } from "@/server/db";
import { transactions, accounts, cashAllocations, transactionSplits } from "@/server/db/schema";
import { and, eq, gte, lte, inArray, isNull, isNotNull, or, type SQL } from "drizzle-orm";
import { normalizeMerchant } from "@/server/lib/merchant";
import {
  pairPending,
  enteredWindow,
  postedWindow,
  type MatchSide,
} from "@/server/lib/pending-match";
import type { PreviewRow } from "@/server/lib/import-types";

// Pending transactions: rows entered by hand before the bank posted them. The matching rules
// live in src/server/lib/pending-match.ts (pure); this file is the DB side — finding the
// candidates, and folding a hand-entered row into its posted twin.
// See planning/features/pending-transactions.md.

// "Entered by hand" = never came from a statement: no import batch and no raw bank columns
// (the seeded history has raw columns but no batch, so it counts as bank data).
const enteredByHand = and(isNull(transactions.importBatchId), isNull(transactions.raw)) as SQL;
const fromStatement = or(isNotNull(transactions.importBatchId), isNotNull(transactions.raw)) as SQL;

const sideCols = {
  id: transactions.id,
  accountNumber: accounts.accountNumber,
  txnDate: transactions.txnDate,
  amount: transactions.amount,
  direction: transactions.direction,
  description: transactions.description,
  pending: transactions.pending,
};

type SideRow = {
  id: number;
  accountNumber: string | null;
  txnDate: string;
  amount: string;
  direction: string;
  description: string;
  pending: boolean;
};

const toSide = (r: SideRow): MatchSide => ({
  id: r.id,
  accountNumber: r.accountNumber,
  txnDate: r.txnDate,
  amount: Number(r.amount),
  direction: r.direction,
  description: r.description,
});

/**
 * Import preview: point each "new" row at the hand-entered transaction it most likely is, and
 * pre-tick the merge when that's a safe call — the user marked it pending, or the amount is
 * exact. Everything else is shown as a suggestion, unticked. Mutates `rows` in place.
 */
export async function attachPendingMatches(rows: PreviewRow[]): Promise<void> {
  const fresh = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "new" && r.dedupHash && r.accountNumber && r.amount != null);
  if (!fresh.length) return;
  const win = enteredWindow(fresh.map(({ r }) => r.txnDate));
  if (!win) return;
  const acctNums = [...new Set(fresh.map(({ r }) => r.accountNumber))];

  const entered = await db
    .select({ ...sideCols, category: transactions.category })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        enteredByHand,
        inArray(accounts.accountNumber, acctNums),
        gte(transactions.txnDate, win.from),
        lte(transactions.txnDate, win.to),
      ),
    );
  if (!entered.length) return;

  // Preview rows have no ids yet — use negative indexes so they can't collide with real ones.
  const posted: MatchSide[] = fresh.map(({ r, i }) => ({
    id: -(i + 1),
    accountNumber: r.accountNumber,
    txnDate: r.txnDate,
    amount: Math.abs(r.amount!),
    direction: r.direction,
    description: r.description,
  }));
  const byId = new Map(entered.map((e) => [e.id, e]));
  for (const pr of pairPending(entered.map(toSide), posted)) {
    const e = byId.get(pr.enteredId)!;
    const row = rows[-pr.postedId - 1];
    row.pendingMatch = {
      id: e.id,
      txnDate: e.txnDate,
      description: e.description,
      amount: Number(e.amount),
      category: e.category,
      pending: e.pending,
      score: pr.score,
    };
    row.mergeWith = e.pending || pr.exactAmount ? e.id : null;
  }
}

export interface PendingReviewItem {
  pending: {
    id: number;
    txnDate: string;
    description: string;
    amount: number;
    direction: string;
    accountNumber: string | null;
    accountLabel: string | null;
    notes: string | null;
  };
  /** The posted row this most likely became, or null while it's still genuinely pending. */
  match: {
    id: number;
    txnDate: string;
    description: string;
    amount: number;
    score: number;
  } | null;
}

/**
 * Every transaction still marked pending, each with the imported row it most likely posted as
 * (if one has arrived). Catches the case the import preview can't: the statement was imported
 * without merging, so the charge is now in the list twice.
 */
export async function getPendingReview(): Promise<PendingReviewItem[]> {
  const pendingRows = await db
    .select({ ...sideCols, accountLabel: accounts.label, notes: transactions.notes })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(eq(transactions.pending, true))
    .orderBy(transactions.txnDate, transactions.id);
  if (!pendingRows.length) return [];

  const win = postedWindow(pendingRows.map((p) => p.txnDate));
  const acctNums = [
    ...new Set(pendingRows.map((p) => p.accountNumber).filter((n): n is string => !!n)),
  ];
  const posted =
    win && acctNums.length
      ? await db
          .select(sideCols)
          .from(transactions)
          .innerJoin(accounts, eq(accounts.id, transactions.accountId))
          .where(
            and(
              fromStatement,
              eq(transactions.pending, false),
              inArray(accounts.accountNumber, acctNums),
              gte(transactions.txnDate, win.from),
              lte(transactions.txnDate, win.to),
            ),
          )
      : [];

  const pairs = pairPending(pendingRows.map(toSide), posted.map(toSide));
  const pairFor = new Map(pairs.map((p) => [p.enteredId, p]));
  const postedById = new Map(posted.map((p) => [p.id, p]));
  return pendingRows.map((p) => {
    const pr = pairFor.get(p.id);
    const m = pr ? postedById.get(pr.postedId) : undefined;
    return {
      pending: {
        id: p.id,
        txnDate: p.txnDate,
        description: p.description,
        amount: Number(p.amount),
        direction: p.direction,
        accountNumber: p.accountNumber,
        accountLabel: p.accountLabel,
        notes: p.notes,
      },
      match:
        pr && m
          ? {
              id: m.id,
              txnDate: m.txnDate,
              description: m.description,
              amount: Number(m.amount),
              score: pr.score,
            }
          : null,
    };
  });
}

/**
 * Both sides' commentary, one line each, without repeating a line either side already has
 * (a note typed on the pending entry and again in the import preview is kept once).
 */
export function joinNotes(...sides: (string | null | undefined)[]): string | null {
  const lines: string[] = [];
  for (const side of sides) {
    for (const line of (side ?? "").split("\n")) {
      const t = line.trim();
      if (t && !lines.includes(t)) lines.push(t);
    }
  }
  return lines.join("\n") || null;
}

/**
 * The notes a settled row carries: its own (typed in the import preview), then what the user
 * called the charge when it differs from the bank's name — "Dinner with Sam" says more than
 * "SQ *JG 8842" — then the pending entry's notes.
 */
export function settledNotes(
  bankDescription: string,
  entered: { description: string; notes: string | null },
  postedNotes: string | null | undefined,
): string | null {
  const typedName =
    normalizeMerchant(entered.description) !== normalizeMerchant(bankDescription) ? entered.description : null;
  return joinNotes(postedNotes, typedName, entered.notes);
}

export type MergeResult = { ok: true } | { ok: false; error: string };

/**
 * Fold a hand-entered transaction into the posted row it became, then delete the hand-entered
 * one. The posted row keeps the bank's facts — its description (the title), the settled
 * amount, the posting date, the dedup hash (so the next re-import of the same statement still
 * sees it as a duplicate), import batch and raw columns — and inherits everything the user
 * added: category, notes (plus what they called it, when the bank's name differs), bill link,
 * transfer partner, cash offsets and category split.
 *
 * `keepPostedCategory`: the user picked the posted row's category by hand in the import
 * preview, so it beats the one on the hand-entered row.
 */
export async function mergeIntoPosted(
  enteredId: number,
  postedId: number,
  opts: { keepPostedCategory?: boolean } = {},
): Promise<MergeResult> {
  if (enteredId === postedId) return { ok: false, error: "Can't merge a transaction into itself." };
  const cols = {
    id: transactions.id,
    description: transactions.description,
    notes: transactions.notes,
    category: transactions.category,
    categoryRuleId: transactions.categoryRuleId,
    billId: transactions.billId,
    billInstanceId: transactions.billInstanceId,
    transferPartnerId: transactions.transferPartnerId,
    importBatchId: transactions.importBatchId,
    raw: transactions.raw,
  };
  const [entered] = await db.select(cols).from(transactions).where(eq(transactions.id, enteredId)).limit(1);
  const [posted] = await db.select(cols).from(transactions).where(eq(transactions.id, postedId)).limit(1);
  if (!entered) return { ok: false, error: "The pending transaction no longer exists." };
  if (!posted) return { ok: false, error: "The posted transaction no longer exists." };
  // Guard against a stale or forged id: only a hand-entered row may be absorbed, or a
  // statement row could be deleted and come back on the next import.
  if (entered.importBatchId != null || entered.raw != null) {
    return { ok: false, error: "Only a transaction entered by hand can be merged away." };
  }

  const notes = settledNotes(posted.description, entered, posted.notes);

  // A category picked by hand beats one a rule guessed from the bank's description.
  const useEntered = !!entered.category && !opts.keepPostedCategory;
  const category = useEntered ? entered.category : posted.category;
  const categoryRuleId = useEntered ? entered.categoryRuleId : posted.categoryRuleId;

  const partnerId = posted.transferPartnerId ?? entered.transferPartnerId;
  await db
    .update(transactions)
    .set({
      notes,
      category,
      categoryRuleId,
      billId: posted.billId ?? entered.billId,
      billInstanceId: posted.billInstanceId ?? entered.billInstanceId,
      transferPartnerId: partnerId === postedId ? null : partnerId,
      pending: false,
    })
    .where(eq(transactions.id, postedId));
  // The other side of a transfer pointed at the hand-entered row; point it at the posted one.
  // (transfer_partner_id has no ON DELETE action, so this must happen before the delete.)
  await db
    .update(transactions)
    .set({ transferPartnerId: postedId })
    .where(and(eq(transactions.transferPartnerId, enteredId), eq(transactions.id, partnerId ?? -1)));
  await db
    .update(transactions)
    .set({ transferPartnerId: null })
    .where(eq(transactions.transferPartnerId, enteredId));

  // Cash offsets move across unless the posted row already has the same link (unique pair);
  // those leftovers cascade away with the delete below.
  const links = await db
    .select()
    .from(cashAllocations)
    .where(
      or(
        eq(cashAllocations.withdrawalTxnId, enteredId),
        eq(cashAllocations.spendTxnId, enteredId),
      ) as SQL,
    );
  let movedLinks = false;
  for (const l of links) {
    const w = l.withdrawalTxnId === enteredId ? postedId : l.withdrawalTxnId;
    const s = l.spendTxnId === enteredId ? postedId : l.spendTxnId;
    if (w === s) continue;
    const [clash] = await db
      .select({ id: cashAllocations.id })
      .from(cashAllocations)
      .where(and(eq(cashAllocations.withdrawalTxnId, w), eq(cashAllocations.spendTxnId, s)))
      .limit(1);
    if (clash) continue;
    await db
      .update(cashAllocations)
      .set({ withdrawalTxnId: w, spendTxnId: s })
      .where(eq(cashAllocations.id, l.id));
    movedLinks = true;
  }

  // A split made on the pending row moves across too, unless the posted row was split on its
  // own already (then the posted row's split wins and these cascade away with the delete).
  const [postedSplit] = await db
    .select({ id: transactionSplits.id })
    .from(transactionSplits)
    .where(eq(transactionSplits.txnId, postedId))
    .limit(1);
  let movedSplit = false;
  if (!postedSplit) {
    const res = await db
      .update(transactionSplits)
      .set({ txnId: postedId })
      .where(eq(transactionSplits.txnId, enteredId));
    movedSplit = ((res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0;
  }

  await db.delete(transactions).where(eq(transactions.id, enteredId));

  // The tip settled lower than the hold, say — the split parts must still fit. Parts first,
  // since a trimmed Cash part shrinks what the offsets can draw on.
  if (movedSplit) {
    const { reconcileSplitsAfterEdit } = await import("@/server/actions/splits");
    await reconcileSplitsAfterEdit(postedId);
  }
  // The posted amount can be lower than what was offset against the hand-entered one.
  if (movedLinks || movedSplit) {
    const { reconcileAllocationsAfterEdit } = await import("@/server/actions/cash");
    await reconcileAllocationsAfterEdit(postedId);
  }
  return { ok: true };
}

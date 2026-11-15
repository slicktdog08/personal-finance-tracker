import "server-only";
import { db } from "@/server/db";
import { accounts, accountBalances } from "@/server/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Moving some of one account's balance history onto another — the selective cousin of merging
// (lib/account-merge.ts). Each row of account_balances is one dated snapshot: balance, credit
// limit, APR, minimum payment and a note. Only the chosen snapshots change account; nothing
// else about either account is touched, so a move can be undone by moving the rows back.

/** What to do when the destination already has a snapshot on a moved row's date. */
export type BalanceConflict = "skip" | "replace";

export type BalanceMoveResult =
  | {
      ok: true;
      /** Ids of the snapshots that now belong to the destination. */
      moved: number[];
      /** Left on the source: the destination already had that date and `skip` was chosen. */
      skipped: number;
      /** The destination's own snapshots deleted to make way (`replace`). */
      replaced: number;
    }
  | { ok: false; error: string };

export async function moveBalanceSnapshots(
  ids: number[],
  fromId: number,
  intoId: number,
  conflict: BalanceConflict = "skip",
): Promise<BalanceMoveResult> {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!unique.length) return { ok: false, error: "Pick at least one balance to move." };
  if (fromId === intoId) return { ok: false, error: "Pick two different accounts." };

  try {
    return await db.transaction(async (tx): Promise<BalanceMoveResult> => {
      const found = await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, [fromId, intoId]));
      if (found.length !== 2) return { ok: false, error: "One of those accounts no longer exists." };

      // Only rows that really are on the source move — a stale page can't drag in anything else.
      const rows = await tx
        .select({ id: accountBalances.id, asOf: accountBalances.asOf })
        .from(accountBalances)
        .where(and(eq(accountBalances.accountId, fromId), inArray(accountBalances.id, unique)));
      if (rows.length !== unique.length) {
        return { ok: false, error: "Some of those balances have changed since the page loaded. Reload and try again." };
      }

      const dates = [...new Set(rows.map((r) => r.asOf))];
      const clashing = await tx
        .select({ id: accountBalances.id, asOf: accountBalances.asOf })
        .from(accountBalances)
        .where(and(eq(accountBalances.accountId, intoId), inArray(accountBalances.asOf, dates)));
      const clashDates = new Set(clashing.map((c) => c.asOf));

      let move = rows;
      let skipped = 0;
      let replaced = 0;
      if (clashing.length) {
        if (conflict === "replace") {
          await tx.delete(accountBalances).where(inArray(accountBalances.id, clashing.map((c) => c.id)));
          replaced = clashing.length;
        } else {
          move = rows.filter((r) => !clashDates.has(r.asOf));
          skipped = rows.length - move.length;
        }
      }

      const moved = move.map((r) => r.id);
      if (moved.length) await tx.update(accountBalances).set({ accountId: intoId }).where(inArray(accountBalances.id, moved));
      return { ok: true, moved, skipped, replaced };
    });
  } catch (e) {
    return { ok: false, error: `Nothing was changed. The move failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { billInstances, billStatuses } from "@/server/db/schema";
import { LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";

// A month's bill is paid once a posted payment is linked to it. Whenever a transaction gains a
// link to a bill instance — by a rule (sync, import, manual entry), by hand, or because the
// month's sheet was created after the payment landed — the instance moves to the "paid" status,
// so nobody has to tick it off by hand.
//
// What counts as a payment: a posted row (pending holds never count) that is either a Debit, or
// a Credit on a liability account (a card payment seen from the card's side). A refund linked
// to a subscription bill is not a payment.
//
// What gets moved: only instances still waiting to be paid — an unsettled status, or an
// "Autopay" one (scheduled, now confirmed). Anything else the user chose (Skipped, Suspended,
// Paid & Cancelled, No Balance, …) is left alone. Unlinking never reverts the status.

/** The status a paid bill gets: Paid/Purchased if it exists, else the first settled "paid" one. */
export function pickPaidStatus(statuses: { name: string; isSettled: boolean }[]): string | null {
  return (
    statuses.find((s) => s.name === "Paid/Purchased")?.name ??
    statuses.find((s) => s.isSettled && /paid/i.test(s.name))?.name ??
    null
  );
}

/** Statuses a linked payment may move to paid: unsettled ones, plus autopay ones. */
export function upgradeableStatuses(statuses: { name: string; isSettled: boolean }[], paid: string): string[] {
  return statuses.filter((s) => s.name !== paid && (!s.isSettled || /autopay/i.test(s.name))).map((s) => s.name);
}

const liabilityList = sql.join(
  LIABILITY_ACCOUNT_TYPES.map((t) => sql`${t}`),
  sql`, `,
);

// EXISTS: the instance has at least one linked payment.
const hasLinkedPayment = sql`EXISTS (
  SELECT 1 FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  WHERE t.bill_instance_id = ${billInstances.id}
    AND t.pending = 0
    AND (t.direction = 'Debit' OR a.account_type IN (${liabilityList}))
)`;

/**
 * Mark the given bill instances paid when a payment is linked to them. `scope` narrows which
 * instances are looked at: explicit ids, one month, or (omitted) every instance. Returns the
 * number of instances whose status changed.
 */
export async function settleLinkedInstances(scope?: { instanceIds?: (number | null | undefined)[]; periodId?: number }): Promise<number> {
  const ids = scope?.instanceIds ? [...new Set(scope.instanceIds.filter((i): i is number => i != null))] : null;
  if (ids && !ids.length) return 0;

  const statuses = await db
    .select({ name: billStatuses.name, isSettled: billStatuses.isSettled })
    .from(billStatuses)
    .where(eq(billStatuses.active, true));
  const paid = pickPaidStatus(statuses);
  if (!paid) return 0;
  const from = upgradeableStatuses(statuses, paid);
  if (!from.length) return 0;

  const conds: SQL[] = [inArray(billInstances.status, from) as SQL, hasLinkedPayment];
  if (ids) conds.push(inArray(billInstances.id, ids) as SQL);
  if (scope?.periodId != null) conds.push(eq(billInstances.periodId, scope.periodId) as SQL);
  const res = await db.update(billInstances).set({ status: paid }).where(and(...conds));
  return (res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}

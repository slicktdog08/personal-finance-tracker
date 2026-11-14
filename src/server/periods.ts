import "server-only";
import { db } from "@/server/db";
import { periods, billInstances, transactions } from "@/server/db/schema";
import { and, eq, isNull, gte, lte, desc, sql } from "drizzle-orm";
import { periodLabel, monthBounds, dateToYearMonth } from "@/server/lib/period";
import { DEFAULT_NEW_MONTH_STATUS } from "@/constants/enums";
import { todayIso } from "@/server/lib/pay-schedule";
import { adoptBillInstances } from "@/server/lib/rules";

// Month lifecycle, shared by the server actions and the pages that auto-create months.
//
// Months are no longer created by hand. The current month and the next one always exist: a page
// that needs them calls ensureCurrentPeriods(), which clones the most recent month that has bills
// (statuses reset to the default, autopay-style ones carried) — "assume last month until
// customized". Nothing ever creates further ahead than next month.

// Link any not-yet-assigned transactions whose date falls in this period.
async function adoptOrphanTransactions(periodId: number, start: string, end: string) {
  await db
    .update(transactions)
    .set({ periodId })
    .where(and(isNull(transactions.periodId), gte(transactions.txnDate, start), lte(transactions.txnDate, end)));
}

/**
 * Give every transaction a month. A month exists wherever there's a transaction dated in it, so
 * history imported from years back (statements, CSVs, a sync's first pull) shows up in the
 * month views, filters and Trends without anyone creating those months by hand. Months made this
 * way are bare (no bills cloned in) — they hold what happened, not a bill plan.
 *
 * Cheap when nothing is orphaned: one indexed `period_id IS NULL` probe. Returns how many months
 * it created.
 */
export async function ensureDataPeriods(): Promise<number> {
  const orphanMonths = await db
    .select({
      year: sql<number>`YEAR(${transactions.txnDate})`,
      month: sql<number>`MONTH(${transactions.txnDate})`,
    })
    .from(transactions)
    .where(isNull(transactions.periodId))
    .groupBy(sql`YEAR(${transactions.txnDate})`, sql`MONTH(${transactions.txnDate})`);
  if (!orphanMonths.length) return 0;

  const existing = await db.select({ year: periods.year, month: periods.month }).from(periods);
  const have = new Set(existing.map((p) => `${p.year}-${p.month}`));
  let created = 0;
  for (const m of orphanMonths) {
    const year = Number(m.year);
    const month = Number(m.month);
    if (!year || !month || have.has(`${year}-${month}`)) continue;
    const { start, end } = monthBounds(year, month);
    await db.insert(periods).values({ year, month, label: periodLabel(year, month), startDate: start, endDate: end });
    have.add(`${year}-${month}`);
    created++;
  }
  // One pass links every orphan — the new months' rows and any that slipped past a month that
  // already existed (the lazy insert path leaves period_id null when the month isn't loaded yet).
  await db.execute(sql`
    UPDATE ${transactions} t
    JOIN ${periods} p ON p.year = YEAR(t.txn_date) AND p.month = MONTH(t.txn_date)
    SET t.period_id = p.id
    WHERE t.period_id IS NULL`);
  return created;
}

// Statuses worth carrying forward as-is when cloning a month.
const CARRY_FORWARD = new Set(["Autopay", "Autopay Pending", "Suspended", "Optional", "Debt"]);

export async function ensurePeriod(year: number, month: number): Promise<number> {
  const existing = await db
    .select({ id: periods.id })
    .from(periods)
    .where(and(eq(periods.year, year), eq(periods.month, month)))
    .limit(1);
  if (existing.length) return existing[0].id;
  const { start, end } = monthBounds(year, month);
  await db.insert(periods).values({ year, month, label: periodLabel(year, month), startDate: start, endDate: end });
  const created = await db
    .select({ id: periods.id })
    .from(periods)
    .where(and(eq(periods.year, year), eq(periods.month, month)))
    .limit(1);
  await adoptOrphanTransactions(created[0].id, start, end);
  return created[0].id;
}

/** Copy `fromPeriodId`'s bill rows into (year, month) — a no-op if the target already has bills. */
export async function cloneInstances(fromPeriodId: number, year: number, month: number): Promise<number> {
  const targetId = await ensurePeriod(year, month);
  const already = await db
    .select({ id: billInstances.id })
    .from(billInstances)
    .where(eq(billInstances.periodId, targetId))
    .limit(1);
  if (already.length) return targetId;
  const source = await db.select().from(billInstances).where(eq(billInstances.periodId, fromPeriodId));
  if (source.length) {
    await db.insert(billInstances).values(
      source.map((s) => ({
        periodId: targetId,
        billId: s.billId,
        name: s.name,
        amount: s.amount,
        status: CARRY_FORWARD.has(s.status) ? s.status : DEFAULT_NEW_MONTH_STATUS,
        dueDay: s.dueDay,
        paymentType: s.paymentType,
        isDebt: s.isDebt,
        isCancel: s.isCancel,
        sortOrder: s.sortOrder,
      })),
    );
    await adoptBillInstances(targetId);
  }
  return targetId;
}

/** The most recent month that actually has bills on it — the template for a new month. */
async function latestPeriodWithBills(): Promise<number | null> {
  const rows = await db
    .select({ id: periods.id })
    .from(periods)
    .innerJoin(billInstances, eq(billInstances.periodId, periods.id))
    .groupBy(periods.id, periods.year, periods.month)
    .orderBy(desc(periods.year), desc(periods.month))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Labels of the months the app keeps alive automatically: this month and the next. */
export function autoPeriodLabels(today = todayIso()): { current: string; next: string } {
  const ym = dateToYearMonth(today)!;
  const nextZero = ym.year * 12 + (ym.month - 1) + 1;
  return {
    current: periodLabel(ym.year, ym.month),
    next: periodLabel(Math.floor(nextZero / 12), (nextZero % 12) + 1),
  };
}

/**
 * Make sure this month and next month exist, each cloned from the most recent month with bills.
 * Idempotent and cheap when both already exist (two indexed lookups). Never reaches further ahead.
 */
export async function ensureCurrentPeriods(today = todayIso()): Promise<void> {
  // Also the backfill for history imported before months followed transactions.
  await ensureDataPeriods();
  const ym = dateToYearMonth(today);
  if (!ym) return;
  const wanted = [ym, dateToYearMonth(monthBounds(ym.year, ym.month).end.slice(0, 8) + "01")!];
  const nextZero = ym.year * 12 + (ym.month - 1) + 1;
  wanted[1] = { year: Math.floor(nextZero / 12), month: (nextZero % 12) + 1 };
  for (const w of wanted) {
    const exists = await db
      .select({ id: periods.id })
      .from(periods)
      .where(and(eq(periods.year, w.year), eq(periods.month, w.month)))
      .limit(1);
    if (exists.length) continue;
    const template = await latestPeriodWithBills();
    if (template != null) await cloneInstances(template, w.year, w.month);
    else await ensurePeriod(w.year, w.month);
  }
}

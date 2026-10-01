import "server-only";
import type { CategoryRule } from "@/server/lib/categorize";
import { db } from "@/server/db";
import {
  periods,
  billInstances,
  transactions,
  accounts,
  importBatches,
  bills,
  billStatuses,
  paymentTypes,
  accountBalances,
  categoryMappings,
  categories,
  transferDismissals,
  suggestionDismissals,
  savingsGoals,
  goalContributions,
  paySchedule,
  cashAllocations,
  transactionSplits,
  budgets,
  budgetLines,
  projectionSnapshots,
  syncAccounts,
  syncEnrollments,
} from "@/server/db/schema";
import { alias } from "drizzle-orm/mysql-core";
import type { PayFrequency } from "@/constants/enums";
import { round2, paydaysInMonth, type DebtInput } from "@/server/lib/budget";
import { projectCash, type CashProjection, type MonthSegment, type ProjectionPending, type ProjectionTrend } from "@/server/lib/cash-projection";
import { isPayrollDescription, type ObservedDeposit } from "@/server/lib/payday-reconcile";
import {
  and,
  eq,
  desc,
  asc,
  like,
  sql,
  isNull,
  or,
  inArray,
  notInArray,
  lte,
  gte,
  gt,
  type SQL,
} from "drizzle-orm";
import {
  STATUS_DEFAULTS,
  PAYMENT_TYPE_DEFAULTS,
  CASH_ACCOUNT_TYPES,
  LIABILITY_ACCOUNT_TYPES,
  WALLET_ACCOUNT_TYPES,
  BUDGET_EXCLUDED_CATEGORIES,
  CASH_SOURCE_CATEGORY,
  SAVINGS_CATEGORY,
} from "@/constants/enums";
import { effectiveHeld } from "@/server/lib/cash";
import { monthBounds, parsePeriodLabel } from "@/server/lib/period";
import { clampToMonth, todayIso, resolvePaydays, isoToUtc, utcToIso } from "@/server/lib/pay-schedule";
import { toNum } from "@/server/lib/money";
import { normalizeMerchant } from "@/server/lib/merchant";
import { requireSession } from "@/server/auth/session";

export async function getPeriods() {
  await requireSession();
  return db.select().from(periods).orderBy(desc(periods.year), desc(periods.month));
}

export async function getPeriodByLabel(label: string) {
  await requireSession();
  const rows = await db.select().from(periods).where(eq(periods.label, label)).limit(1);
  return rows[0] ?? null;
}

export async function getLatestPeriod() {
  await requireSession();
  const rows = await db
    .select()
    .from(periods)
    .orderBy(desc(periods.year), desc(periods.month))
    .limit(1);
  return rows[0] ?? null;
}

export async function getInstances(periodId: number) {
  await requireSession();
  return db
    .select()
    .from(billInstances)
    .where(eq(billInstances.periodId, periodId))
    .orderBy(asc(billInstances.sortOrder), asc(billInstances.id));
}

export async function getAllInstancesWithPeriod() {
  await requireSession();
  return db
    .select({
      id: billInstances.id,
      periodId: billInstances.periodId,
      label: periods.label,
      year: periods.year,
      month: periods.month,
      billId: billInstances.billId,
      name: billInstances.name,
      amount: billInstances.amount,
      status: billInstances.status,
      isDebt: billInstances.isDebt,
      paymentType: billInstances.paymentType,
      dueDay: billInstances.dueDay,
    })
    .from(billInstances)
    .innerJoin(periods, eq(periods.id, billInstances.periodId))
    .orderBy(desc(periods.year), desc(periods.month));
}

// ---- Config (customizable colors + emoji) ----
export interface StatusConfig {
  name: string;
  color: string;
  isSettled: boolean;
  emoji: string | null;
}
export async function getStatusConfig(): Promise<StatusConfig[]> {
  await requireSession();
  const rows = await db.select().from(billStatuses).orderBy(asc(billStatuses.sortOrder));
  if (!rows.length)
    return STATUS_DEFAULTS.map((s) => ({
      name: s.name,
      color: s.color,
      isSettled: s.isSettled,
      emoji: s.emoji ?? null,
    }));
  return rows.map((r) => ({ name: r.name, color: r.color, isSettled: r.isSettled, emoji: r.emoji }));
}
export async function getStatusRows() {
  await requireSession();
  return db.select().from(billStatuses).orderBy(asc(billStatuses.sortOrder));
}
export async function getPaymentTypeConfig(): Promise<
  { name: string; color: string; emoji: string | null }[]
> {
  await requireSession();
  const rows = await db.select().from(paymentTypes).orderBy(asc(paymentTypes.sortOrder));
  if (!rows.length) return PAYMENT_TYPE_DEFAULTS.map((p) => ({ ...p, emoji: p.emoji ?? null }));
  return rows.map((r) => ({ name: r.name, color: r.color, emoji: r.emoji }));
}
export async function getPaymentTypeRows() {
  await requireSession();
  return db.select().from(paymentTypes).orderBy(asc(paymentTypes.sortOrder));
}

// ---- Bills ----
export async function getBills() {
  await requireSession();
  return db.select().from(bills).orderBy(asc(bills.name));
}
export async function getBillNames() {
  await requireSession();
  return db.select({ id: bills.id, name: bills.name }).from(bills).orderBy(asc(bills.name));
}
export async function getBillById(id: number) {
  await requireSession();
  const rows = await db.select().from(bills).where(eq(bills.id, id)).limit(1);
  return rows[0] ?? null;
}
export async function getBillHistory(billId: number) {
  await requireSession();
  return db
    .select({
      instanceId: billInstances.id,
      periodId: billInstances.periodId,
      label: periods.label,
      year: periods.year,
      month: periods.month,
      name: billInstances.name,
      amount: billInstances.amount,
      status: billInstances.status,
      dueDay: billInstances.dueDay,
      paymentType: billInstances.paymentType,
      isDebt: billInstances.isDebt,
    })
    .from(billInstances)
    .innerJoin(periods, eq(periods.id, billInstances.periodId))
    .where(eq(billInstances.billId, billId))
    .orderBy(desc(periods.year), desc(periods.month));
}

// Every transaction attributed to a bill (via the durable bill link), newest
// first, with the month it was recorded against so the bill page can show what
// was matched — and unlink the ones that weren't really this bill.
export async function getBillTransactions(billId: number) {
  await requireSession();
  return db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      amount: transactions.amount,
      direction: transactions.direction,
      accountNumber: accounts.accountNumber,
      accountLabel: accounts.label,
      billInstanceId: transactions.billInstanceId,
      periodLabel: periods.label,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .where(eq(transactions.billId, billId))
    .orderBy(desc(transactions.txnDate), desc(transactions.id));
}

// ---- Accounts + balances ----
export async function getAccountBalances() {
  await requireSession();
  return db.select().from(accountBalances).orderBy(desc(accountBalances.asOf), desc(accountBalances.id));
}
export async function getBalancesForAccount(accountId: number) {
  await requireSession();
  return db
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId))
    .orderBy(desc(accountBalances.asOf), desc(accountBalances.id));
}
// Which local accounts are fed by bank sync, and when each last synced. Keyed by local
// account id; an account mapped from two external accounts reports the latest.
export async function getAccountSyncInfo() {
  await requireSession();
  const rows = await db
    .select({
      accountId: syncAccounts.accountId,
      provider: syncEnrollments.provider,
      institution: syncEnrollments.institutionName,
      enabled: syncAccounts.enabled,
      lastSyncedAt: syncAccounts.lastSyncedAt,
      enrollmentStatus: syncEnrollments.status,
    })
    .from(syncAccounts)
    .innerJoin(syncEnrollments, eq(syncEnrollments.id, syncAccounts.enrollmentId));
  const map = new Map<number, { provider: string; institution: string | null; enabled: boolean; lastSyncedAt: Date | null; enrollmentStatus: string }>();
  for (const r of rows) {
    if (r.accountId == null) continue;
    const cur = map.get(r.accountId);
    if (!cur || (r.lastSyncedAt && (!cur.lastSyncedAt || r.lastSyncedAt > cur.lastSyncedAt))) {
      map.set(r.accountId, {
        provider: r.provider,
        institution: r.institution,
        enabled: r.enabled,
        lastSyncedAt: r.lastSyncedAt,
        enrollmentStatus: r.enrollmentStatus,
      });
    }
  }
  return map;
}

export async function getAccountUsageCounts() {
  await requireSession();
  return db
    .select({ accountId: transactions.accountId, c: sql<number>`COUNT(*)` })
    .from(transactions)
    .groupBy(transactions.accountId);
}

// Most recent transaction date per account (a proxy for "last imported").
export async function getAccountLastTxnDates() {
  await requireSession();
  const rows = await db
    .select({ accountId: transactions.accountId, last: sql<string>`MAX(${transactions.txnDate})` })
    .from(transactions)
    .groupBy(transactions.accountId);
  const map = new Map<number, string>();
  for (const r of rows) if (r.accountId != null && r.last) map.set(r.accountId, r.last as string);
  return map;
}

export async function getAccounts() {
  await requireSession();
  return db.select().from(accounts).orderBy(asc(accounts.accountNumber));
}

// Cash on hand per Checking/Savings account, as of a point in time.
// For each account, the latest recorded snapshot with as_of <= asOf (defaults to "now",
// i.e. all snapshots) — so past months reflect the balance recorded back then. balance is
// null when no snapshot exists on or before that date.
export async function getCashOnHand(asOf?: string) {
  await requireSession();
  const accts = await db
    .select({
      id: accounts.id,
      label: accounts.label,
      accountNumber: accounts.accountNumber,
      accountType: accounts.accountType,
    })
    .from(accounts)
    .where(inArray(accounts.accountType, [...CASH_ACCOUNT_TYPES]))
    .orderBy(asc(accounts.accountType), asc(accounts.accountNumber));
  if (!accts.length) return [];

  const conds: SQL[] = [inArray(accountBalances.accountId, accts.map((a) => a.id))];
  if (asOf) conds.push(lte(accountBalances.asOf, asOf));
  const balRows = await db
    .select({
      accountId: accountBalances.accountId,
      balance: accountBalances.balance,
      asOf: accountBalances.asOf,
    })
    .from(accountBalances)
    .where(and(...conds))
    .orderBy(desc(accountBalances.asOf), desc(accountBalances.id));

  // Rows are newest-first, so the first one seen per account is the latest snapshot.
  const latest = new Map<number, { balance: string; asOf: string }>();
  for (const b of balRows) {
    if (!latest.has(b.accountId)) latest.set(b.accountId, { balance: b.balance, asOf: b.asOf });
  }

  return accts.map((a) => ({
    id: a.id,
    label: a.label,
    accountNumber: a.accountNumber,
    accountType: a.accountType,
    balance: latest.get(a.id)?.balance ?? null,
    asOf: latest.get(a.id)?.asOf ?? null,
  }));
}

export interface RolledCashAccount {
  id: number;
  label: string | null;
  accountNumber: string;
  accountType: string | null;
  /** The latest recorded balance ≤ `asOf`, and the day it was recorded. */
  balance: number | null;
  recordedOn: string | null;
  /** Signed transactions since `recordedOn` — what the balance hasn't been told about yet. */
  adjustment: number;
  txnCount: number;
  /** balance + adjustment. */
  rolled: number | null;
  /** Its balance predates `asOf`, so part of this figure is inferred, not measured. */
  stale: boolean;
  /** A hand-counted wallet: never rolled forward (see the note below). */
  wallet: boolean;
}

export interface RolledCash {
  asOf: string;
  /** Σ of each account's latest snapshot — the raw figure, mixing vintages. */
  snapshotTotal: number | null;
  /** Σ snapshot + each account's own since-then transactions. The number to project from. */
  total: number | null;
  /** total − snapshotTotal: how much of the anchor is inferred rather than recorded. */
  drift: number;
  /** The oldest snapshot behind a non-zero balance — the anchor's true vintage. */
  oldestRecordedOn: string | null;
  accounts: RolledCashAccount[];
}

/**
 * Cash on hand at `asOf`, with each account's balance rolled forward over the transactions it
 * hasn't been told about yet.
 *
 * Why this is needed: balances are recorded per account, on whatever day each was checked, and
 * `getCashOnHand` sums whatever each one last said. So "cash as of the 28th" can be the 28th for
 * checking, the 23rd for brokerage and the 8th for savings — and every transaction after each of
 * those dates is simply missing. Anchoring a projection on that sum silently drops known money
 * in both directions: an anchor on the 20th can hold a paycheck half that an account's balance
 * recorded on the 8th has never seen, while the schedule went on to add the whole payday on top of it.
 *
 * PENDING rows count. A hand-entered placeholder for a payment that hasn't posted is money
 * already committed; leaving it out is what makes a balance look better than the account is.
 * (A pending hold the recorded balance ALREADY reflects is dated at or before that balance, so
 * it falls outside the roll-forward window and is never subtracted twice.)
 *
 * WALLET accounts are never rolled. A withdrawal is a Debit on the bank account and the wallet
 * gets no matching Credit (cash-offsets.md), so rolling a wallet forward would subtract its
 * purchases without ever adding the cash that funded them. Wallets are counted by hand instead;
 * `stale` still flags one that hasn't been counted lately.
 */
export async function getRolledCashOnHand(asOf: string): Promise<RolledCash> {
  await requireSession();
  const snaps = await getCashOnHand(asOf);
  if (!snaps.length) return { asOf, snapshotTotal: null, total: null, drift: 0, oldestRecordedOn: null, accounts: [] };

  // One grouped pass: net movement per account strictly after ITS OWN balance date, through asOf.
  const isWallet = (t: string | null) => t != null && WALLET_ACCOUNT_TYPES.includes(t);
  const rollable = snaps.filter((a) => !isWallet(a.accountType) && a.asOf != null);
  const signed = sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Credit' THEN ${transactions.amount} ELSE -${transactions.amount} END), 0)`;
  const moves = rollable.length
    ? await db
        .select({ accountId: transactions.accountId, net: signed, n: sql<number>`COUNT(*)` })
        .from(transactions)
        .where(
          and(
            lte(transactions.txnDate, asOf),
            or(...rollable.map((a) => and(eq(transactions.accountId, a.id), gt(transactions.txnDate, a.asOf!)))),
          ),
        )
        .groupBy(transactions.accountId)
    : [];
  const moveBy = new Map(moves.map((m) => [m.accountId, { net: toNum(m.net) ?? 0, n: Number(m.n ?? 0) }]));

  const accts: RolledCashAccount[] = snaps.map((a) => {
    const wallet = isWallet(a.accountType);
    const balance = toNum(a.balance);
    const m = wallet ? undefined : moveBy.get(a.id);
    const adjustment = round2(m?.net ?? 0);
    return {
      id: a.id,
      label: a.label,
      accountNumber: a.accountNumber,
      accountType: a.accountType,
      balance,
      recordedOn: a.asOf,
      adjustment,
      txnCount: m?.n ?? 0,
      rolled: balance == null ? null : round2(balance + adjustment),
      stale: a.asOf != null && a.asOf < asOf,
      wallet,
    };
  });

  const any = accts.some((a) => a.balance != null);
  const oldest = accts
    .filter((a) => a.balance != null && a.balance !== 0 && a.recordedOn)
    .reduce<string | null>((m, a) => (!m || a.recordedOn! < m ? a.recordedOn! : m), null);
  const snapshotTotal = any ? round2(accts.reduce((s, a) => s + (a.balance ?? 0), 0)) : null;
  const total = any ? round2(accts.reduce((s, a) => s + (a.rolled ?? 0), 0)) : null;
  return {
    asOf,
    snapshotTotal,
    total,
    drift: round2((total ?? 0) - (snapshotTotal ?? 0)),
    oldestRecordedOn: oldest,
    accounts: accts,
  };
}

// ---- Liabilities (Credit + Loan accounts) — the single owed-balance ledger ----
// Credit cards and loans are just accounts; their owed balance/APR/min-payment/limit live in
// the same account_balances ledger as cash. The "Debts" screen and the dashboard's credit/debt
// cards are both lenses over exactly these rows — so a balance is recorded in ONE place.

export interface LiabilityAccountRow {
  id: number; // account id
  accountNumber: string;
  label: string | null;
  institution: string | null;
  accountType: string; // "Credit" | "Loan"
  billId: number | null; // linked recurring bill (payment attribution), if any
  originalPrincipal: string | null;
  openedOn: string | null;
  notes: string | null;
  active: boolean;
  // Latest snapshot ≤ asOf. creditLimit / apr / minPayment carry forward from the freshest
  // non-null snapshot (they change rarely), so an omitted value doesn't blank the display.
  balance: string | null;
  creditLimit: string | null;
  apr: string | null;
  minPayment: string | null;
  asOf: string | null;
}

// Every liability account with its standing as of a point in time (defaults to now). Mirrors
// getCashOnHand/getCreditStanding: for each account the most recent snapshot with as_of <= asOf,
// so a past month reads historically. balance is null when no snapshot exists on/before asOf.
export async function getLiabilityAccounts(asOf?: string): Promise<LiabilityAccountRow[]> {
  await requireSession();
  const accts = await db
    .select({
      id: accounts.id,
      accountNumber: accounts.accountNumber,
      label: accounts.label,
      institution: accounts.institution,
      accountType: accounts.accountType,
      billId: accounts.billId,
      originalPrincipal: accounts.originalPrincipal,
      openedOn: accounts.openedOn,
      notes: accounts.notes,
      active: accounts.active,
    })
    .from(accounts)
    .where(inArray(accounts.accountType, [...LIABILITY_ACCOUNT_TYPES]))
    .orderBy(asc(accounts.accountType), asc(accounts.label), asc(accounts.accountNumber));
  if (!accts.length) return [];

  const conds: SQL[] = [inArray(accountBalances.accountId, accts.map((a) => a.id))];
  if (asOf) conds.push(lte(accountBalances.asOf, asOf));
  const rows = await db
    .select({
      accountId: accountBalances.accountId,
      balance: accountBalances.balance,
      creditLimit: accountBalances.creditLimit,
      apr: accountBalances.apr,
      minPayment: accountBalances.minPayment,
      asOf: accountBalances.asOf,
    })
    .from(accountBalances)
    .where(and(...conds))
    .orderBy(desc(accountBalances.asOf), desc(accountBalances.id));

  // Newest-first: first row per account is the latest snapshot; carry forward the freshest
  // known limit / APR / min payment onto it when a later snapshot omitted them.
  const latest = new Map<
    number,
    { balance: string; creditLimit: string | null; apr: string | null; minPayment: string | null; asOf: string }
  >();
  const limCarry = new Map<number, string>();
  const aprCarry = new Map<number, string>();
  const minCarry = new Map<number, string>();
  for (const r of rows) {
    if (!latest.has(r.accountId))
      latest.set(r.accountId, {
        balance: r.balance,
        creditLimit: r.creditLimit,
        apr: r.apr,
        minPayment: r.minPayment,
        asOf: r.asOf,
      });
    if (r.creditLimit != null && !limCarry.has(r.accountId)) limCarry.set(r.accountId, r.creditLimit);
    if (r.apr != null && !aprCarry.has(r.accountId)) aprCarry.set(r.accountId, r.apr);
    if (r.minPayment != null && !minCarry.has(r.accountId)) minCarry.set(r.accountId, r.minPayment);
  }
  for (const [id, v] of latest) {
    if (v.creditLimit == null && limCarry.has(id)) v.creditLimit = limCarry.get(id)!;
    if (v.apr == null && aprCarry.has(id)) v.apr = aprCarry.get(id)!;
    if (v.minPayment == null && minCarry.has(id)) v.minPayment = minCarry.get(id)!;
  }

  return accts.map((a) => {
    const l = latest.get(a.id);
    return {
      id: a.id,
      accountNumber: a.accountNumber,
      label: a.label,
      institution: a.institution,
      accountType: a.accountType ?? "",
      billId: a.billId,
      originalPrincipal: a.originalPrincipal,
      openedOn: a.openedOn,
      notes: a.notes,
      active: !!a.active,
      balance: l?.balance ?? null,
      creditLimit: l?.creditLimit ?? null,
      apr: l?.apr ?? null,
      minPayment: l?.minPayment ?? null,
      asOf: l?.asOf ?? null,
    };
  });
}

// Full balance ledger for every liability account (newest first), grouped by accountId in the
// page — the history table on /debts.
export async function getLiabilityLedger() {
  await requireSession();
  const liab = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.accountType, [...LIABILITY_ACCOUNT_TYPES]));
  if (!liab.length) return [];
  return db
    .select()
    .from(accountBalances)
    .where(inArray(accountBalances.accountId, liab.map((a) => a.id)))
    .orderBy(desc(accountBalances.asOf), desc(accountBalances.id));
}

// ---- Balance trends (for the dashboard sparklines) ----
export interface BalanceTrendPoint {
  label: string; // period label, e.g. "2025-01"
  year: number;
  month: number;
  cash: number | null; // checking + savings; null when no snapshot on/before month-end
  credit: number | null; // credit cards owed
  loans: number | null; // loans outstanding
}

// Per-month totals for cash on hand, credit owed, and loans outstanding — each computed "as of"
// that month's end (the latest snapshot ≤ month-end per account, summed by type), exactly like the
// dashboard's standing cards but across every tracked month. Powers the trend sparklines. A
// category is null for a month when no snapshot exists on/before that month's end (leading gap).
export async function getBalanceTrends(): Promise<BalanceTrendPoint[]> {
  await requireSession();
  const [periodRows, acctRows, balRows] = await Promise.all([
    db
      .select({ label: periods.label, year: periods.year, month: periods.month })
      .from(periods)
      .orderBy(asc(periods.year), asc(periods.month)),
    db.select({ id: accounts.id, accountType: accounts.accountType }).from(accounts),
    db
      .select({
        accountId: accountBalances.accountId,
        balance: accountBalances.balance,
        asOf: accountBalances.asOf,
      })
      .from(accountBalances)
      .orderBy(asc(accountBalances.asOf), asc(accountBalances.id)),
  ]);

  const typeOf = new Map(acctRows.map((a) => [a.id, a.accountType ?? ""]));

  // Snapshots per account, ascending by as_of (the query is globally as_of-ascending).
  const byAccount = new Map<number, { asOf: string; balance: number }[]>();
  for (const b of balRows) {
    const n = toNum(b.balance);
    if (n == null) continue;
    const arr = byAccount.get(b.accountId);
    if (arr) arr.push({ asOf: b.asOf, balance: n });
    else byAccount.set(b.accountId, [{ asOf: b.asOf, balance: n }]);
  }

  return periodRows.map((p) => {
    const end = monthBounds(p.year, p.month).end; // YYYY-MM-DD → lexically comparable
    let cash: number | null = null;
    let credit: number | null = null;
    let loans: number | null = null;
    for (const [accountId, snaps] of byAccount) {
      // Latest snapshot with as_of ≤ month-end (ascending, so the last match before we break).
      let bal: number | null = null;
      for (const s of snaps) {
        if (s.asOf <= end) bal = s.balance;
        else break;
      }
      if (bal == null) continue;
      const t = typeOf.get(accountId) ?? "";
      if (CASH_ACCOUNT_TYPES.includes(t)) cash = (cash ?? 0) + bal;
      else if (t === "Credit") credit = (credit ?? 0) + bal;
      else if (t === "Loan") loans = (loans ?? 0) + Math.max(0, bal);
    }
    return { label: p.label, year: p.year, month: p.month, cash, credit, loans };
  });
}

// Payments attributed to each liability account via its linked bill (transaction → bill_instance
// → bill = accounts.bill_id; debits only — money paid toward it). Keyed by accountId.
export async function getLiabilityPaymentTotals() {
  await requireSession();
  const rows = await db
    .select({
      accountId: accounts.id,
      count: sql<number>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .innerJoin(billInstances, eq(billInstances.id, transactions.billInstanceId))
    .innerJoin(accounts, eq(accounts.billId, billInstances.billId))
    .where(eq(transactions.direction, "Debit"))
    .groupBy(accounts.id);
  const map = new Map<number, { count: number; total: number }>();
  for (const r of rows)
    if (r.accountId != null) map.set(r.accountId, { count: Number(r.count), total: Number(r.total) });
  return map;
}

// Free-text search spans the bank's description AND the user's own note, so a
// charge can be found by what it actually was ("vet visit") and not only by the
// merchant string the card network supplied.
function txSearchCond(search: string): SQL {
  return or(
    like(transactions.description, `%${search}%`),
    like(transactions.notes, `%${search}%`),
  ) as SQL;
}

export interface TxFilters {
  periodLabel?: string;
  accountId?: number;
  category?: string;
  direction?: string;
  search?: string;
  limit?: number;
}

export async function getTransactions(filters: TxFilters = {}) {
  await requireSession();
  const conds: SQL[] = [];
  if (filters.periodLabel) conds.push(eq(periods.label, filters.periodLabel));
  if (filters.accountId) conds.push(eq(transactions.accountId, filters.accountId));
  // A row with a split part in the category matches too, same as getTransactionsPage.
  if (filters.category)
    conds.push(
      or(
        eq(transactions.category, filters.category),
        sql`EXISTS (SELECT 1 FROM ${transactionSplits} WHERE ${transactionSplits.txnId} = ${transactions.id} AND ${transactionSplits.category} = ${filters.category})`,
      ) as SQL,
    );
  if (filters.direction) conds.push(eq(transactions.direction, filters.direction));
  if (filters.search) conds.push(txSearchCond(filters.search));

  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      notes: transactions.notes,
      category: transactions.category,
      categoryRuleId: transactions.categoryRuleId,
      amount: transactions.amount,
      netAmount: transactions.netAmount,
      direction: transactions.direction,
      accountId: transactions.accountId,
      accountNumber: accounts.accountNumber,
      accountLabel: accounts.label,
      accountType: accounts.accountType,
      periodLabel: periods.label,
      pending: transactions.pending,
      source: transactions.source,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(filters.limit ?? 500);
  // Split parts, so every list of transactions can show (and edit) them.
  const pieces = await getSplitsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, splits: pieces.get(r.id) ?? [] }));
}

export async function getDistinctTxCategories() {
  await requireSession();
  const rows = await db
    .selectDistinct({ category: transactions.category })
    .from(transactions);
  return rows.map((r) => r.category).filter((c): c is string => !!c).sort();
}

const txnSummaryCols = {
  id: transactions.id,
  txnDate: transactions.txnDate,
  description: transactions.description,
  category: transactions.category,
  amount: transactions.amount,
  direction: transactions.direction,
  pending: transactions.pending,
};
export type TxnSummary = {
  id: number;
  txnDate: string;
  description: string;
  category: string | null;
  amount: string;
  direction: string;
  pending?: boolean;
  // Only set by getTopTransactions: the row's face value, when it differs from `amount`
  // because cash purchases have been accounted for out of it.
  grossAmount?: string | null;
};

// Largest transactions (by amount magnitude) for a month.
// Transfers aren't real spending/income, so exclude them from these buckets.
const notTransferCond = sql`(${transactions.category} IS NULL OR ${transactions.category} <> 'Transfer')`;

// Highest money OUT (debits) for the month. Ranked and shown by UNACCOUNTED amount, so a
// $300 withdrawal whose purchases are all logged doesn't sit at the top of "highest spending"
// claiming money that's already listed under Gas and Groceries. Fully accounted-for
// withdrawals drop off the list entirely.
export async function getTopTransactions(periodLabel: string, limit = 5) {
  await requireSession();
  const wa = allocatedByWithdrawal();
  const eff = unaccountedAmount(wa);
  return db
    .select({
      ...txnSummaryCols,
      amount: sql<string>`${eff}`,
      grossAmount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(wa, eq(wa.txnId, transactions.id))
    .where(
      and(
        eq(periods.label, periodLabel),
        eq(transactions.direction, "Debit"),
        notTransferCond,
        sql`${eff} > 0`,
      ),
    )
    .orderBy(desc(eff), desc(transactions.id))
    .limit(limit);
}

// Highest money IN (credits / deposits) for the month.
export async function getTopDeposits(periodLabel: string, limit = 5) {
  await requireSession();
  return db
    .select(txnSummaryCols)
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .where(and(eq(periods.label, periodLabel), eq(transactions.direction, "Credit"), notTransferCond))
    .orderBy(desc(transactions.amount), desc(transactions.id))
    .limit(limit);
}

// Pending bank charges in a month: the chip on the dashboard. DB-only (bank-sync.md D11).
export async function getPendingSummary(periodLabel: string) {
  await requireSession();
  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      debits: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Debit' THEN ${transactions.amount} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .where(and(eq(periods.label, periodLabel), eq(transactions.pending, true)));
  return { count: Number(row?.count ?? 0), debits: Number(row?.debits ?? 0) };
}

// Most recent transactions (by date) for a month.
export async function getRecentTransactions(periodLabel: string, limit = 5) {
  await requireSession();
  return db
    .select(txnSummaryCols)
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .where(eq(periods.label, periodLabel))
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(limit);
}

export interface TxQuery {
  periodLabels?: string[];
  accountIds?: number[];
  categories?: string[];
  direction?: string;
  search?: string;
  uncategorized?: boolean;
  /** Only transactions still marked pending (entered before the bank posted them). */
  pending?: boolean;
  sort?: string; // date | amount | description | category | account | direction
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

function txSortColumn(sort?: string) {
  switch (sort) {
    case "amount":
      return transactions.amount;
    case "description":
      return transactions.description;
    case "category":
      return transactions.category;
    case "account":
      return accounts.accountNumber;
    case "direction":
      return transactions.direction;
    default:
      return transactions.txnDate;
  }
}

export async function getTransactionsPage(q: TxQuery) {
  await requireSession();
  const conds: SQL[] = [];
  if (q.periodLabels?.length) conds.push(inArray(periods.label, q.periodLabels));
  if (q.accountIds?.length) conds.push(inArray(transactions.accountId, q.accountIds));
  if (q.direction) conds.push(eq(transactions.direction, q.direction));
  if (q.search) conds.push(txSearchCond(q.search));
  if (q.pending) conds.push(eq(transactions.pending, true));

  // Category filters look at a row's own category AND its split pieces: filtering to
  // Household should find the $40 carved out of a Groceries run. `ownCat` matches the row's
  // own category; `pieceCat` matches a piece (never, for "uncategorized" — pieces always
  // carry a category).
  const ownCatConds: SQL[] = [];
  if (q.categories?.length) ownCatConds.push(inArray(transactions.category, q.categories));
  if (q.uncategorized)
    ownCatConds.push(or(isNull(transactions.category), eq(transactions.category, "")) as SQL);
  const byCategory = ownCatConds.length > 0;
  const ownCat = byCategory ? and(...ownCatConds)! : undefined;
  const pieceCat =
    q.categories?.length && !q.uncategorized
      ? inArray(transactionSplits.category, q.categories)
      : undefined;
  // Everything but the category filter — what a matching piece's row must still satisfy.
  const baseConds = [...conds];
  if (ownCat) {
    conds.push(
      pieceCat
        ? (or(
            ownCat,
            sql`EXISTS (SELECT 1 FROM ${transactionSplits} WHERE ${transactionSplits.txnId} = ${transactions.id} AND ${pieceCat})`,
          ) as SQL)
        : ownCat,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 500);
  const page = Math.max(q.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  const dirFn = q.dir === "asc" ? asc : desc;
  const sortCol = txSortColumn(q.sort);

  // Count + signed totals over the WHOLE filtered set (not just the current page),
  // so the UI can show what the active filter sums to. Uses amount + direction
  // (amount is always the positive magnitude) rather than net_amount.
  // Cash withdrawals contribute only their unaccounted remainder, so filtering to a month
  // doesn't show the same cash twice (once as the ATM row, once as what it bought).
  // Under a category filter a split row only counts for the part in that category: its own
  // share when its own category matches, plus each matching piece.
  const waTotals = allocatedByWithdrawal();
  const stTotals = splitByTxn();
  const effTotals = byCategory
    ? sql`CASE WHEN ${ownCat} THEN ${ownShare(waTotals, stTotals)} ELSE 0 END`
    : unaccountedAmount(waTotals);
  const totalRow = await db
    .select({
      total: sql<number>`COUNT(*)`,
      debit: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Debit' THEN ${effTotals} ELSE 0 END), 0)`,
      credit: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Credit' THEN ${effTotals} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(waTotals, eq(waTotals.txnId, transactions.id))
    .leftJoin(stTotals, eq(stTotals.txnId, transactions.id))
    .where(where);
  const total = Number(totalRow[0]?.total ?? 0);
  let sumDebit = Number(totalRow[0]?.debit ?? 0);
  let sumCredit = Number(totalRow[0]?.credit ?? 0);
  if (pieceCat) {
    const [pieces] = await db
      .select({
        debit: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Debit' THEN ${pieceShare(waTotals, stTotals)} ELSE 0 END), 0)`,
        credit: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'Credit' THEN ${pieceShare(waTotals, stTotals)} ELSE 0 END), 0)`,
      })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.txnId))
      .leftJoin(waTotals, eq(waTotals.txnId, transactions.id))
      .leftJoin(stTotals, eq(stTotals.txnId, transactions.id))
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(periods, eq(periods.id, transactions.periodId))
      .where(and(pieceCat, ...baseConds));
    sumDebit = round2(sumDebit + Number(pieces?.debit ?? 0));
    sumCredit = round2(sumCredit + Number(pieces?.credit ?? 0));
  }
  const sumNet = sumCredit - sumDebit;

  const wa = allocatedByWithdrawal();
  const cs = coveredBySpend();
  const st = splitByTxn();
  const baseRows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      notes: transactions.notes,
      category: transactions.category,
      categoryRuleId: transactions.categoryRuleId,
      amount: transactions.amount,
      netAmount: transactions.netAmount,
      direction: transactions.direction,
      accountId: transactions.accountId,
      accountNumber: accounts.accountNumber,
      accountLabel: accounts.label,
      periodLabel: periods.label,
      billId: transactions.billId,
      accountType: accounts.accountType,
      pending: transactions.pending,
      source: transactions.source,
      // Cash bookkeeping, null on the vast majority of rows: how much of this withdrawal has
      // been tied to purchases, and how much of this wallet purchase has been funded.
      allocated: sql<string | null>`${wa.allocated}`,
      covered: sql<string | null>`${cs.covered}`,
      // How much has been split off into other categories (null when it isn't split).
      split: sql<string | null>`${st.split}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(wa, eq(wa.txnId, transactions.id))
    .leftJoin(cs, eq(cs.txnId, transactions.id))
    .leftJoin(st, eq(st.txnId, transactions.id))
    .where(where)
    .orderBy(dirFn(sortCol), desc(transactions.id))
    .limit(pageSize)
    .offset(offset);

  // The pieces themselves, only for the split rows on this page.
  const splitIds = baseRows.filter((r) => r.split != null).map((r) => r.id);
  const pieces = splitIds.length ? await getSplitsFor(splitIds) : new Map<number, SplitPiece[]>();
  const rows = baseRows.map((r) => ({ ...r, splits: pieces.get(r.id) ?? [] }));

  return {
    rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    sumDebit,
    sumCredit,
    sumNet,
  };
}

// Pending transactions and the posted rows they most likely became. See src/server/pending.ts.
export async function getPendingReview() {
  await requireSession();
  const { getPendingReview: load } = await import("@/server/pending");
  return load();
}

export async function getTransfersData(periodLabel?: string) {
  await requireSession();
  const { detectTransfers } = await import("@/server/lib/transfers");
  const [rows, dismissedRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountNumber: accounts.accountNumber,
        accountLabel: accounts.label,
        date: transactions.txnDate,
        description: transactions.description,
        amount: transactions.amount,
        direction: transactions.direction,
        category: transactions.category,
        partnerId: transactions.transferPartnerId,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      // Pending rows are excluded from pairing until they post (bank-sync.md D2).
      .where(eq(transactions.pending, false)),
    db.select().from(transferDismissals),
  ]);
  const lite = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    account: r.accountLabel ?? r.accountNumber ?? "—",
    date: r.date,
    description: r.description,
    amount: Number(r.amount),
    direction: r.direction,
    category: r.category,
    partnerId: r.partnerId,
  }));
  const dismissed = new Set(dismissedRows.map((d) => `${d.lowId}-${d.highId}`));
  const data = detectTransfers(lite, { dismissed });

  // Detection runs over ALL transactions (so counterparts in adjacent months are found);
  // optionally filter the displayed groups to those involving the selected month.
  if (periodLabel) {
    const inMonth = (iso: string) => iso.slice(0, 7) === periodLabel;
    data.suggestions = data.suggestions.filter(
      (s) => inMonth(s.debit.date) || inMonth(s.credit.date),
    );
    data.unmatched = data.unmatched.filter((u) => inMonth(u.txn.date));
    data.linked = data.linked.filter((p) => inMonth(p.a.date) || inMonth(p.b.date));
  }
  return data;
}

// ---- Cash offsets ------------------------------------------------------------------------
// Cash withdrawn from the bank and cash spent out of the wallet are THE SAME MONEY. The
// withdrawal row can't be edited down — it comes back on every statement import — so the
// `cash_allocations` ledger records which purchases it paid for, and rollups count the
// withdrawal only for the part never accounted for. See planning/features/cash-offsets.md.

// SUM of allocations per withdrawal, as a joinable derived table (MySQL 5.7 has no CTEs, so
// it's rebuilt per query). Transactions with no allocations join to NULL and COALESCE back to
// their face amount — this is a no-op for every ordinary row.
function allocatedByWithdrawal() {
  return db
    .select({
      txnId: cashAllocations.withdrawalTxnId,
      allocated: sql<string>`SUM(${cashAllocations.amount})`.as("allocated"),
    })
    .from(cashAllocations)
    .groupBy(cashAllocations.withdrawalTxnId)
    .as("wa");
}
type WithdrawalAllocSq = ReturnType<typeof allocatedByWithdrawal>;

// The same, per purchase: how much of a wallet spend has been funded by withdrawals.
function coveredBySpend() {
  return db
    .select({
      txnId: cashAllocations.spendTxnId,
      covered: sql<string>`SUM(${cashAllocations.amount})`.as("covered"),
    })
    .from(cashAllocations)
    .groupBy(cashAllocations.spendTxnId)
    .as("cs");
}

/**
 * What a transaction actually cost you: its face amount minus whatever has been accounted
 * for out of it. THE rule that keeps cash from being counted twice — every spend rollup uses
 * this instead of `transactions.amount`. For a $300 ATM withdrawal with $58 of purchases
 * logged against it, spending is $242: the cash that walked off unaccounted for.
 */
const unaccountedAmount = (wa: WithdrawalAllocSq) =>
  // GREATEST guards the arithmetic: allocations are trimmed whenever a transaction is edited,
  // but a rollup must never be able to go NEGATIVE and quietly subtract from real spending.
  sql`GREATEST(${transactions.amount} - COALESCE(${wa.allocated}, 0), 0)`;

// ---- Transaction splits ------------------------------------------------------------------
// Pieces of a transaction filed under other categories ($40 of a $100 Target run is
// Household). The pieces live in `transaction_splits`; the transaction's own category keeps
// the remainder. Rollups that group BY CATEGORY count the row for its own share and each piece
// under its piece category; rollups that don't care about category keep using the whole row,
// since the parts add back up to it. See planning/features/transaction-splits.md.

// SUM of split pieces per transaction, as a joinable derived table. Unsplit rows join to NULL.
function splitByTxn() {
  return db
    .select({
      txnId: transactionSplits.txnId,
      split: sql<string>`SUM(${transactionSplits.amount})`.as("split"),
      // The part of the split filed as Cash — cash back at a register, say. It's cash you
      // took out, so it behaves as a withdrawal (see cashPortion).
      cashSplit: sql<string>`SUM(CASE WHEN ${transactionSplits.category} = ${CASH_SOURCE_CATEGORY} THEN ${transactionSplits.amount} ELSE 0 END)`.as(
        "cash_split",
      ),
    })
    .from(transactionSplits)
    .groupBy(transactionSplits.txnId)
    .as("st");
}
type SplitSq = ReturnType<typeof splitByTxn>;

/**
 * How much of a transaction is cash you took out: its Cash split parts, plus its own share
 * when its own category is Cash. A plain ATM withdrawal is all cash; a $40 grocery run with
 * $20 cash back split off as Cash is $20 of cash. Cash offsets draw on exactly this amount.
 */
const cashPortion = (st: SplitSq) =>
  sql`(CASE WHEN ${transactions.category} = ${CASH_SOURCE_CATEGORY} THEN ${transactions.amount} - COALESCE(${st.split}, 0) ELSE 0 END + COALESCE(${st.cashSplit}, 0))`;

/**
 * What a transaction contributes to ITS OWN category: the amount minus whatever has been split
 * off into other categories, minus the cash offsets its Cash parts couldn't absorb. Offsets
 * come out of Cash split parts FIRST (see pieceShare) — the purchases were paid with the cash
 * back, not the groceries. Only for category-grouped rollups — everywhere else the parts are
 * still part of the row and `unaccountedAmount` is right.
 */
const ownShare = (wa: WithdrawalAllocSq, st: SplitSq) =>
  sql`GREATEST(${transactions.amount} - COALESCE(${st.split}, 0) - GREATEST(COALESCE(${wa.allocated}, 0) - COALESCE(${st.cashSplit}, 0), 0), 0)`;

/**
 * What one split part contributes to its category. Non-cash parts count in full; Cash parts
 * lose the cash offsets drawn against the row (shared pro rata when there's more than one
 * Cash part), so cash back that paid for logged wallet purchases isn't counted twice — the
 * same rule `unaccountedAmount` applies to a whole ATM withdrawal. Join `wa` and `st`.
 */
const pieceShare = (wa: WithdrawalAllocSq, st: SplitSq) =>
  sql`CASE WHEN ${transactionSplits.category} = ${CASH_SOURCE_CATEGORY} AND COALESCE(${st.cashSplit}, 0) > 0 THEN ${transactionSplits.amount} * GREATEST(${st.cashSplit} - COALESCE(${wa.allocated}, 0), 0) / ${st.cashSplit} ELSE ${transactionSplits.amount} END`;

// Transfers aren't spending; a split piece filed under Transfer is dropped the same way.
const pieceNotTransferCond = sql`${transactionSplits.category} <> 'Transfer'`;

export interface SplitPiece {
  id: number;
  category: string;
  amount: string;
}

// Split pieces for a set of transactions, oldest piece first.
export async function getSplitsFor(txnIds: number[]): Promise<Map<number, SplitPiece[]>> {
  await requireSession();
  const out = new Map<number, SplitPiece[]>();
  if (!txnIds.length) return out;
  const rows = await db
    .select({
      id: transactionSplits.id,
      txnId: transactionSplits.txnId,
      category: transactionSplits.category,
      amount: transactionSplits.amount,
    })
    .from(transactionSplits)
    .where(inArray(transactionSplits.txnId, txnIds))
    .orderBy(asc(transactionSplits.id));
  for (const r of rows) {
    const list = out.get(r.txnId) ?? [];
    list.push({ id: r.id, category: r.category, amount: r.amount });
    out.set(r.txnId, list);
  }
  return out;
}

// The wallet accounts (type "Cash") — hand-entered spending with no bank feed.
export async function getWalletAccounts() {
  await requireSession();
  return db
    .select({ id: accounts.id, label: accounts.label, accountNumber: accounts.accountNumber })
    .from(accounts)
    .where(inArray(accounts.accountType, [...WALLET_ACCOUNT_TYPES]))
    .orderBy(asc(accounts.accountNumber));
}

// A withdrawal lives on a REAL account (never the wallet — money moving inside the wallet
// isn't a withdrawal) and is a Debit with some cash in it: categorized "Cash", or with a part
// split off as Cash (cash back). Join `st` (splitByTxn) on the row.
function cashSourceConds(walletIds: number[], st: SplitSq): SQL[] {
  const conds: SQL[] = [
    eq(transactions.direction, "Debit"),
    or(
      eq(transactions.category, CASH_SOURCE_CATEGORY),
      sql`COALESCE(${st.cashSplit}, 0) > 0`,
    ) as SQL,
  ];
  if (walletIds.length)
    conds.push(
      or(isNull(transactions.accountId), notInArray(transactions.accountId, walletIds)) as SQL,
    );
  return conds;
}

export interface CashWithdrawalRow {
  id: number;
  txnDate: string;
  description: string;
  notes: string | null;
  accountLabel: string | null;
  periodLabel: string | null;
  amount: number;
  allocated: number;
  remaining: number;
}

export interface CashSpendRow {
  id: number;
  txnDate: string;
  description: string;
  notes: string | null;
  category: string | null;
  accountLabel: string | null;
  periodLabel: string | null;
  amount: number;
  covered: number;
  uncovered: number;
}

export interface CashAllocationRow {
  id: number;
  withdrawalTxnId: number;
  spendTxnId: number;
  amount: number;
}

// Cash sources in a date window, each with how much of it is still unaccounted for.
export async function getCashWithdrawals(opts: {
  from?: string;
  to?: string;
  onlyOpen?: boolean;
  limit?: number;
} = {}): Promise<CashWithdrawalRow[]> {
  await requireSession();
  const walletIds = (await getWalletAccounts()).map((a) => a.id);
  const wa = allocatedByWithdrawal();
  const st = splitByTxn();
  const conds = cashSourceConds(walletIds, st);
  if (opts.from) conds.push(gte(transactions.txnDate, opts.from));
  if (opts.to) conds.push(lte(transactions.txnDate, opts.to));

  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      notes: transactions.notes,
      accountLabel: sql<string | null>`COALESCE(${accounts.label}, ${accounts.accountNumber})`,
      periodLabel: periods.label,
      // The cash in it, not its face value — $20 of cash back on a $40 grocery run.
      amount: sql<string>`${cashPortion(st)}`,
      allocated: sql<string | null>`${wa.allocated}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(wa, eq(wa.txnId, transactions.id))
    .leftJoin(st, eq(st.txnId, transactions.id))
    .where(and(...conds))
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(opts.limit ?? 200);

  const mapped = rows.map((r) => {
    const amount = toNum(r.amount) ?? 0;
    const allocated = toNum(r.allocated) ?? 0;
    return {
      id: r.id,
      txnDate: r.txnDate,
      description: r.description,
      notes: r.notes,
      accountLabel: r.accountLabel,
      periodLabel: r.periodLabel,
      amount,
      allocated,
      // Rounded to cents so float noise can't leave a withdrawal "open" for $0.000001.
      remaining: Math.round((amount - allocated) * 100) / 100,
    };
  });
  return opts.onlyOpen ? mapped.filter((r) => r.remaining > 0) : mapped;
}

// Wallet purchases in a date window, each with how much of it has been funded.
export async function getWalletSpends(opts: {
  from?: string;
  to?: string;
  onlyUnfunded?: boolean;
  limit?: number;
} = {}): Promise<CashSpendRow[]> {
  await requireSession();
  const walletIds = (await getWalletAccounts()).map((a) => a.id);
  if (!walletIds.length) return [];
  const cs = coveredBySpend();
  const conds: SQL[] = [
    inArray(transactions.accountId, walletIds),
    eq(transactions.direction, "Debit"),
  ];
  if (opts.from) conds.push(gte(transactions.txnDate, opts.from));
  if (opts.to) conds.push(lte(transactions.txnDate, opts.to));

  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      notes: transactions.notes,
      category: transactions.category,
      accountLabel: sql<string | null>`COALESCE(${accounts.label}, ${accounts.accountNumber})`,
      periodLabel: periods.label,
      amount: transactions.amount,
      covered: sql<string | null>`${cs.covered}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(cs, eq(cs.txnId, transactions.id))
    .where(and(...conds))
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(opts.limit ?? 500);

  const mapped = rows.map((r) => {
    const amount = toNum(r.amount) ?? 0;
    const covered = toNum(r.covered) ?? 0;
    return {
      id: r.id,
      txnDate: r.txnDate,
      description: r.description,
      notes: r.notes,
      category: r.category,
      accountLabel: r.accountLabel,
      periodLabel: r.periodLabel,
      amount,
      covered,
      uncovered: Math.round((amount - covered) * 100) / 100,
    };
  });
  return opts.onlyUnfunded ? mapped.filter((r) => r.uncovered > 0) : mapped;
}

// Every allocation touching the given withdrawals or purchases, so a detail view can show
// both directions of the link without a query per row.
export async function getCashAllocations(opts: {
  withdrawalIds?: number[];
  spendIds?: number[];
}): Promise<CashAllocationRow[]> {
  await requireSession();
  const sides: SQL[] = [];
  if (opts.withdrawalIds?.length)
    sides.push(inArray(cashAllocations.withdrawalTxnId, opts.withdrawalIds));
  if (opts.spendIds?.length) sides.push(inArray(cashAllocations.spendTxnId, opts.spendIds));
  if (!sides.length) return [];
  const rows = await db
    .select({
      id: cashAllocations.id,
      withdrawalTxnId: cashAllocations.withdrawalTxnId,
      spendTxnId: cashAllocations.spendTxnId,
      amount: cashAllocations.amount,
    })
    .from(cashAllocations)
    .where(sides.length === 1 ? sides[0] : (or(...sides) as SQL));
  return rows.map((r) => ({ ...r, amount: toNum(r.amount) ?? 0 }));
}

// The purchases a single withdrawal paid for — what the expanded row on /transactions shows.
export async function getWithdrawalDetail(withdrawalId: number): Promise<{
  withdrawal: CashWithdrawalRow;
  spends: (CashSpendRow & { allocatedAmount: number })[];
} | null> {
  await requireSession();
  const wa = allocatedByWithdrawal();
  const st = splitByTxn();
  const [w] = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      notes: transactions.notes,
      accountLabel: sql<string | null>`COALESCE(${accounts.label}, ${accounts.accountNumber})`,
      periodLabel: periods.label,
      amount: transactions.amount,
      cash: sql<string>`${cashPortion(st)}`,
      allocated: sql<string | null>`${wa.allocated}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(wa, eq(wa.txnId, transactions.id))
    .leftJoin(st, eq(st.txnId, transactions.id))
    .where(eq(transactions.id, withdrawalId))
    .limit(1);
  if (!w) return null;

  const cs = coveredBySpend();
  const spendRows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      notes: transactions.notes,
      category: transactions.category,
      accountLabel: sql<string | null>`COALESCE(${accounts.label}, ${accounts.accountNumber})`,
      periodLabel: periods.label,
      amount: transactions.amount,
      covered: sql<string | null>`${cs.covered}`,
      allocatedAmount: cashAllocations.amount,
    })
    .from(cashAllocations)
    .innerJoin(transactions, eq(transactions.id, cashAllocations.spendTxnId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(cs, eq(cs.txnId, transactions.id))
    .where(eq(cashAllocations.withdrawalTxnId, withdrawalId))
    .orderBy(asc(transactions.txnDate), asc(transactions.id));

  // The cash in it. A row with no cash left (recategorized after it was offset) falls back to
  // its face value so its existing links still read sensibly.
  const amount = (toNum(w.cash) ?? 0) > 0 ? (toNum(w.cash) ?? 0) : (toNum(w.amount) ?? 0);
  const allocated = toNum(w.allocated) ?? 0;
  return {
    withdrawal: {
      id: w.id,
      txnDate: w.txnDate,
      description: w.description,
      notes: w.notes,
      accountLabel: w.accountLabel,
      periodLabel: w.periodLabel,
      amount,
      allocated,
      remaining: Math.round((amount - allocated) * 100) / 100,
    },
    spends: spendRows.map((r) => {
      const amt = toNum(r.amount) ?? 0;
      const covered = toNum(r.covered) ?? 0;
      return {
        id: r.id,
        txnDate: r.txnDate,
        description: r.description,
        notes: r.notes,
        category: r.category,
        accountLabel: r.accountLabel,
        periodLabel: r.periodLabel,
        amount: amt,
        covered,
        uncovered: Math.round((amt - covered) * 100) / 100,
        allocatedAmount: toNum(r.allocatedAmount) ?? 0,
      };
    }),
  };
}

// Withdrawals still holding unspent cash — the picker shown when entering a wallet purchase.
export async function getOpenWithdrawals(limit = 25): Promise<CashWithdrawalRow[]> {
  await requireSession();
  const { DEFAULT_LOOKBACK_DAYS } = await import("@/server/lib/cash");
  const since = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  return getCashWithdrawals({ from: since, onlyOpen: true, limit });
}

/**
 * Cash you're still holding, per month — the SECOND way a withdrawal gets explained.
 *
 * A withdrawal is money out of the bank, not necessarily money spent: some of it is still in
 * your pocket. That part is an asset, and counting it as spending too would have the same
 * $186 sitting on both sides of the books. The pocket balance is whatever was last COUNTED
 * (a manual `account_balances` snapshot on the wallet — nothing else can know), so the month's
 * real cash outflow is:
 *
 *     opening pocket + withdrawals − closing pocket
 *
 * and `delta` below is `closing − opening`, SIGNED, because it has to swing both ways for the
 * books to close:
 *   • positive — cash stayed in your pocket. Comes OFF this month's spending; it's an asset.
 *   • negative — you spent down cash you were already carrying. Goes ON to this month's
 *     spending WHEN no transaction already explains it. The month you carried it in, that cash
 *     was excluded from spending precisely because you still had it — so if a drawdown didn't
 *     come back here, the money would leave the books entirely. But a drawdown spent on a
 *     wallet purchase logged against an earlier month's withdrawal IS already explained, twice
 *     over; `effectiveHeld` nets that case out, and this raw delta must not be used alone.
 * Months with no count at all yield 0 and change nothing.
 */
export interface CashHeld {
  opening: number;
  closing: number;
  delta: number; // closing - opening, signed. Subtract it from the month's cash spending.
  countedOn: string | null; // date of the closing count, for "as of" labels
}

async function walletSnapshots(): Promise<{ balance: number; asOf: string; id: number }[]> {
  const wallets = await getWalletAccounts();
  if (!wallets.length) return [];
  const rows = await db
    .select({
      id: accountBalances.id,
      balance: accountBalances.balance,
      asOf: accountBalances.asOf,
    })
    .from(accountBalances)
    .where(
      inArray(
        accountBalances.accountId,
        wallets.map((w) => w.id),
      ),
    )
    .orderBy(asc(accountBalances.asOf), asc(accountBalances.id));
  return rows.map((r) => ({ id: r.id, balance: toNum(r.balance) ?? 0, asOf: r.asOf }));
}

// The latest count on or before `date` (null date = the latest of all).
function pocketAsOf(
  snaps: { balance: number; asOf: string }[],
  date?: string,
): { balance: number; asOf: string } | null {
  let best: { balance: number; asOf: string } | null = null;
  for (const s of snaps) {
    if (date && s.asOf > date) continue;
    best = s; // snapshots are ascending, so the last one that qualifies wins
  }
  return best;
}

// Unaccounted cash per month: the withdrawals' own remainders, after purchase offsets. This is
// the ceiling on how much a pocket count is allowed to explain — a pocket that grew from cash
// the app never saw (a gift, a side job) must not be allowed to subtract from other spending.
async function cashUnaccountedByPeriod(): Promise<Map<string, number>> {
  const walletIds = (await getWalletAccounts()).map((a) => a.id);
  const wa = allocatedByWithdrawal();
  const st = splitByTxn();
  const rows = await db
    .select({
      label: periods.label,
      total: sql<string>`COALESCE(SUM(GREATEST(${cashPortion(st)} - COALESCE(${wa.allocated}, 0), 0)), 0)`,
    })
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .leftJoin(wa, eq(wa.txnId, transactions.id))
    .leftJoin(st, eq(st.txnId, transactions.id))
    .where(and(...cashSourceConds(walletIds, st)))
    .groupBy(periods.label);
  return new Map(rows.map((r) => [r.label, toNum(r.total) ?? 0]));
}

/**
 * Wallet spending in a month that an EARLIER month's withdrawal paid for, per month — keyed by
 * the month the PURCHASE falls in. This is carried-in cash whose fate is already fully on the
 * books: the purchase sits in its own category here, and the allocation already took the same
 * money off the withdrawing month's Cash slice. A pocket drawdown covering it would charge the
 * month a second time, so `effectiveHeld` nets the two against each other.
 *
 * Only earlier-to-later counts. A purchase dated a day or two BEFORE the withdrawal that funded
 * it is posting lag, not carry-in — the pocket never held that cash across a month boundary.
 */
async function carryInFundedByPeriod(): Promise<Map<string, number>> {
  const w = alias(transactions, "cw");
  const s = alias(transactions, "cs");
  const pw = alias(periods, "cpw");
  const ps = alias(periods, "cps");
  const rows = await db
    .select({
      label: ps.label,
      total: sql<string>`COALESCE(SUM(${cashAllocations.amount}), 0)`,
    })
    .from(cashAllocations)
    .innerJoin(w, eq(w.id, cashAllocations.withdrawalTxnId))
    .innerJoin(s, eq(s.id, cashAllocations.spendTxnId))
    .innerJoin(pw, eq(pw.id, w.periodId))
    .innerJoin(ps, eq(ps.id, s.periodId))
    .where(sql`${pw.year} * 12 + ${pw.month} < ${ps.year} * 12 + ${ps.month}`)
    .groupBy(ps.label);
  return new Map(rows.map((r) => [r.label, toNum(r.total) ?? 0]));
}

/**
 * The pocket correction every rollup subtracts, per month. See `effectiveHeld` for the rules —
 * this only gathers the three figures it reconciles.
 */
async function effectiveHeldByPeriod(): Promise<Map<string, number>> {
  const [heldBy, unaccountedBy, carryInBy] = await Promise.all([
    getCashHeldByPeriod(),
    cashUnaccountedByPeriod(),
    carryInFundedByPeriod(),
  ]);
  const out = new Map<string, number>();
  for (const [label, h] of heldBy) {
    out.set(
      label,
      effectiveHeld(h.delta, unaccountedBy.get(label) ?? 0, carryInBy.get(label) ?? 0),
    );
  }
  return out;
}

/** Held cash for one month (or, with no label, across all history). */
export async function getCashHeld(periodLabel?: string): Promise<CashHeld> {
  await requireSession();
  const snaps = await walletSnapshots();
  const parsed = periodLabel ? parsePeriodLabel(periodLabel) : null;
  const bounds = parsed ? monthBounds(parsed.year, parsed.month) : null;
  // "Opening" is the last count strictly BEFORE the month — the pocket you carried in.
  const dayBefore = bounds
    ? new Date(Date.parse(bounds.start + "T00:00:00Z") - 86400000).toISOString().slice(0, 10)
    : undefined;
  const open = bounds ? pocketAsOf(snaps, dayBefore) : null;
  const close = pocketAsOf(snaps, bounds?.end);
  const opening = open?.balance ?? 0;
  const closing = close?.balance ?? 0;
  return {
    opening,
    closing,
    delta: Math.round((closing - opening) * 100) / 100,
    countedOn: close?.asOf ?? null,
  };
}

/** Held cash for every month at once — for the multi-month cash-flow chart. */
export async function getCashHeldByPeriod(): Promise<Map<string, CashHeld>> {
  await requireSession();
  const [snaps, allPeriods] = await Promise.all([walletSnapshots(), getPeriods()]);
  const out = new Map<string, CashHeld>();
  for (const p of allPeriods) {
    const { start, end } = monthBounds(p.year, p.month);
    const dayBefore = new Date(Date.parse(start + "T00:00:00Z") - 86400000)
      .toISOString()
      .slice(0, 10);
    const open = pocketAsOf(snaps, dayBefore);
    const close = pocketAsOf(snaps, end);
    const opening = open?.balance ?? 0;
    const closing = close?.balance ?? 0;
    out.set(p.label, {
      opening,
      closing,
      delta: Math.round((closing - opening) * 100) / 100,
      countedOn: close?.asOf ?? null,
    });
  }
  return out;
}

export interface CashOverview {
  withdrawals: CashWithdrawalRow[]; // in-month, plus recent carry-in still holding cash
  spends: CashSpendRow[];
  allocations: CashAllocationRow[];
  totals: {
    withdrawn: number; // face value of the month's cash sources
    accounted: number; // of that, tied to purchases (in ANY month)
    unaccounted: number; // of that, not tied to a purchase
    walletSpend: number; // purchases logged out of the wallet this month
    unfunded: number; // of those, not drawn from any withdrawal
    // The two ways unaccounted cash resolves: it's either still in your pocket…
    // Signed: negative means you spent down cash carried in, which ADDS to the month.
    held: number;
    // …or it's gone. This is the figure the dashboard counts as spending.
    unaccountedSpend: number; // max(unaccounted - held, 0)
  };
  pocket: CashHeld;
  carryInDays: number;
}

/**
 * Everything the /cash screen needs for one month. Withdrawals reach back before the month
 * starts (cash from Jul 30 is what you're spending on Aug 1), but the TOTALS only ever count
 * the selected month's own rows, so the numbers reconcile with that month's dashboard.
 */
export async function getCashOverview(periodLabel?: string): Promise<CashOverview> {
  await requireSession();
  const { DEFAULT_LOOKBACK_DAYS } = await import("@/server/lib/cash");
  const parsed = periodLabel ? parsePeriodLabel(periodLabel) : null;
  const bounds = parsed ? monthBounds(parsed.year, parsed.month) : null;
  const carryFrom = bounds
    ? new Date(Date.parse(bounds.start + "T00:00:00Z") - DEFAULT_LOOKBACK_DAYS * 86400000)
        .toISOString()
        .slice(0, 10)
    : undefined;

  const [withdrawals, spends] = await Promise.all([
    getCashWithdrawals({ from: carryFrom, to: bounds?.end }),
    getWalletSpends({ from: bounds?.start, to: bounds?.end }),
  ]);
  const allocations = await getCashAllocations({
    withdrawalIds: withdrawals.map((w) => w.id),
    spendIds: spends.map((s) => s.id),
  });

  // Carry-in withdrawals are context for linking, not this month's money — drop the ones
  // that predate the month AND have nothing left to give.
  const shown = bounds
    ? withdrawals.filter((w) => w.txnDate >= bounds.start || w.remaining > 0)
    : withdrawals;
  const inMonth = bounds ? shown.filter((w) => w.txnDate >= bounds.start) : shown;

  const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;
  const [pocket, carryInBy] = await Promise.all([
    getCashHeld(periodLabel),
    carryInFundedByPeriod(),
  ]);
  const unaccounted = sum(inMonth.map((w) => w.remaining));
  // Reconciled exactly the way the dashboard reconciles it, so the two screens agree to the
  // cent. With no month selected there is no earlier month to carry in from.
  const held = effectiveHeld(
    pocket.delta,
    unaccounted,
    periodLabel ? (carryInBy.get(periodLabel) ?? 0) : 0,
  );
  return {
    withdrawals: shown,
    spends,
    allocations,
    totals: {
      withdrawn: sum(inMonth.map((w) => w.amount)),
      accounted: sum(inMonth.map((w) => w.allocated)),
      unaccounted,
      walletSpend: sum(spends.map((s) => s.amount)),
      unfunded: sum(spends.map((s) => s.uncovered)),
      held,
      unaccountedSpend: Math.max(0, Math.round((unaccounted - held) * 100) / 100),
    },
    pocket,
    carryInDays: DEFAULT_LOOKBACK_DAYS,
  };
}

export async function getUncategorizedCount() {
  await requireSession();
  const r = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(or(isNull(transactions.category), eq(transactions.category, "")));
  return Number(r[0]?.c ?? 0);
}

export async function getSuggestedRules(limit = 20) {
  await requireSession();
  const { computeSuggestions } = await import("@/server/lib/suggest");
  const all = await db
    .select({ d: transactions.description, c: transactions.category })
    .from(transactions);
  const uncategorized = all.filter((x) => !x.c || x.c === "").map((x) => x.d);
  const categorized = all
    .filter((x) => x.c && x.c !== "")
    .map((x) => ({ description: x.d, category: x.c as string }));
  return computeSuggestions(uncategorized, categorized, limit);
}

export async function getCategoryRows() {
  await requireSession();
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function getCategoryCounts() {
  await requireSession();
  const rows = await db
    .select({ category: transactions.category, c: sql<number>`COUNT(*)` })
    .from(transactions)
    .groupBy(transactions.category);
  const map = new Map<string, number>();
  for (const r of rows) if (r.category) map.set(r.category, Number(r.c));
  return map;
}

export interface CategoryOption {
  name: string;
  color: string;
  emoji: string | null;
  // Disabled categories stay in this list (so existing transactions keep their colored
  // pill and remain filterable) but pickers that assign a category must filter to active.
  active: boolean;
}

// Unified option list for every category dropdown: managed categories first (in their
// drag-ordered sortOrder, carrying color + emoji), then any orphan categories still present
// on transactions but not managed (appended, neutral color, no emoji).
export async function getCategoryOptionsRich(): Promise<CategoryOption[]> {
  await requireSession();
  const [rows, distinct] = await Promise.all([
    db
      .select({
        name: categories.name,
        color: categories.color,
        emoji: categories.emoji,
        active: categories.active,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    getDistinctTxCategories(),
  ]);
  const seen = new Set(rows.map((r) => r.name));
  const opts: CategoryOption[] = rows.map((r) => ({
    name: r.name,
    color: r.color,
    emoji: r.emoji,
    active: !!r.active,
  }));
  for (const d of distinct) {
    if (!seen.has(d)) opts.push({ name: d, color: "#9ca3af", emoji: null, active: true });
  }
  return opts;
}

export async function getCategoryMappings() {
  await requireSession();
  return db
    .select()
    .from(categoryMappings)
    .orderBy(asc(categoryMappings.priority), asc(categoryMappings.id));
}

// Saved rules in the plain shape client components use (no timestamps).
export async function getCategoryRules(): Promise<CategoryRule[]> {
  const rows = await getCategoryMappings();
  return rows.map((r) => ({
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    category: r.category,
    billId: r.billId,
    priority: r.priority,
  }));
}

export async function getImportBatches() {
  await requireSession();
  return db.select().from(importBatches).orderBy(desc(importBatches.id)).limit(50);
}

// Income (Credit) vs outgoing (Debit) per period, from transactions. Cash withdrawals count
// only for their unaccounted remainder — the purchases they funded are counted as themselves,
// in the month they happened. That's why moving a withdrawal's cash into the next month's
// purchases lowers the withdrawal's month here and raises the next one.
export async function getCashflowByPeriod() {
  await requireSession();
  // A split row counts its own share when its own category isn't Transfer, and each piece when
  // the piece's isn't — so a transfer that was partly a real purchase counts for that part.
  const wa = allocatedByWithdrawal();
  const st = splitByTxn();
  const [ownRows, pieceRows] = await Promise.all([
    db
      .select({
        label: periods.label,
        year: periods.year,
        month: periods.month,
        direction: transactions.direction,
        total: sql<string>`COALESCE(SUM(${ownShare(wa, st)}), 0)`,
      })
      .from(transactions)
      .innerJoin(periods, eq(periods.id, transactions.periodId))
      .leftJoin(wa, eq(wa.txnId, transactions.id))
      .leftJoin(st, eq(st.txnId, transactions.id))
      .where(sql`(${transactions.category} IS NULL OR ${transactions.category} <> 'Transfer')`)
      .groupBy(periods.id, periods.label, periods.year, periods.month, transactions.direction),
    db
      .select({
        label: periods.label,
        year: periods.year,
        month: periods.month,
        direction: transactions.direction,
        total: sql<string>`COALESCE(SUM(${pieceShare(wa, st)}), 0)`,
      })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.txnId))
      .innerJoin(periods, eq(periods.id, transactions.periodId))
      .leftJoin(wa, eq(wa.txnId, transactions.id))
      .leftJoin(st, eq(st.txnId, transactions.id))
      .where(pieceNotTransferCond)
      .groupBy(periods.id, periods.label, periods.year, periods.month, transactions.direction),
  ]);
  const merged = new Map<string, (typeof ownRows)[number]>();
  for (const r of [...ownRows, ...pieceRows]) {
    const key = `${r.label}|${r.direction}`;
    const cur = merged.get(key);
    merged.set(
      key,
      cur
        ? { ...cur, total: round2((toNum(cur.total) ?? 0) + (toNum(r.total) ?? 0)).toFixed(2) }
        : r,
    );
  }
  const rows = [...merged.values()].sort((a, b) => a.year - b.year || a.month - b.month);

  // Outgoing drops by the cash that stayed in your pocket that month — same correction the
  // category chart makes, so the two dashboard views can't tell different stories.
  const heldBy = await effectiveHeldByPeriod();
  return rows.map((r) => {
    const held = r.direction === "Debit" ? (heldBy.get(r.label) ?? 0) : 0;
    if (held === 0) return r;
    const left = Math.max(0, Math.round(((toNum(r.total) ?? 0) - held) * 100) / 100);
    return { ...r, total: left.toFixed(2) };
  });
}

// Net spend grouped by category (optionally for one period). Debits count as
// positive spend; Credits (refunds, or an offsetting entry like money loaned out
// and repaid) subtract, so a category with a matching debit + credit nets out
// instead of inflating the total. Derives sign from amount + direction (amount is
// always the positive magnitude) rather than the unreliable net_amount column.
// Categories that net to <= 0 (pure income/deposits, fully cancelled pairs) drop out.
export async function getCategorySpend(periodLabel?: string) {
  await requireSession();
  const conds: SQL[] = [notTransferCond];
  if (periodLabel) conds.push(eq(periods.label, periodLabel));
  // Cash withdrawals count only for what they couldn't explain, so the "Cash" slice reads as
  // "cash I never accounted for" and the purchases it funded land in their own categories.
  // Split transactions count their own share here and each piece under the piece's category,
  // so the two queries together still add up to every row's full amount.
  const wa = allocatedByWithdrawal();
  const st = splitByTxn();
  const own = ownShare(wa, st);
  const netSpend = sql`SUM(CASE WHEN ${transactions.direction} = 'Debit' THEN ${own} ELSE -${own} END)`;
  const part = pieceShare(wa, st);
  const netPieces = sql`SUM(CASE WHEN ${transactions.direction} = 'Debit' THEN ${part} ELSE -${part} END)`;
  const pieceConds: SQL[] = [pieceNotTransferCond];
  if (periodLabel) pieceConds.push(eq(periods.label, periodLabel));
  const [ownRows, pieceRows] = await Promise.all([
    db
      .select({
        category: transactions.category,
        total: sql<string>`COALESCE(${netSpend}, 0)`,
      })
      .from(transactions)
      .innerJoin(periods, eq(periods.id, transactions.periodId))
      .leftJoin(wa, eq(wa.txnId, transactions.id))
      .leftJoin(st, eq(st.txnId, transactions.id))
      .where(and(...conds))
      .groupBy(transactions.category),
    db
      .select({
        category: transactionSplits.category,
        total: sql<string>`COALESCE(${netPieces}, 0)`,
      })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.txnId))
      .innerJoin(periods, eq(periods.id, transactions.periodId))
      .leftJoin(wa, eq(wa.txnId, transactions.id))
      .leftJoin(st, eq(st.txnId, transactions.id))
      .where(and(...pieceConds))
      .groupBy(transactionSplits.category),
  ]);
  const byCat = new Map<string | null, number>();
  for (const r of [...ownRows, ...pieceRows]) {
    byCat.set(r.category, round2((byCat.get(r.category) ?? 0) + (toNum(r.total) ?? 0)));
  }
  const rows: { category: string | null; total: string }[] = [...byCat]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => ({ category, total: total.toFixed(2) }));

  // Cash you're still holding was withdrawn but NOT spent, so it comes off the Cash slice —
  // the one bucket that means "cash whose fate is unknown". Purchases logged against a
  // withdrawal have already been taken off by `unaccountedAmount`; this is the other half of
  // the same reconciliation. See getCashHeld.
  const held = periodLabel
    ? ((await effectiveHeldByPeriod()).get(periodLabel) ?? 0)
    : (await getCashHeld()).delta;
  if (held === 0) return rows;

  let seenCash = false;
  const adjusted = rows
    .map((r) => {
      if (r.category !== CASH_SOURCE_CATEGORY) return r;
      seenCash = true;
      const left = Math.max(0, Math.round(((toNum(r.total) ?? 0) - held) * 100) / 100);
      return { ...r, total: left.toFixed(2) };
    })
    .filter((r) => (toNum(r.total) ?? 0) > 0);
  // A month can spend down last month's cash without withdrawing any of its own — real
  // spending with no transaction behind it, so there's no Cash row to adjust. Create one,
  // otherwise the money simply disappears from the chart.
  if (!seenCash && held < 0) {
    adjusted.push({ category: CASH_SOURCE_CATEGORY, total: Math.abs(held).toFixed(2) });
  }
  // Re-sort: the Cash slice moves once the pocket is taken out of (or added back to) it.
  adjusted.sort((a, b) => (toNum(b.total) ?? 0) - (toNum(a.total) ?? 0));
  return adjusted;
}

export async function getCounts() {
  await requireSession();
  const [p, bi, tx, ac] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(periods),
    db.select({ c: sql<number>`COUNT(*)` }).from(billInstances),
    db.select({ c: sql<number>`COUNT(*)` }).from(transactions),
    db.select({ c: sql<number>`COUNT(*)` }).from(accounts),
  ]);
  return {
    periods: Number(p[0]?.c ?? 0),
    instances: Number(bi[0]?.c ?? 0),
    transactions: Number(tx[0]?.c ?? 0),
    accounts: Number(ac[0]?.c ?? 0),
  };
}

export interface RecurringSuggestion {
  key: string; // normalized merchant key — the dismissal id
  name: string; // display name (the most common raw description in the group)
  sampleTransactionId: number; // representative txn used to drive convert/link
  count: number; // number of occurrences
  months: number; // distinct calendar months it appears in
  firstDate: string;
  lastDate: string;
  avgAmount: number;
  totalAmount: number;
}

// Detect outgoing charges that recur on a roughly monthly cadence but aren't yet
// linked to a bill — candidates the user probably wants to track as bills.
// Grouping is by normalized merchant key (MySQL 5.7 can't regex, so we group in
// JS). Dismissed keys are excluded. Deliberately conservative: needs >= 3 distinct
// months and a near-monthly cadence, so high-frequency spend (daily coffee, food
// delivery) and one-offs don't show up.
export async function getRecurringSuggestions(): Promise<RecurringSuggestion[]> {
  await requireSession();
  const [rows, dismissedRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        amount: transactions.amount,
        txnDate: transactions.txnDate,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.billId),
          isNull(transactions.transferPartnerId),
          eq(transactions.direction, "Debit"),
          // Pending rows can still change or vanish — never build a bill off one.
          eq(transactions.pending, false),
          notTransferCond,
        ),
      ),
    db.select({ key: suggestionDismissals.merchantKey }).from(suggestionDismissals),
  ]);
  const dismissed = new Set(dismissedRows.map((d) => d.key));

  interface Group {
    ids: number[];
    dates: string[];
    descs: Map<string, number>;
    months: Set<string>;
    amounts: number[];
    total: number;
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = normalizeMerchant(r.description).slice(0, 191);
    if (!key || dismissed.has(key)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { ids: [], dates: [], descs: new Map(), months: new Set(), amounts: [], total: 0 };
      groups.set(key, g);
    }
    const amt = toNum(r.amount) ?? 0;
    g.ids.push(r.id);
    g.dates.push(r.txnDate);
    g.descs.set(r.description, (g.descs.get(r.description) ?? 0) + 1);
    g.months.add(r.txnDate.slice(0, 7)); // YYYY-MM
    g.amounts.push(amt);
    g.total += amt;
  }

  const out: (RecurringSuggestion & { consistent: boolean })[] = [];
  for (const [key, g] of groups) {
    const months = g.months.size;
    const count = g.ids.length;
    if (months < 3 || count / months > 1.6) continue;
    // Representative = the most recent occurrence.
    let lastIdx = 0;
    for (let i = 1; i < g.dates.length; i++) if (g.dates[i] > g.dates[lastIdx]) lastIdx = i;
    // Display name = the most common raw description in the group.
    let name = key;
    let bestN = -1;
    for (const [d, n] of g.descs)
      if (n > bestN) {
        bestN = n;
        name = d;
      }
    // Amount consistency (low coefficient of variation) is a strong "this is a
    // fixed bill" signal — subscriptions/fees vs. variable cash withdrawals.
    const mean = g.total / count;
    const variance = g.amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / count;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const sorted = g.dates.slice().sort();
    out.push({
      key,
      name,
      sampleTransactionId: g.ids[lastIdx],
      count,
      months,
      firstDate: sorted[0],
      lastDate: sorted[sorted.length - 1],
      avgAmount: mean,
      totalAmount: g.total,
      consistent: cv <= 0.2,
    });
  }
  // Fixed-amount recurring charges (the clearest bills) first, then by how
  // established the recurrence is, then recency.
  out.sort(
    (a, b) =>
      Number(b.consistent) - Number(a.consistent) ||
      b.months - a.months ||
      b.count - a.count ||
      (a.lastDate < b.lastDate ? 1 : -1),
  );
  return out.slice(0, 15).map((s) => ({
    key: s.key,
    name: s.name,
    sampleTransactionId: s.sampleTransactionId,
    count: s.count,
    months: s.months,
    firstDate: s.firstDate,
    lastDate: s.lastDate,
    avgAmount: s.avgAmount,
    totalAmount: s.totalAmount,
  }));
}

// ---- Savings goals ----------------------------------------------------------------------
// Each goal's progress is the running SUM of its contributions. For goals backed by a cash
// account we additionally "reality-check" the allocation against that account's recorded
// cash-on-hand (as of `asOf`): when the account can't cover everything allocated to it, the
// balance is filled to its goals in priority order (sort_order, then id) and the goals it can't
// cover show a `shortfall` — i.e. the goal regresses when the funding account dips.
export interface GoalProgressRow {
  id: number;
  name: string;
  goalType: string;
  targetAmount: number;
  targetDate: string | null;
  fundingAccountId: number | null;
  fundingAccountLabel: string | null;
  fundingAccountNumber: string | null;
  fundingAccountType: string | null;
  color: string;
  emoji: string | null;
  status: string;
  sortOrder: number;
  notes: string | null;
  funded: number; // SUM(contributions)
  contributionCount: number;
  // Reality check (cash-backed goals only; null when no funding account / not cash / no snapshot):
  accountBalance: number | null; // funding account's cash-on-hand as of the date
  backed: number; // how much of `funded` is actually covered by the account right now
  shortfall: number; // max(0, funded - backed) — how far the goal has regressed
}

export async function getGoalsWithProgress(asOf?: string): Promise<GoalProgressRow[]> {
  await requireSession();
  const goals = await db
    .select()
    .from(savingsGoals)
    .orderBy(asc(savingsGoals.sortOrder), asc(savingsGoals.id));
  if (!goals.length) return [];

  const sums = await db
    .select({
      goalId: goalContributions.goalId,
      total: sql<string>`COALESCE(SUM(${goalContributions.amount}), 0)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(goalContributions)
    .groupBy(goalContributions.goalId);
  const fundedBy = new Map(
    sums.map((s) => [s.goalId, { total: toNum(s.total) ?? 0, cnt: Number(s.cnt) }]),
  );

  // Funding-account display info (label / number / type) for any linked accounts.
  const acctIds = [
    ...new Set(goals.map((g) => g.fundingAccountId).filter((x): x is number => x != null)),
  ];
  const acctInfo = new Map<
    number,
    { label: string | null; accountNumber: string; accountType: string | null }
  >();
  if (acctIds.length) {
    const rows = await db
      .select({
        id: accounts.id,
        label: accounts.label,
        accountNumber: accounts.accountNumber,
        accountType: accounts.accountType,
      })
      .from(accounts)
      .where(inArray(accounts.id, acctIds));
    for (const r of rows)
      acctInfo.set(r.id, {
        label: r.label,
        accountNumber: r.accountNumber,
        accountType: r.accountType,
      });
  }

  // Cash-on-hand of cash accounts (Checking/Savings) as of the date — drives the reality check.
  const cash = await getCashOnHand(asOf);
  const cashBal = new Map<number, number | null>();
  for (const c of cash) cashBal.set(c.id, toNum(c.balance));

  const rows: GoalProgressRow[] = goals.map((g) => {
    const f = fundedBy.get(g.id);
    const info = g.fundingAccountId != null ? acctInfo.get(g.fundingAccountId) : undefined;
    const funded = f?.total ?? 0;
    return {
      id: g.id,
      name: g.name,
      goalType: g.goalType,
      targetAmount: toNum(g.targetAmount) ?? 0,
      targetDate: g.targetDate,
      fundingAccountId: g.fundingAccountId,
      fundingAccountLabel: info?.label ?? null,
      fundingAccountNumber: info?.accountNumber ?? null,
      fundingAccountType: info?.accountType ?? null,
      color: g.color,
      emoji: g.emoji,
      status: g.status,
      sortOrder: g.sortOrder,
      notes: g.notes,
      funded,
      contributionCount: f?.cnt ?? 0,
      accountBalance: g.fundingAccountId != null ? cashBal.get(g.fundingAccountId) ?? null : null,
      backed: funded, // fully backed by default; lowered below for over-allocated cash accounts
      shortfall: 0,
    };
  });

  // Group non-archived, cash-backed goals (that have a recorded balance) by funding account, then
  // fill each account's balance to its goals in priority order. `rows` is already in priority
  // order, so pushing preserves it.
  const byAcct = new Map<number, GoalProgressRow[]>();
  for (const r of rows) {
    if (r.fundingAccountId == null || r.status === "archived") continue;
    const bal = cashBal.get(r.fundingAccountId);
    if (bal == null) continue; // not a cash account, or no snapshot recorded → skip reality check
    const list = byAcct.get(r.fundingAccountId) ?? [];
    list.push(r);
    byAcct.set(r.fundingAccountId, list);
  }
  for (const [acctId, list] of byAcct) {
    let remaining = cashBal.get(acctId) ?? 0;
    for (const r of list) {
      const covered = Math.max(0, Math.min(r.funded, remaining));
      r.backed = covered;
      r.shortfall = Math.max(0, r.funded - covered);
      remaining -= covered;
    }
  }

  return rows;
}

export async function getGoalContributions(goalId: number) {
  await requireSession();
  return db
    .select()
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId))
    .orderBy(desc(goalContributions.occurredOn), desc(goalContributions.id));
}

// ---- Pay schedule -------------------------------------------------------------------------
// Single-row config table (id = 1). Returns null when the user hasn't set one up yet — every
// caller treats that as "show the setup prompt", not an error.
export interface PayScheduleRow {
  id: number;
  frequency: PayFrequency;
  dayOne: number | null;
  dayTwo: number | null;
  anchorDate: string | null;
  takeHome: number | null;
  /** ± days a real deposit may drift from its nominal payday (payday-reconcile.ts). */
  depositWindowDays: number;
  /** Case-insensitive regex picking payroll out of all credits; null = the built-in default. */
  depositMatch: string | null;
  notes: string | null;
}

export async function getPaySchedule(): Promise<PayScheduleRow | null> {
  await requireSession();
  const [row] = await db.select().from(paySchedule).where(eq(paySchedule.active, true)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    frequency: row.frequency as PayFrequency,
    dayOne: row.dayOne,
    dayTwo: row.dayTwo,
    anchorDate: row.anchorDate,
    takeHome: toNum(row.takeHome),
    depositWindowDays: row.depositWindowDays,
    depositMatch: row.depositMatch,
    notes: row.notes,
  };
}

// ---- Budgets ------------------------------------------------------------------------------
// A budget is the month's PLAN; every number below that isn't `planned` is derived from
// transactions at read time. Category lines reuse getCategorySpend (so cash offsets and the
// pocket count are already reconciled — the budget can never disagree with the dashboard about
// what a category cost). Debt lines sum Debit payments linked to the account's bill.
// See planning/features/budget.md.

export interface BudgetLineRow {
  id: number;
  kind: string; // category | debt
  label: string;
  category: string | null;
  accountId: number | null;
  planned: number;
  minimum: number | null;
  isTarget: boolean;
  locked: boolean;
  sortOrder: number;
  notes: string | null;
  actual: number; // what the month's transactions say so far
  // Category display
  color: string | null;
  emoji: string | null;
  // Debt context (null on category lines): balances are "as of" the month's end and the day
  // before it started, so the movement is the month's own.
  accountLabel: string | null;
  balance: number | null;
  balanceStart: number | null;
  apr: number | null;
  minPayment: number | null;
  linkedBillId: number | null;
}

export interface BudgetView {
  id: number;
  periodId: number;
  periodLabel: string;
  year: number;
  month: number;
  mode: string;
  strategy: string | null;
  plannedIncome: number | null;
  autoRebalance: boolean;
  notes: string | null;
  lines: BudgetLineRow[];
  actualIncome: number; // Credit transactions this month (transfers excluded)
  // Cash on hand (checking + savings + pocket): the day before the month began vs. the latest
  // snapshot ≤ month end — the reality check for a savings line ("did the stack actually grow?").
  cash: { start: number | null; now: number | null; asOf: string | null };
  // Debit payments categorized "Debt Repayment" this month that no debt line claimed — a
  // nudge to link them to a bill so the right line gets credit.
  unassignedDebtPayments: number;
  /**
   * Spending this month in categories the budget has no line for (uncategorized included) — money
   * that left without any envelope accounting for it. The projection can't see it: it only spreads
   * what a line planned, so this is pure leakage against the month-end figure. Surfaced so it can
   * be given a line (or accepted) rather than quietly widening the gap every month.
   */
  unplannedSpend: { total: number; categories: { category: string | null; amount: number }[] };
  debts: DebtInput[]; // every liability with a balance — drives the projection + "add debt"
}

/** Every liability as a plain DebtInput (balance/apr/min as of `asOf`). */
export async function getDebtInputs(asOf?: string): Promise<DebtInput[]> {
  const liabilities = await getLiabilityAccounts(asOf);
  return liabilities
    .filter((l) => l.active)
    .map((l) => ({
      accountId: l.id,
      label: l.label ?? `••${l.accountNumber}`,
      balance: toNum(l.balance) ?? 0,
      apr: toNum(l.apr),
      minPayment: toNum(l.minPayment),
    }));
}

const dayBefore = (iso: string) =>
  new Date(Date.parse(iso + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

/** Which periods already have a budget — the page marks them in its month picker. */
export async function getBudgetedPeriodLabels(): Promise<Set<string>> {
  await requireSession();
  const rows = await db
    .select({ label: periods.label })
    .from(budgets)
    .innerJoin(periods, eq(periods.id, budgets.periodId));
  return new Set(rows.map((r) => r.label));
}

/**
 * Debit payments toward each liability in a month, keyed by accountId. A payment counts when
 * it's linked (bill_id) to the account's bill and did NOT happen on the liability itself — a
 * card's own linked rows are purchases and interest, not payments.
 */
async function debtPaymentsForPeriod(
  periodLabel: string,
  accts: { id: number; billId: number | null }[],
): Promise<Map<number, number>> {
  const billIds = accts.map((a) => a.billId).filter((b): b is number => b != null);
  const out = new Map<number, number>();
  if (!billIds.length) return out;
  const rows = await db
    .select({
      billId: transactions.billId,
      accountId: transactions.accountId,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .where(
      and(
        eq(periods.label, periodLabel),
        eq(transactions.direction, "Debit"),
        inArray(transactions.billId, billIds),
      ),
    )
    .groupBy(transactions.billId, transactions.accountId);
  for (const r of rows) {
    const acct = accts.find((a) => a.billId === r.billId);
    if (!acct || r.accountId === acct.id) continue;
    out.set(acct.id, (out.get(acct.id) ?? 0) + (toNum(r.total) ?? 0));
  }
  return out;
}

export async function getBudgetView(periodLabel: string): Promise<BudgetView | null> {
  await requireSession();
  const [row] = await db
    .select({
      id: budgets.id,
      periodId: budgets.periodId,
      mode: budgets.mode,
      strategy: budgets.strategy,
      plannedIncome: budgets.plannedIncome,
      autoRebalance: budgets.autoRebalance,
      notes: budgets.notes,
      year: periods.year,
      month: periods.month,
    })
    .from(budgets)
    .innerJoin(periods, eq(periods.id, budgets.periodId))
    .where(eq(periods.label, periodLabel))
    .limit(1);
  if (!row) return null;

  const { start, end } = monthBounds(row.year, row.month);
  const [lines, catSpend, catRows, liabNow, liabStart, cashflow, cashNow, cashStart] = await Promise.all([
    db
      .select()
      .from(budgetLines)
      .where(eq(budgetLines.budgetId, row.id))
      .orderBy(asc(budgetLines.sortOrder), asc(budgetLines.id)),
    getCategorySpend(periodLabel),
    getCategoryRows(),
    getLiabilityAccounts(end),
    getLiabilityAccounts(dayBefore(start)),
    getCashflowByPeriod(),
    getCashOnHand(end),
    getCashOnHand(dayBefore(start)),
  ]);
  const sumCash = (rows: Awaited<ReturnType<typeof getCashOnHand>>) =>
    rows.some((a) => a.balance != null)
      ? round2(rows.reduce((s, a) => s + (toNum(a.balance) ?? 0), 0))
      : null;
  const cashAsOf = cashNow.reduce<string | null>(
    (m, a) => (a.asOf && (!m || a.asOf > m) ? a.asOf : m),
    null,
  );

  const spendBy = new Map(catSpend.map((c) => [c.category ?? "", toNum(c.total) ?? 0]));
  const catMeta = new Map(catRows.map((c) => [c.name, { color: c.color, emoji: c.emoji }]));
  const nowBy = new Map(liabNow.map((l) => [l.id, l]));
  const startBy = new Map(liabStart.map((l) => [l.id, l]));

  const debtAccts = lines
    .filter((l) => l.kind === "debt" && l.accountId != null)
    .map((l) => ({ id: l.accountId!, billId: nowBy.get(l.accountId!)?.billId ?? null }));
  const paidBy = await debtPaymentsForPeriod(periodLabel, debtAccts);

  // "Debt Repayment" debits nobody claimed: total in the category minus what the lines matched.
  // Split-aware like the category chart — a row counts its own share when it's filed as Debt
  // Repayment, and any part split off into Debt Repayment counts too.
  const repaySt = splitByTxn();
  const unclaimedDebit = and(
    eq(periods.label, periodLabel),
    eq(transactions.direction, "Debit"),
    isNull(transactions.billId),
  );
  const [[repayOwn], [repayParts]] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(GREATEST(${transactions.amount} - COALESCE(${repaySt.split}, 0), 0)), 0)`,
      })
      .from(transactions)
      .innerJoin(periods, eq(periods.id, transactions.periodId))
      .leftJoin(repaySt, eq(repaySt.txnId, transactions.id))
      .where(and(unclaimedDebit, eq(transactions.category, "Debt Repayment"))),
    db
      .select({ total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), 0)` })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.txnId))
      .innerJoin(periods, eq(periods.id, transactions.periodId))
      .where(and(unclaimedDebit, eq(transactionSplits.category, "Debt Repayment"))),
  ]);
  const repay = { total: round2((toNum(repayOwn?.total) ?? 0) + (toNum(repayParts?.total) ?? 0)) };

  const actualIncome = cashflow
    .filter((c) => c.label === periodLabel && c.direction === "Credit")
    .reduce((s, c) => s + (toNum(c.total) ?? 0), 0);

  const rows: BudgetLineRow[] = lines.map((l) => {
    const isDebt = l.kind === "debt";
    // A line on the Savings category is a savings line whatever kind it was saved as (older rows
    // predate the kind) — it must never read as spending.
    const kind = l.kind === "category" && l.category === SAVINGS_CATEGORY ? "savings" : l.kind;
    const now = l.accountId != null ? nowBy.get(l.accountId) : undefined;
    const before = l.accountId != null ? startBy.get(l.accountId) : undefined;
    const meta = l.category ? catMeta.get(l.category) : undefined;
    return {
      id: l.id,
      kind,
      label: l.label,
      category: l.category,
      accountId: l.accountId,
      planned: toNum(l.planned) ?? 0,
      minimum: toNum(l.minimum),
      isTarget: !!l.isTarget,
      locked: !!l.locked,
      sortOrder: l.sortOrder,
      notes: l.notes,
      actual: isDebt
        ? l.accountId != null
          ? paidBy.get(l.accountId) ?? 0
          : 0
        : l.category
          ? spendBy.get(l.category) ?? 0
          : 0,
      color: meta?.color ?? null,
      emoji: meta?.emoji ?? null,
      accountLabel: now ? now.label ?? `••${now.accountNumber}` : null,
      balance: toNum(now?.balance),
      balanceStart: toNum(before?.balance),
      apr: toNum(now?.apr),
      minPayment: toNum(now?.minPayment),
      linkedBillId: now?.billId ?? null,
    };
  });

  // Categories the plan covers: its own lines, the ones a budget never turns into a spending line
  // (income, internal moves, and the Debt Repayment the debt lines already account for), and the
  // Cash source category, whose withdrawals are reconciled into the categories they funded
  // (cash-offsets.md). Everything else that spent money did so outside the plan.
  const planned = new Set<string>(rows.map((l) => l.category).filter((c): c is string => !!c));
  for (const c of [...BUDGET_EXCLUDED_CATEGORIES, CASH_SOURCE_CATEGORY]) planned.add(c);
  const unplannedRows = catSpend
    .filter((c) => !(c.category != null && planned.has(c.category)))
    .map((c) => ({ category: c.category, amount: toNum(c.total) ?? 0 }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return {
    id: row.id,
    periodId: row.periodId,
    periodLabel,
    year: row.year,
    month: row.month,
    mode: row.mode,
    strategy: row.strategy,
    plannedIncome: toNum(row.plannedIncome),
    autoRebalance: !!row.autoRebalance,
    notes: row.notes,
    lines: rows,
    actualIncome,
    cash: { start: sumCash(cashStart), now: sumCash(cashNow), asOf: cashAsOf },
    unassignedDebtPayments: toNum(repay?.total) ?? 0,
    unplannedSpend: { total: round2(unplannedRows.reduce((t, c) => t + c.amount, 0)), categories: unplannedRows },
    debts: liabNow
      .filter((l) => l.active)
      .map((l) => ({
        accountId: l.id,
        label: l.label ?? `••${l.accountNumber}`,
        balance: toNum(l.balance) ?? 0,
        apr: toNum(l.apr),
        minPayment: toNum(l.minPayment),
      })),
  };
}

/**
 * The most recent budget BEFORE `periodLabel`, as PlannedLines — the "copy last month" mode's
 * starting point. Lines come back in their saved order with their locks and target intact; the
 * previous month's plannedIncome and strategy ride along so the wizard can pre-fill them.
 */
export async function getPreviousBudgetPlan(periodLabel: string): Promise<{
  fromLabel: string;
  mode: string;
  strategy: string | null;
  plannedIncome: number | null;
  autoRebalance: boolean;
  lines: import("@/server/lib/budget").PlannedLine[];
} | null> {
  await requireSession();
  const [row] = await db
    .select({
      id: budgets.id,
      label: periods.label,
      mode: budgets.mode,
      strategy: budgets.strategy,
      plannedIncome: budgets.plannedIncome,
      autoRebalance: budgets.autoRebalance,
    })
    .from(budgets)
    .innerJoin(periods, eq(periods.id, budgets.periodId))
    .where(sql`${periods.label} < ${periodLabel}`)
    .orderBy(desc(periods.label))
    .limit(1);
  if (!row) return null;
  const lines = await db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, row.id))
    .orderBy(asc(budgetLines.sortOrder), asc(budgetLines.id));
  return {
    fromLabel: row.label,
    mode: row.mode,
    strategy: row.strategy,
    plannedIncome: toNum(row.plannedIncome),
    autoRebalance: !!row.autoRebalance,
    lines: lines.map((l) => ({
      kind: (l.kind === "category" && l.category === SAVINGS_CATEGORY ? "savings" : l.kind) as "category" | "debt" | "savings",
      label: l.label,
      category: l.category,
      accountId: l.accountId,
      planned: toNum(l.planned) ?? 0,
      minimum: toNum(l.minimum),
      isTarget: !!l.isTarget,
      locked: !!l.locked,
    })),
  };
}

// What the setup wizard needs to draft a plan for a month that has no budget yet.
export interface BudgetInputs {
  debts: DebtInput[];
  /** Net spend per category for each of the trailing months that exist (newest first). */
  history: { label: string; rows: { category: string; total: number }[] }[];
  defaultIncome: number | null; // pay schedule × paydays in the month
  paySchedule: PayScheduleRow | null;
  billsTotal: number; // the month's bill sheet, for reference
  categories: CategoryOption[];
  /** The previous month's plan, when one exists — "Copy last month" starts here. */
  previous: Awaited<ReturnType<typeof getPreviousBudgetPlan>>;
}

export async function getBudgetInputs(periodLabel: string, lookback = 3): Promise<BudgetInputs> {
  await requireSession();
  const parsed = parsePeriodLabel(periodLabel);
  const all = await getPeriods(); // newest first
  const idx = all.findIndex((p) => p.label === periodLabel);
  // Trailing months = the periods before this one in the list (already newest-first).
  const prior = idx >= 0 ? all.slice(idx + 1, idx + 1 + lookback) : all.slice(0, lookback);
  const target = idx >= 0 ? all[idx] : null;

  const [debts, schedule, categories, previous, ...spend] = await Promise.all([
    getDebtInputs(),
    getPaySchedule(),
    getCategoryOptionsRich(),
    getPreviousBudgetPlan(periodLabel),
    ...prior.map((p) => getCategorySpend(p.label)),
  ]);

  let billsTotal = 0;
  if (target) {
    const inst = await getInstances(target.id);
    billsTotal = inst.reduce((s, i) => s + (toNum(i.amount) ?? 0), 0);
  }

  const { monthIncome } = await import("@/server/lib/budget");
  const defaultIncome =
    parsed && schedule ? monthIncome(schedule, parsed.year, parsed.month) : null;

  return {
    debts,
    history: prior.map((p, i) => ({
      label: p.label,
      rows: spend[i].map((r) => ({ category: r.category ?? "", total: toNum(r.total) ?? 0 })),
    })),
    defaultIncome,
    paySchedule: schedule,
    billsTotal,
    categories,
    previous,
  };
}

// ---- Cash projection inputs ----------------------------------------------------------------
// Everything the pure projector (src/server/lib/cash-projection.ts) needs that lives in the DB:
// the month's bill instances with a "has cash actually left?" verdict, which budget bucket each
// bill belongs to, and the paycheck dates. The page assembles these with the budget view.

export interface ProjectionBillRow {
  id: number;
  name: string;
  amount: number;
  dueDay: number | null;
  billId: number | null;
  status: string;
  /** Money has left: a transaction is linked to it, or the sheet marks it settled (Autopay
   *  excepted — that's a promise, not a payment, until the due day passes). */
  paid: boolean;
  /** Liability account this bill pays (accounts.bill_id), if any. */
  accountId: number | null;
  /** The category its transactions usually land in — how it finds a budget line. */
  category: string | null;
}

export async function getProjectionBills(periodLabel: string): Promise<ProjectionBillRow[]> {
  await requireSession();
  const period = await getPeriodByLabel(periodLabel);
  if (!period) return [];
  const [inst, statuses, linked, liab, catRows] = await Promise.all([
    getInstances(period.id),
    getStatusConfig(),
    db
      .select({ instanceId: transactions.billInstanceId, c: sql<number>`COUNT(*)` })
      .from(transactions)
      .innerJoin(billInstances, eq(billInstances.id, transactions.billInstanceId))
      .where(eq(billInstances.periodId, period.id))
      .groupBy(transactions.billInstanceId),
    db
      .select({ id: accounts.id, billId: accounts.billId })
      .from(accounts)
      .where(inArray(accounts.accountType, [...LIABILITY_ACCOUNT_TYPES])),
    // Majority category per bill across all its linked transactions (nulls ignored).
    db
      .select({ billId: transactions.billId, category: transactions.category, c: sql<number>`COUNT(*)` })
      .from(transactions)
      .where(and(sql`${transactions.billId} IS NOT NULL`, sql`${transactions.category} IS NOT NULL`))
      .groupBy(transactions.billId, transactions.category),
  ]);
  const settled = new Set(statuses.filter((s) => s.isSettled).map((s) => s.name));
  const linkedSet = new Set(linked.filter((l) => Number(l.c) > 0).map((l) => l.instanceId));
  const acctByBill = new Map(liab.filter((a) => a.billId != null).map((a) => [a.billId!, a.id]));
  const catByBill = new Map<number, { category: string; c: number }>();
  for (const r of catRows) {
    if (r.billId == null || !r.category) continue;
    const cur = catByBill.get(r.billId);
    if (!cur || Number(r.c) > cur.c) catByBill.set(r.billId, { category: r.category, c: Number(r.c) });
  }
  const today = todayIso();
  return inst
    .filter((i) => i.amount != null)
    .map((i) => {
      const dueIso = i.dueDay != null ? clampToMonth(period.year, period.month, i.dueDay) : null;
      const autopay = /autopay/i.test(i.status);
      const paid =
        linkedSet.has(i.id) ||
        (settled.has(i.status) && (!autopay || (dueIso != null && dueIso <= today)));
      return {
        id: i.id,
        name: i.name,
        amount: toNum(i.amount) ?? 0,
        dueDay: i.dueDay,
        billId: i.billId,
        status: i.status,
        paid,
        accountId: i.billId != null ? acctByBill.get(i.billId) ?? null : null,
        category: i.billId != null ? catByBill.get(i.billId)?.category ?? null : null,
      };
    });
}

/** Paydays inside one month, each worth `income ÷ paydays` (or the schedule's per-check estimate). */
function paydaysFor(
  schedule: PayScheduleRow | null,
  year: number,
  month: number,
  income: number | null,
): { date: string; amount: number }[] {
  if (!schedule) return [];
  const { start, end } = monthBounds(year, month);
  const n = paydaysInMonth(schedule, year, month);
  const per = n > 0 ? (income ?? (schedule.takeHome ?? 0) * n) / n : 0;
  const out: { date: string; amount: number }[] = [];
  if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
    const r = resolvePaydays(schedule, start);
    const step = (schedule.frequency === "weekly" ? 7 : 14) * 86_400_000;
    for (let t = r ? isoToUtc(r.next) : NaN; !Number.isNaN(t) && utcToIso(t) <= end; t += step)
      out.push({ date: utcToIso(t), amount: per });
  } else {
    for (const d of [schedule.dayOne, schedule.frequency === "semimonthly" ? schedule.dayTwo : null])
      if (d != null) out.push({ date: clampToMonth(year, month, d), amount: per });
  }
  return out;
}

/**
 * The payroll credits that landed in a month — the observed half of the payday reconciliation.
 * Filtered by description because amount alone can't tell a paycheck half from a refund that
 * happened to arrive the same week. `pay_schedule.deposit_match` overrides the default pattern.
 */
async function observedPayrollDeposits(periodLabel: string, pattern: string | null): Promise<ObservedDeposit[]> {
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.txnDate,
      amount: transactions.amount,
      description: transactions.description,
      pending: transactions.pending,
    })
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .where(and(eq(periods.label, periodLabel), eq(transactions.direction, "Credit"), notTransferCond))
    .orderBy(asc(transactions.txnDate));
  return rows
    .filter((r) => isPayrollDescription(r.description, pattern))
    .map((r) => ({ id: r.id, date: r.date, amount: toNum(r.amount) ?? 0, description: r.description, pending: !!r.pending }));
}

/**
 * Pending outflows in a month that no balance has seen yet: rows dated AFTER the anchor, so the
 * roll-forward (which stops at the anchor) hasn't subtracted them. They become dated events in
 * the walk, like bills.
 *
 * `lineId` is deliberately null: these are transactions, so the category spend rollup already
 * counts them in the line's `actual`, which means the line's remaining — and therefore the
 * spread — has already been reduced. Deducting again here would charge the same dollars twice.
 */
async function pendingOutflows(periodLabel: string, afterDate: string): Promise<ProjectionPending[]> {
  const rows = await db
    .select({ id: transactions.id, date: transactions.txnDate, amount: transactions.amount, description: transactions.description })
    .from(transactions)
    .innerJoin(periods, eq(periods.id, transactions.periodId))
    .where(
      and(
        eq(periods.label, periodLabel),
        eq(transactions.pending, true),
        eq(transactions.direction, "Debit"),
        gt(transactions.txnDate, afterDate),
      ),
    )
    .orderBy(asc(transactions.txnDate));
  return rows.map((r) => ({
    id: r.id,
    label: `${r.description?.slice(0, 60) ?? "Pending charge"} (pending)`,
    date: r.date,
    amount: toNum(r.amount) ?? 0,
    lineId: null,
  }));
}

function segmentFor(
  label: string,
  year: number,
  month: number,
  lines: BudgetLineRow[],
  bills: ProjectionBillRow[],
  paydays: { date: string; amount: number }[],
  assumed: boolean,
  observedDeposits: ObservedDeposit[] = [],
  pending: ProjectionPending[] = [],
): MonthSegment {
  const { start, end } = monthBounds(year, month);
  const lineByCategory = new Map(lines.filter((l) => l.kind === "category" && l.category).map((l) => [l.category!, l.id]));
  return {
    label,
    start,
    end,
    paydays,
    assumed,
    observedDeposits,
    pending,
    bills: bills.map((b) => ({
      id: b.id,
      name: b.name,
      amount: b.amount,
      dueDay: b.dueDay,
      paid: b.paid,
      accountId: b.accountId,
      lineId: b.category ? lineByCategory.get(b.category) ?? null : null,
    })),
    lines: lines.map((l) => ({ id: l.id, kind: l.kind, label: l.label, planned: l.planned, actual: l.actual, accountId: l.accountId })),
  };
}

export interface ReservedCash {
  /** Σ of what the goals actually hold — the number taken out of spendable cash. */
  total: number;
  goals: { id: number; name: string; emoji: string | null; backed: number; target: number; shortfall: number }[];
}

/**
 * Cash sitting in the accounts that isn't available to spend: savings goals backed by a cash
 * account. It's `backed`, not `funded` or `targetAmount`, on purpose — you cannot reserve money
 * that isn't there, and `backed` is already the reality-checked figure (getGoalsWithProgress fills
 * each funding account to its goals in priority order). So an emergency fund recorded as $5,000
 * funded but holding $3,200.00 reserves $3,200.00 and reports the rest as a shortfall.
 *
 * Archived goals are ignored; achieved ones are NOT — an achieved emergency fund is exactly the
 * money that must stay untouched.
 */
export async function getReservedCash(asOf?: string): Promise<ReservedCash> {
  await requireSession();
  const goals = (await getGoalsWithProgress(asOf)).filter((g) => g.status !== "archived" && g.backed > 0);
  return {
    total: round2(goals.reduce((t, g) => t + g.backed, 0)),
    goals: goals.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, backed: g.backed, target: g.targetAmount, shortfall: g.shortfall })),
  };
}

const monthOffset = (year: number, month: number, delta: number) => {
  const zero = year * 12 + (month - 1) + delta;
  const y = Math.floor(zero / 12);
  const m = (zero % 12) + 1;
  return { year: y, month: m, label: `${y}-${String(m).padStart(2, "0")}` };
};

/**
 * The cash projection for a budget view, or null when there's no recorded cash balance to start
 * from. Shared by /budget and the dashboard so both show the same numbers.
 *
 * The walk runs from the ANCHOR month (wherever the freshest cash balance sits) through the month
 * AFTER the one being viewed, and `focusIndex` points at the viewed month. That lead-in matters
 * whenever you look at a future budget: the anchor balance is today's, so opening next month at
 * today's cash skips everything this month still owes. Previously those in-between days matched no
 * segment at all and silently drew down the LAST segment's daily burn rate — the leftover days of
 * September spending November's allowance.
 *
 * Each month contributes its own bills, plan (its budget, else the viewed month's repeated with
 * actual = 0, flagged `assumed`), paydays netted against the payroll that actually arrived, and
 * pending outflows the balances haven't seen. While the month is still running, one snapshot per
 * day is recorded so today's numbers can be read against last week's (`trend`).
 */
export async function getCashProjection(view: BudgetView): Promise<CashProjection | null> {
  await requireSession();
  if (view.cash.now == null || !view.cash.asOf) return null;
  const { end } = monthBounds(view.year, view.month);
  const asOf = view.cash.asOf < end ? view.cash.asOf : end;

  const schedule = await getPaySchedule();
  // Anchor month → viewed month → the month after it. `lead` is how many months the anchor sits
  // before the viewed one (0 in the normal case of viewing the current month).
  const anchor = parsePeriodLabel(asOf.slice(0, 7));
  const viewedZero = view.year * 12 + (view.month - 1);
  const anchorZero = anchor ? anchor.year * 12 + (anchor.month - 1) : viewedZero;
  const lead = Math.max(0, viewedZero - anchorZero);
  const chain = Array.from({ length: lead + 2 }, (_, i) => monthOffset(view.year, view.month, i - lead));

  // Cash on hand, each account's balance rolled forward over the transactions it hasn't been
  // told about yet (pending included) — so the anchor is a real number, not a mix of vintages.
  const [rolled, reserved] = await Promise.all([getRolledCashOnHand(asOf), getReservedCash(asOf)]);
  const cashNow = rolled.total ?? view.cash.now;

  const segments: MonthSegment[] = [];
  for (const m of chain) {
    const [period, bills, deposits, pending] = await Promise.all([
      getPeriodByLabel(m.label),
      getProjectionBills(m.label),
      observedPayrollDeposits(m.label, schedule?.depositMatch ?? null),
      pendingOutflows(m.label, asOf),
    ]);
    // The viewed month always gets a segment; the others only once their period sheet exists.
    const isViewed = m.label === view.periodLabel;
    if (!isViewed && !period) continue;
    const own = isViewed ? view : await getBudgetView(m.label);
    // No budget of its own → the viewed month's plan, untouched (actual = 0), as the best guess.
    // Negative ids so a stand-in line never collides with a real one.
    const lines = own ? own.lines : view.lines.map((l) => ({ ...l, actual: 0, id: -l.id }));
    segments.push(
      segmentFor(
        m.label,
        m.year,
        m.month,
        lines,
        bills,
        paydaysFor(schedule, m.year, m.month, own?.plannedIncome ?? view.plannedIncome),
        !own,
        deposits,
        pending,
      ),
    );
  }
  if (!segments.length) return null;

  const projection = projectCash({
    asOf,
    cashNow,
    cashMonthStart: view.cash.start,
    segments,
    debts: view.debts.map((d) => ({ accountId: d.accountId, label: d.label, balance: d.balance, apr: d.apr })),
    focusIndex: segments.findIndex((s) => s.label === view.periodLabel),
    depositWindowDays: schedule?.depositWindowDays ?? undefined,
    reservedCash: reserved.total,
  });

  // Snapshot + trend: only while the month is still running.
  if (projection.spreadDays > 0) {
    const today = todayIso();
    await db
      .insert(projectionSnapshots)
      .values({
        periodId: view.periodId,
        takenOn: today,
        asOf,
        cashNow: String(cashNow),
        endBalance: String(projection.endBalance),
        horizonBalance: String(projection.horizonBalance),
        lowBalance: String(projection.low.balance),
        lowDate: projection.low.date,
        spreadTotal: String(projection.spreadTotal),
        hotEnd: String(projection.debt.hotEnd),
      })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } }); // first write of the day wins
    const snaps = await db
      .select()
      .from(projectionSnapshots)
      .where(eq(projectionSnapshots.periodId, view.periodId))
      .orderBy(asc(projectionSnapshots.takenOn));
    const toT = (r: (typeof snaps)[number]) => ({
      takenOn: r.takenOn,
      endBalance: toNum(r.endBalance) ?? 0,
      horizonBalance: toNum(r.horizonBalance) ?? 0,
      spreadTotal: toNum(r.spreadTotal) ?? 0,
    });
    const weekAgoIso = new Date(Date.parse(today + "T00:00:00Z") - 7 * 86_400_000).toISOString().slice(0, 10);
    const earlier = snaps.filter((r) => r.takenOn < today);
    const weekAgo = [...earlier].reverse().find((r) => r.takenOn <= weekAgoIso) ?? null;
    const trend: ProjectionTrend = {
      first: earlier.length ? toT(earlier[0]) : null,
      weekAgo: weekAgo ? toT(weekAgo) : null,
      count: snaps.length,
      series: snaps.map(toT),
    };
    projection.trend = trend;
  }
  return projection;
}

// ---- Daily cash on hand (within a month) -------------------------------------------------
// The balance ledger, walked day by day: for each day of the month the sum over cash accounts of
// the latest snapshot on/before that day (each account carries its last known figure forward, so
// an account recorded once a week still contributes every day). Stops at the last day any cash
// balance was recorded ≤ month end — the future isn't drawn. `recorded` flags the days a snapshot
// actually landed, so the chart can distinguish "measured" from "carried".
export interface DailyCashPoint {
  date: string;
  total: number;
  recorded: boolean;
  /** Accounts contributing on this day (those with any snapshot on/before it). */
  accounts: number;
}

export async function getDailyCashOnHand(periodLabel: string): Promise<DailyCashPoint[]> {
  await requireSession();
  const parsed = parsePeriodLabel(periodLabel);
  if (!parsed) return [];
  const { start, end } = monthBounds(parsed.year, parsed.month);
  const accts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.accountType, [...CASH_ACCOUNT_TYPES]));
  if (!accts.length) return [];
  const snaps = await db
    .select({ accountId: accountBalances.accountId, balance: accountBalances.balance, asOf: accountBalances.asOf })
    .from(accountBalances)
    .where(and(inArray(accountBalances.accountId, accts.map((a) => a.id)), lte(accountBalances.asOf, end)))
    .orderBy(asc(accountBalances.asOf), asc(accountBalances.id));
  if (!snaps.length) return [];

  const lastRecorded = snaps[snaps.length - 1].asOf;
  const stop = lastRecorded < end ? lastRecorded : end;
  if (stop < start) return [];

  const current = new Map<number, number>();
  let i = 0;
  for (; i < snaps.length && snaps[i].asOf < start; i++) current.set(snaps[i].accountId, toNum(snaps[i].balance) ?? 0);
  const out: DailyCashPoint[] = [];
  for (let t = isoToUtc(start); utcToIso(t) <= stop; t += 86_400_000) {
    const date = utcToIso(t);
    let recorded = false;
    for (; i < snaps.length && snaps[i].asOf === date; i++) {
      current.set(snaps[i].accountId, toNum(snaps[i].balance) ?? 0);
      recorded = true;
    }
    let total = 0;
    for (const v of current.values()) total += v;
    out.push({ date, total: round2(total), recorded, accounts: current.size });
  }
  return out;
}

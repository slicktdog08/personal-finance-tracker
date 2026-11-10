import { getSession } from "@/server/auth/session";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { BarsChart } from "@/components/charts/BarsChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { Badge, Card, EmptyState, Glyph, Money, ProgressBar, StatTile } from "@/components/ds";
import { MonthNav } from "@/components/dashboard/MonthNav";
import { PaydayCountdown } from "@/components/dashboard/PaydayCountdown";
import { SafeToSpend } from "@/components/dashboard/SafeToSpend";
import { ComingUp, type ComingUpMeta } from "@/components/dashboard/ComingUp";
import { AttentionStrip, type AttentionItem } from "@/components/dashboard/AttentionStrip";
import { DebtPayoff } from "@/components/dashboard/DebtPayoff";
import { CardRebalance } from "@/components/dashboard/CardRebalance";
import { NetWorth } from "@/components/dashboard/NetWorth";
import { BudgetCard } from "@/components/dashboard/BudgetCard";
import { CashChartCard } from "@/components/dashboard/CashChartCard";
import { CashAccounts } from "@/components/dashboard/CashAccounts";
import { GoalsCard } from "@/components/dashboard/GoalsCard";
import { CardLink, dayLabel } from "@/components/dashboard/kit";
import { CategoryTrends, type CategoryTrendRow } from "@/components/dashboard/CategoryTrends";
import { DashboardGrid, type DashboardWidget } from "@/components/dashboard/DashboardGrid";
import type { WidgetId } from "@/lib/dashboard-layout";
import {
  getPeriods,
  getInstances,
  getStatusConfig,
  getCashflowByPeriod,
  getCategorySpend,
  getCategoryRows,
  getCashOnHand,
  getLiabilityAccounts,
  getLiabilityStartBalances,
  getBalanceTrends,
  netWorthOf,
  getTopTransactions,
  getUncategorizedCount,
  getAccountSyncInfo,
  getDebtInputs,
  getRecentTransactions,
  getPendingSummary,
  getPendingTransactions,
  getProjectionBills,
  getGoalsWithProgress,
  getPaySchedule,
  getBudgetView,
  getCashProjection,
  getDailyCashOnHand,
  getDashboardLayout,
  type TxnSummary,
} from "@/server/queries";
import { isoToUtc, todayIso, utcToIso } from "@/server/lib/pay-schedule";
import type { CashEvent } from "@/server/lib/cash-projection";
import { isSnowballDebt, projectPayoff } from "@/server/lib/budget";
import { cardRebalanceFrom, rebalancePlans } from "@/server/lib/card-rebalance";
import { ensureCurrentPeriods } from "@/server/periods";
import { formatMoney, toNum } from "@/server/lib/money";
import { monthlyInterest } from "@/server/lib/debt";
import {
  prettyPeriod,
  shortMonthLabel,
  formatDate,
  monthBounds,
  currentPeriodLabel,
  defaultPeriod,
} from "@/server/lib/period";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  let periods, statusConfig, cashflow;
  try {
    // This month and next always exist — cloned from the last month with bills when missing.
    await ensureCurrentPeriods();
    [periods, statusConfig, cashflow] = await Promise.all([
      getPeriods(), // newest first
      getStatusConfig(),
      getCashflowByPeriod(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  if (!periods.length) {
    return (
      <EmptyState
        icon="calendar"
        title="No months yet"
        body={
          <>
            Run <code>npm run seed</code> or create a month.
          </>
        }
      />
    );
  }

  const sp = await searchParams;
  const wanted = one(sp.period);
  // "Today" is resolved once per render so the default month and the payday countdown can't
  // disagree about what day it is.
  const today = todayIso();
  const currentLabel = currentPeriodLabel(today);
  const selected = periods.find((p) => p.label === wanted) ?? defaultPeriod(periods, today);
  const isCurrentMonth = selected.label === currentLabel;

  const settledSet = new Set(statusConfig.filter((s) => s.isSettled).map((s) => s.name));
  const colorOf = new Map(statusConfig.map((s) => [s.name, s.color]));
  const orderOf = new Map(statusConfig.map((s, i) => [s.name, i]));
  // The user's own "Past Due" color, for the Next 7 days badge — falls back to rose in ComingUp.
  const pastDueColor = statusConfig.find((s) => /past\s*due/i.test(s.name))?.color ?? null;

  // Cash on hand reflects the balances recorded as of the END of the selected month,
  // so viewing a past month shows what the balances were back then (snapshots are historical).
  const { start: monthStart, end: monthEnd } = monthBounds(selected.year, selected.month);
  const [
    selInstances,
    catSpend,
    topTxns,
    recentTxns,
    cashAccounts,
    liabilities,
    catRows,
    allBalanceTrends,
    goals,
    paySchedule,
    budget,
    dailyCash,
    pendingSummary,
    uncategorizedCount,
    syncInfo,
    debtInputs,
    pendingTxns,
    projectionBills,
    layout,
    liabilityStart,
  ] = await Promise.all([
    getInstances(selected.id),
    getCategorySpend(selected.label),
    getTopTransactions(selected.label),
    getRecentTransactions(selected.label, 8),
    getCashOnHand(monthEnd),
    getLiabilityAccounts(monthEnd),
    getCategoryRows(),
    getBalanceTrends(),
    getGoalsWithProgress(monthEnd),
    getPaySchedule(),
    getBudgetView(selected.label),
    getDailyCashOnHand(selected.label),
    getPendingSummary(selected.label),
    getUncategorizedCount(),
    getAccountSyncInfo(),
    getDebtInputs(monthEnd),
    getPendingTransactions(),
    // Bill statuses for the past-due chip — only "now" has a past due.
    isCurrentMonth ? getProjectionBills(selected.label) : Promise.resolve([]),
    getDashboardLayout(),
    // Card balances as the month began — the rebalance widget measures today against them.
    isCurrentMonth ? getLiabilityStartBalances(monthStart, today) : Promise.resolve(null),
  ]);
  // The last six months up to the one viewed, for the category small multiples. The viewed month's
  // spend is already in hand; the rest are one query each.
  const trendLabels = periods
    .filter((p) => p.label <= selected.label)
    .slice(0, 6)
    .map((p) => p.label)
    .reverse();
  const spendByMonth = await Promise.all(
    trendLabels.map((l) => (l === selected.label ? Promise.resolve(catSpend) : getCategorySpend(l))),
  );
  const activeGoals = goals.filter((g) => g.status !== "archived");
  // Cash projection needs a budget AND a recorded cash balance; shown only while the month is
  // still running (a finished month has nothing left to project).
  const cashProjection = budget ? await getCashProjection(budget) : null;
  // One widget for the month's cash: the ledger's day-by-day so far, joined to the projection.
  const showCashMonth = dailyCash.length >= 2 || (!!cashProjection && cashProjection.spreadDays > 0);
  const catEmojiOf = new Map(catRows.map((c) => [c.name, c.emoji]));
  const catColorOf = new Map(catRows.map((c) => [c.name, c.color]));

  // Credit cards and loans are both liability accounts — split by type so each is counted once.
  const creditAccounts = liabilities.filter((a) => a.accountType === "Credit");
  const loanAccounts = liabilities.filter((a) => a.accountType === "Loan");

  // ---- Cash on hand (as of end of selected month) ----
  // Every cash-type account, the wallet included — getCashOnHand already returns exactly those
  // (CASH_ACCOUNT_TYPES), and the sparkline below sums the same set, so the headline and its own
  // trend line must not be built from a different list.
  const sumCash = (type: string) =>
    cashAccounts
      .filter((a) => a.accountType === type)
      .reduce((s, a) => s + (toNum(a.balance) ?? 0), 0);
  const checkingTotal = sumCash("Checking");
  const savingsTotal = sumCash("Savings");
  const walletTotal = sumCash("Cash");
  const hasWallet = cashAccounts.some((a) => a.accountType === "Cash");
  const cashTotal = cashAccounts.reduce((s, a) => s + (toNum(a.balance) ?? 0), 0);
  const hasRecordedCash = cashAccounts.some((a) => a.balance != null);
  // Freshest snapshot date actually contributing — shows how current the balances are.
  const cashAsOf = cashAccounts.reduce<string | null>(
    (m, a) => (a.asOf && (!m || a.asOf > m) ? a.asOf : m),
    null,
  );

  // ---- Cash by account: where the money actually sits ----
  // Goals backed by a cash account hold part of its balance (the reality-checked `backed`, so a
  // goal can't reserve money the account doesn't have) — shown per account so "the savings account
  // has $4k" doesn't read as $4k free to spend.
  const reservedBy = new Map<number, number>();
  for (const g of activeGoals) {
    if (g.fundingAccountId != null && g.backed > 0)
      reservedBy.set(g.fundingAccountId, (reservedBy.get(g.fundingAccountId) ?? 0) + g.backed);
  }
  const cashByAccount = cashAccounts
    .map((a) => {
      const balance = toNum(a.balance);
      const reserved = Math.min(reservedBy.get(a.id) ?? 0, Math.max(0, balance ?? 0));
      return {
        id: a.id,
        name: a.label || a.institution || `··${a.accountNumber.slice(-4)}`,
        type: a.accountType,
        sub: [a.accountType === "Cash" ? "Pocket" : a.accountType, a.accountNumber && a.accountType !== "Cash" ? `··${a.accountNumber.slice(-4)}` : null]
          .filter(Boolean)
          .join(" "),
        balance,
        reserved,
        active: a.active,
      };
    })
    // A closed account with nothing in it is history, not a place money sits.
    .filter((a) => a.active || (a.balance ?? 0) !== 0)
    .sort((a, b) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity));
  const funded = cashByAccount.filter((a) => (a.balance ?? 0) > 0);

  // ---- Credit standing (as of end of selected month): balance owed vs limit + interest ----
  const creditOwed = creditAccounts.reduce((s, a) => s + (toNum(a.balance) ?? 0), 0);
  const creditLimitTotal = creditAccounts.reduce((s, a) => s + (toNum(a.creditLimit) ?? 0), 0);
  const creditAvailable = creditLimitTotal - creditOwed;
  const creditUtil = creditLimitTotal > 0 ? (creditOwed / creditLimitTotal) * 100 : null;
  const creditInterest = creditAccounts.reduce(
    (s, a) => s + (monthlyInterest(toNum(a.balance), toNum(a.apr)) ?? 0),
    0,
  );
  const creditMinPayment = creditAccounts.reduce((s, a) => s + (toNum(a.minPayment) ?? 0), 0);
  const hasRecordedCredit = creditAccounts.some((a) => a.balance != null);
  const creditAsOf = creditAccounts.reduce<string | null>(
    (m, a) => (a.asOf && (!m || a.asOf > m) ? a.asOf : m),
    null,
  );

  // ---- Card rebalance (current month): what each card has grown by since the month began ----
  // Today's balance plus its pending activity vs. the one the month started at — or, once the
  // budget's payoff payment is made, vs. the balance the plan leaves (same rule as /budget).
  // The posted balance alone lags spending until pending charges settle.
  const rebalance = liabilityStart
    ? cardRebalanceFrom(creditAccounts, liabilityStart, pendingTxns, rebalancePlans(budget?.lines ?? []))
    : null;

  // ---- Loans (as of end of selected month): balance owed + interest + min payment ----
  let debtOwed = 0;
  let debtMonthlyInterest = 0;
  let debtMinPayment = 0;
  const hasRecordedDebt = loanAccounts.some((d) => d.balance != null);
  for (const d of loanAccounts) {
    const bal = toNum(d.balance);
    if (bal != null) debtOwed += Math.max(0, bal);
    const mi = monthlyInterest(bal, toNum(d.apr));
    if (mi != null) debtMonthlyInterest += mi;
    debtMinPayment += toNum(d.minPayment) ?? 0;
  }
  const debtAsOf = loanAccounts.reduce<string | null>(
    (m, d) => (d.asOf && (!m || d.asOf > m) ? d.asOf : m),
    null,
  );

  // ---- Trend sparklines (all months up to today; selected month highlighted) ----
  // Periods run ahead of the calendar (next month is pre-created, budgets can reach further), and
  // each just repeats today's balances — a flat tail that says nothing, so the lines stop at now.
  const balanceTrends = allBalanceTrends.filter((t) => currentLabel == null || t.label <= currentLabel);
  // balanceTrends is oldest→newest, so its index lines up with the sparkline's x-axis.
  const trendHi = balanceTrends.findIndex((t) => t.label === selected.label);
  const cashTrend = balanceTrends.map((t) => ({ label: shortMonthLabel(t.label), value: t.cash }));
  const creditTrend = balanceTrends.map((t) => ({ label: shortMonthLabel(t.label), value: t.credit }));
  const loanTrend = balanceTrends.map((t) => ({ label: shortMonthLabel(t.label), value: t.loans }));
  // Only worth drawing a trend line once ≥2 months carry a value.
  const hasTrend = (pts: { value: number | null }[]) => pts.filter((p) => p.value != null).length > 1;

  // ---- Selected-month stats ----
  const billed = selInstances.reduce((s, i) => s + (toNum(i.amount) ?? 0), 0);
  const paid = selInstances.reduce(
    (s, i) => s + (settledSet.has(i.status) ? toNum(i.amount) ?? 0 : 0),
    0,
  );
  const outstanding = billed - paid;

  const selFlow = cashflow.filter((c) => c.label === selected.label);
  const income = selFlow
    .filter((c) => c.direction === "Credit")
    .reduce((s, c) => s + (toNum(c.total) ?? 0), 0);
  const outgoing = selFlow
    .filter((c) => c.direction === "Debit")
    .reduce((s, c) => s + (toNum(c.total) ?? 0), 0);

  // ---- Bill status bar (selected month) ----
  const statusCounts = new Map<string, number>();
  for (const i of selInstances) statusCounts.set(i.status, (statusCounts.get(i.status) ?? 0) + 1);
  const donut = [...statusCounts.entries()]
    .map(([label, value]) => ({ label, value, color: colorOf.get(label) ?? "#9ca3af" }))
    .sort((a, b) => (orderOf.get(a.label) ?? 99) - (orderOf.get(b.label) ?? 99));
  const settledCount = selInstances.filter((i) => settledSet.has(i.status)).length;

  // ---- Income vs outgoing per month ----
  const flowMap = new Map<string, { label: string; income: number; outgoing: number }>();
  for (const c of cashflow) {
    const f = flowMap.get(c.label) ?? { label: c.label, income: 0, outgoing: 0 };
    if (c.direction === "Credit") f.income += toNum(c.total) ?? 0;
    else f.outgoing += toNum(c.total) ?? 0;
    flowMap.set(c.label, f);
  }
  const flows = [...flowMap.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
  const flowsHi = flows.findIndex((f) => f.label === selected.label);

  // ---- Income vs outgoing (selected month) ----
  const maxFlow = Math.max(income, outgoing, 1);

  // ---- Category spend (selected month) ----
  // Spent and budgeted are both dollars, so they share one ruler: every row is drawn on a single
  // scale set by the largest figure in the panel, plan or actual. A budgeted row is an ENVELOPE
  // (the plan, as a light tint) with a solid fill inside it (what's spent); overspend pushes the
  // solid past the envelope in red. That gives both readings at once without a second unit — bar
  // lengths compare across rows for "where did the money go", and how full each envelope is says
  // "how far into the budget". Earlier attempts scaled per row or added a percentage, and each
  // one broke one of those two readings. Bullet chart, in other words.
  //
  // Planned comes from the budget's category lines; actuals stay on catSpend, the same source
  // getBudgetView feeds its own lines from, so no two panels on this page can disagree about what
  // a category cost.
  const plannedBy = new Map(
    (budget?.lines ?? [])
      .filter((l) => l.kind === "category" && l.category)
      .map((l) => [l.category as string, l.planned] as const),
  );
  const spentBy = new Map(catSpend.map((c) => [c.category ?? "", toNum(c.total) ?? 0]));
  // A budget earns its untouched categories a row — an empty envelope at the bottom is the
  // "big bill, not paid yet" signal — so the key set widens only when there's a plan to show.
  const categories = [
    ...new Set(budget ? [...spentBy.keys(), ...plannedBy.keys()] : spentBy.keys()),
  ]
    .map((key) => ({
      name: key || "Uncategorized",
      raw: key || null,
      total: spentBy.get(key) ?? 0,
      planned: plannedBy.get(key) ?? null,
    }))
    .filter((c) => c.total > 0 || (c.planned ?? 0) > 0)
    .sort((a, b) => b.total - a.total || (b.planned ?? 0) - (a.planned ?? 0))
    // Those extra rows need extra room; without a budget this is the plain top ten it always was.
    .slice(0, budget ? 16 : 10);
  // The ruler. Largest plan OR actual, so no envelope and no bar can run off the end.
  const scale = Math.max(...categories.map((c) => Math.max(c.total, c.planned ?? 0)), 1);

  // The three segments of a row, as percentages of the track. `unspent` is measured from the
  // solid's actual edge (not the raw spend) so the envelope's right end lands exactly on the plan
  // even when the solid has been widened to its minimum visible sliver.
  const segmentsOf = (c: { total: number; planned: number | null }) => {
    const pct = (n: number) => (n / scale) * 100;
    const planned = c.planned != null && c.planned > 0 ? c.planned : null;
    const solid = Math.max(c.total > 0 ? 2 : 0, pct(planned != null ? Math.min(c.total, planned) : c.total));
    return {
      solid,
      unspent: planned != null ? Math.max(0, pct(planned) - solid) : 0,
      over: planned != null && c.total > planned ? pct(c.total - planned) : 0,
    };
  };

  // Link a category row to its transactions for this month (no category → "uncategorized only").
  const categoryHref = (raw: string | null) => {
    const params = new URLSearchParams({ period: selected.label });
    if (raw) params.set("category", raw);
    else params.set("uncat", "1");
    return `/transactions?${params.toString()}`;
  };

  const selPretty = prettyPeriod(selected.year, selected.month);

  const pendingDebits = pendingTxns.filter((t) => t.direction === "Debit").reduce((s, t) => s + (toNum(t.amount) ?? 0), 0);
  const pendingCredits = pendingTxns.filter((t) => t.direction === "Credit").reduce((s, t) => s + (toNum(t.amount) ?? 0), 0);

  // ---- Today's band: safe to spend + the next week (current month only, needs a projection) ----
  const projecting = isCurrentMonth && !!cashProjection && cashProjection.spreadDays > 0;
  const weekOut = utcToIso(isoToUtc(today) + 7 * 86_400_000);

  // ---- Needs attention: housekeeping that skews the numbers, each linked to where it's fixed ----
  const attention: AttentionItem[] = [];
  // What the Next 7 days rows know about the bill behind each event — status (for the glyph color
  // and the past-due / pending badge) and payment type — keyed by the event's label.
  const comingMeta: Record<string, ComingUpMeta> = {};
  if (projecting && cashProjection) {
    // A past-due bill already marked Pending (or Autopay Pending) is money in flight, not a missed
    // payment — it gets its own quieter chip so the red one only counts what really needs doing.
    // Events carry labels, not ids: a bill event is the bill's name, a debt event is its budget
    // line's label + " payment", reached through the line's account.
    const statusByBill = new Map(projectionBills.filter((b) => b.accountId == null).map((b) => [b.name, b.status]));
    const statusByAccount = new Map(projectionBills.filter((b) => b.accountId != null).map((b) => [b.accountId!, b.status]));
    const debtLineAccount = new Map(
      (budget?.lines ?? []).filter((l) => l.kind === "debt" && l.accountId != null).map((l) => [`${l.label} payment`, l.accountId!]),
    );
    const statusOf = (e: CashEvent) =>
      e.kind === "bill" ? statusByBill.get(e.label) : statusByAccount.get(debtLineAccount.get(e.label) ?? -1);
    const overdue = cashProjection.events.filter((e) => e.overdue && (e.kind === "bill" || e.kind === "debt"));
    const inFlight = overdue.filter((e) => /pending/i.test(statusOf(e) ?? ""));
    const pastDue = overdue.filter((e) => !inFlight.includes(e));
    const sumOut = (es: CashEvent[]) => es.reduce((t, e) => t - e.amount, 0);
    if (pastDue.length)
      attention.push({
        key: "overdue",
        label: `${pastDue.length} past due`,
        amount: sumOut(pastDue),
        href: `/months/${selected.label}`,
        tone: "red",
      });
    if (inFlight.length)
      attention.push({
        key: "overdue-pending",
        label: `${inFlight.length} bill${inFlight.length === 1 ? "" : "s"} in flight`,
        amount: sumOut(inFlight),
        href: `/months/${selected.label}`,
        tone: "pending",
      });
    const paymentTypeOf = new Map(selInstances.map((i) => [i.name, i.paymentType]));
    for (const e of cashProjection.events) {
      if (e.kind !== "bill" && e.kind !== "debt") continue;
      const status = statusOf(e) ?? null;
      comingMeta[e.label] = {
        status,
        statusColor: status ? (colorOf.get(status) ?? null) : null,
        paymentType: e.kind === "bill" ? (paymentTypeOf.get(e.label) ?? null) : null,
      };
    }
    for (const m of cashProjection.paydays.filter((m) => !m.complete && m.date < today))
      attention.push({ key: `payday-${m.date}`, label: `${formatDate(m.date)} payday not matched`, href: "/settings/pay-schedule", tone: "amber" });
    const focus = cashProjection.months[cashProjection.focusIndex];
    if (focus && focus.unbudgetedBills.length)
      attention.push({
        key: "unbudgeted-bills",
        label: `${focus.unbudgetedBills.length} bill${focus.unbudgetedBills.length === 1 ? "" : "s"} without an envelope`,
        href: "/settings/bills",
        tone: "amber",
      });
  }
  // Authorized at the bank, not settled — about now, so only beside the current month.
  if (isCurrentMonth && pendingTxns.length)
    attention.push({ key: "pending-txns", label: `${pendingTxns.length} pending`, amount: pendingDebits, href: "/transactions?pending=1", tone: "pending" });
  if (budget && budget.unplannedSpend.total > 0)
    attention.push({
      key: "unplanned",
      label: "Outside the budget",
      amount: budget.unplannedSpend.total,
      href: `/budget?period=${selected.label}`,
      tone: "amber",
    });
  if (uncategorizedCount > 0)
    attention.push({ key: "uncat", label: `${uncategorizedCount} to categorize`, href: "/transactions/categorize", tone: "info" });
  for (const g of activeGoals.filter((g) => g.shortfall > 0))
    attention.push({ key: `goal-${g.id}`, label: `${g.name} short`, amount: g.shortfall, href: "/goals", tone: "amber" });
  // Last bank sync — shown in the header always; its health chips only on the current month.
  const feeds = [...syncInfo.values()].filter((f) => f.enabled);
  const lastSync = feeds.reduce<number | null>((m, f) => (f.lastSyncedAt && (m == null || f.lastSyncedAt.getTime() > m) ? f.lastSyncedAt.getTime() : m), null);
  // Rendered per request (force-dynamic), so reading the clock here is the point, not a leak.
  // eslint-disable-next-line react-hooks/purity
  const minutesSinceSync = lastSync != null ? (Date.now() - lastSync) / 60_000 : null;
  if (isCurrentMonth) {
    if (feeds.some((f) => f.enrollmentStatus !== "active"))
      attention.push({ key: "sync-conn", label: "Bank connection needs attention", href: "/settings/sync", tone: "red" });
    if (feeds.length && (minutesSinceSync == null || minutesSinceSync > 36 * 60))
      attention.push({
        key: "sync-stale",
        label: minutesSinceSync == null ? "Bank sync hasn't run" : `Last bank sync ${Math.floor(minutesSinceSync / 1440)}d ago`,
        href: "/settings/sync",
        tone: "amber",
      });
  }

  // ---- Debt payoff: high-interest debt, avalanche order, at this month's planned rate ----
  const hotDebts = debtInputs.filter(isSnowballDebt);
  const hotIds = new Set(hotDebts.map((d) => d.accountId));
  const plannedHot = (budget?.lines ?? [])
    .filter((l) => l.kind === "debt" && l.accountId != null && hotIds.has(l.accountId))
    .reduce((t, l) => t + l.planned, 0);
  const payRate = plannedHot > 0 ? plannedHot : hotDebts.reduce((t, d) => t + (d.minPayment ?? 0), 0);
  const payoff =
    hotDebts.length && payRate > 0
      ? projectPayoff({ debts: debtInputs, strategy: "avalanche", monthlyBudget: payRate, startYear: selected.year, startMonth: selected.month })
      : null;
  const hotNow = cashProjection?.debt.hotNow ?? hotDebts.reduce((t, d) => t + d.balance, 0);
  const allDebtNow = cashProjection?.debt.allNow ?? creditOwed + debtOwed;
  const debtInterest = cashProjection?.debt.interest ?? creditInterest + debtMonthlyInterest;

  // ---- Net worth: cash minus everything owed, per month ----
  // A month only counts once every kind of balance it's made of has been recorded. Card and loan
  // balances started being tracked months after cash, and treating "not recorded yet" as $0 owed
  // drew those early months as a small positive net worth — so the line appeared to crash when
  // the debts first showed up, even while they were being paid down.
  const netTrend = balanceTrends.map((t) => ({
    label: shortMonthLabel(t.label),
    value:
      t.cash == null || (hasRecordedCredit && t.credit == null) || (hasRecordedDebt && t.loans == null)
        ? null
        : netWorthOf(t),
  }));
  // Retirement + assets as of the selected month's end (the same as-of rule as the cards above).
  const selTrend = allBalanceTrends.find((t) => t.label === selected.label);
  const retirementNow = selTrend?.retirement ?? 0;
  const assetsNow = selTrend?.assets ?? 0;
  const netNow = cashTotal + retirementNow + assetsNow - creditOwed - debtOwed;
  const netPrev = trendHi > 0 ? netTrend[trendHi - 1].value : null;

  // ---- Category small multiples: the six biggest categories over the trailing months ----
  const spendMaps = spendByMonth.map((rows) => new Map(rows.map((r) => [r.category ?? "", toNum(r.total) ?? 0])));
  const sixMonthTotal = new Map<string, number>();
  for (const m of spendMaps) for (const [k, v] of m) sixMonthTotal.set(k, (sixMonthTotal.get(k) ?? 0) + v);
  const categoryTrends: CategoryTrendRow[] =
    trendLabels.length < 2
      ? []
      : [...sixMonthTotal.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([key]) => {
            const values = spendMaps.map((m) => m.get(key) ?? 0);
            const earlier = values.slice(0, -1).filter((v) => v > 0);
            return {
              key: key || "uncat",
              name: key || "Uncategorized",
              emoji: key ? catEmojiOf.get(key) ?? null : null,
              color: key ? catColorOf.get(key) ?? null : null,
              href: categoryHref(key || null),
              points: trendLabels.map((l, i) => ({ label: shortMonthLabel(l), value: values[i] })),
              current: values[values.length - 1],
              avg: earlier.length ? earlier.reduce((t, v) => t + v, 0) / earlier.length : null,
            };
          })
          // Picked by six-month weight, listed by the figure each row shows.
          .sort((a, b) => b.current - a.current);
  // "Good morning, <name>" in the household timezone (the server may run in UTC).
  const session = await getSession();
  const firstName = session?.name?.trim().split(/\s+/)[0];
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" }).format(now));
  const greeting = {
    text: `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${firstName ? `, ${firstName}` : ""}`,
    date: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }).format(now),
  };
  const navPeriods = [...periods]
    .map((p) => ({ label: p.label, pretty: prettyPeriod(p.year, p.month) }))
    .reverse(); // oldest -> newest

  // Every panel is a widget the user can move and resize (DashboardGrid). The default arrangement
  // (DEFAULT_LAYOUT) follows the MiPlata hierarchy: Safe to spend → payday → the forward look →
  // is it going down? → where the cash is → then the detail panels. A widget whose data doesn't
  // apply this time is simply not pushed, and the grid closes the gap.
  const widgets: DashboardWidget[] = [];
  // Phone widths (half / full) are the phone layout's business — see MOBILE_HALF in dashboard-layout.
  const add = (id: WidgetId, title: string, node: React.ReactNode) => widgets.push({ id, title, node });

  if (attention.length) add("attention", "Needs attention", <AttentionStrip items={attention} />);

  // 1 · The hero, and payday beside it.
  if (projecting && cashProjection) add("safe-to-spend", "Safe to spend", <SafeToSpend projection={cashProjection} />);
  // Payday speaks about right now, never about the month being viewed — so it's hidden on any
  // other month rather than showing a "next paycheck" unrelated to the screen.
  if (isCurrentMonth) add("payday", "Payday", <PaydayCountdown schedule={paySchedule} today={today} />);

  // What the cards have grown by since the 1st — about today, so only on the current month.
  if (rebalance && (rebalance.rows.length || rebalance.missing.length))
    add(
      "card-rebalance",
      "Owed to cards",
      <Card title="Owed to cards" action={<CardLink href="/debts">Debts</CardLink>}>
        <CardRebalance data={rebalance} />
      </Card>,
    );

  // 2 · The forward look: what's about to move, and where cash is heading.
  if (projecting && cashProjection)
    add(
      "next-7-days",
      "Next 7 days",
      <Card title="Next 7 days" meta={`through ${dayLabel(weekOut)}`} action={<CardLink href={`/months/${selected.label}`}>All bills</CardLink>}>
        <ComingUp
          events={cashProjection.events}
          from={cashProjection.asOf}
          through={weekOut}
          dailySpend={cashProjection.spreadDaily}
          meta={comingMeta}
          pastDueColor={pastDueColor}
          href={`/months/${selected.label}`}
        />
      </Card>,
    );
  if (showCashMonth)
    add(
      "cash-month",
      "Cash this month",
      <CashChartCard daily={dailyCash} projection={cashProjection} periodLabel={selected.label} lines={budget?.lines ?? []} unplanned={budget?.unplannedSpend} today={today} />,
    );

  // 3 · Is it going down? Debt, the month's budget, net worth.
  if (hotNow > 0 || allDebtNow > 0)
    add(
      "debt-payoff",
      "Debt payoff",
      <Card title="Debt payoff" action={<CardLink href="/debts">Debts</CardLink>}>
        <DebtPayoff
          hotNow={hotNow}
          hotEnd={cashProjection && isCurrentMonth ? cashProjection.debt.hotEnd : null}
          allNow={allDebtNow}
          interest={debtInterest}
          paying={payRate}
          debtFreeOn={payoff?.debtFreeOn ?? null}
          months={payoff?.months ?? null}
          stalls={payoff?.stalls ?? false}
          periodLabel={selected.label}
        />
      </Card>,
    );
  add(
    "budget",
    "Budget",
    <Card title={isCurrentMonth ? "This month's budget" : `${selPretty} budget`} action={<CardLink href={`/budget?period=${selected.label}`}>Budget</CardLink>}>
      <BudgetCard view={budget} periodLabel={selected.label} pretty={selPretty} today={today} />
    </Card>,
  );
  if (hasRecordedCash)
    add(
      "net-worth",
      "Net worth",
      <Card title="Net worth" meta={cashAsOf ? dayLabel(cashAsOf) : undefined}>
        <NetWorth
          now={netNow}
          prev={netPrev}
          prevLabel={trendHi > 0 ? shortMonthLabel(balanceTrends[trendHi - 1].label).replace(/ '\d\d$/, "") : null}
          cash={cashTotal}
          retirement={retirementNow}
          assets={assetsNow}
          credit={creditOwed}
          loans={debtOwed}
          trend={netTrend}
          highlightIndex={trendHi}
        />
      </Card>,
    );

  // 4 · Where the cash sits, and what it's saved toward.
  if (funded.length > 0)
    add(
      "cash-accounts",
      "Where your cash is",
      <Card title="Where your cash is" action={<CardLink href="/accounts">Accounts</CardLink>}>
        <CashAccounts
          accounts={funded.map((a) => ({ id: a.id, name: a.name, type: a.type, sub: a.sub, balance: a.balance ?? 0, reserved: a.reserved }))}
        />
      </Card>,
    );
  if (activeGoals.length > 0)
    add(
      "goals",
      "Savings goals",
      <Card title="Savings goals" action={<CardLink href="/goals">Goals</CardLink>}>
        <GoalsCard goals={activeGoals.slice(0, 6)} />
      </Card>,
    );

  // 5 · The standing balances, each with its month-by-month line. Two-up on a phone.
  add(
    "cash",
    "Cash on hand",
    <StandingTile
      label="Cash on hand"
      icon="wallet"
      kind="neutral"
      value={hasRecordedCash ? cashTotal : null}
      caption={
        hasRecordedCash ? (
          <>as of {dayLabel(cashAsOf)}</>
        ) : (
          <Link href="/accounts" className="text-accent-text hover:underline">
            Record balances
          </Link>
        )
      }
      stats={
        hasRecordedCash
          ? [
              { label: "Checking", value: checkingTotal },
              { label: "Savings", value: savingsTotal },
              ...(hasWallet ? [{ label: "Pocket", value: walletTotal }] : []),
            ]
          : []
      }
      trend={hasRecordedCash && hasTrend(cashTrend) ? cashTrend : null}
      trendColor="var(--mp-accent)"
      trendHi={trendHi}
    />,
  );
  if (creditAccounts.length > 0)
    add(
      "credit",
      "Credit cards owed",
      <StandingTile
        label="Credit cards owed"
        icon="credit-card"
        kind="owed"
        value={hasRecordedCredit ? creditOwed : null}
        caption={
          hasRecordedCredit ? (
            <>
              {creditUtil != null && (
                <>
                  {creditUtil.toFixed(0)}% of <Money value={creditLimitTotal} kind="neutral" whole />
                </>
              )}
              {creditAsOf && <> · {dayLabel(creditAsOf)}</>}
            </>
          ) : (
            <Link href="/debts" className="text-accent-text hover:underline">
              Record balances
            </Link>
          )
        }
        stats={
          hasRecordedCredit
            ? [
                { label: "Available", value: creditAvailable },
                ...(creditInterest > 0 ? [{ label: "Interest/mo", value: creditInterest, warn: true }] : []),
                ...(creditMinPayment > 0 ? [{ label: "Min/mo", value: creditMinPayment }] : []),
              ]
            : []
        }
        trend={hasRecordedCredit && hasTrend(creditTrend) ? creditTrend : null}
        trendColor="var(--mp-money-owed)"
        trendHi={trendHi}
      />,
    );
  if (loanAccounts.length > 0)
    add(
      "loans",
      "Loans outstanding",
      <StandingTile
        label="Loans outstanding"
        icon="graduation-cap"
        kind="owed"
        value={hasRecordedDebt ? debtOwed : null}
        caption={
          hasRecordedDebt ? (
            <>
              {loanAccounts.length} loan{loanAccounts.length === 1 ? "" : "s"}
              {debtAsOf && <> · {dayLabel(debtAsOf)}</>}
            </>
          ) : (
            <Link href="/debts" className="text-accent-text hover:underline">
              Record balances
            </Link>
          )
        }
        stats={
          hasRecordedDebt
            ? [
                ...(debtMonthlyInterest > 0 ? [{ label: "Interest/mo", value: debtMonthlyInterest, warn: true }] : []),
                ...(debtMinPayment > 0 ? [{ label: "Min/mo", value: debtMinPayment }] : []),
              ]
            : []
        }
        trend={hasRecordedDebt && hasTrend(loanTrend) ? loanTrend : null}
        trendColor="var(--mp-money-owed)"
        trendHi={trendHi}
      />,
    );

  // 6 · What just happened, beside how the month is going. Pending and recent share one widget so
  // they stack in a column beside "This month", the way they always have.
  add(
    "activity",
    "Pending & recent transactions",
    <div className="flex flex-col gap-4">
      {/* Authorized at the bank, not settled yet — every one, whichever month is being viewed,
          because pending is about now. */}
      {pendingTxns.length > 0 && (
        <Card
          title="Pending"
          meta={
            <>
              {pendingTxns.length} · <Money value={-pendingDebits} kind="muted" />
              {pendingCredits > 0 && (
                <>
                  {" · "}
                  <Money value={pendingCredits} kind="income" sign="always" />
                </>
              )}
            </>
          }
          action={<CardLink href="/transactions?pending=1">View all</CardLink>}
        >
          <TxnList txns={pendingTxns} mobileLimit={5} showAccount hidePendingBadge empty="Nothing pending." />
        </Card>
      )}
      <Card
        className="flex-1"
        title="Recent transactions"
        meta={selPretty}
        action={
          <span className="flex items-center gap-2">
            {pendingSummary.count > 0 && (
              <Link href={`/transactions?period=${selected.label}&pending=1`} title="Authorized at the bank but not settled yet" className="max-sm:hidden">
                <Badge variant="pending" size="sm" label={`${pendingSummary.count} pending · −${formatMoney(pendingSummary.debits)}`} />
              </Link>
            )}
            <CardLink href={`/transactions?period=${selected.label}`}>View all</CardLink>
          </span>
        }
      >
        <TxnList txns={recentTxns} mobileLimit={5} empty={`No transactions for ${selPretty}.`} />
      </Card>
    </div>,
  );

  add(
    "this-month",
    "This month",
    <Card title="This month" meta={selPretty} action={<CardLink href={`/months/${selected.label}`}>Bills</CardLink>}>
      <div className="space-y-5">
        {/* Money in vs out, and what's left of it. */}
        {income === 0 && outgoing === 0 ? (
          <p className="text-sm text-fg-3">No transactions recorded for {selPretty} yet.</p>
        ) : (
          <div className="space-y-2.5">
            {[
              { label: "In", value: income, color: "var(--mp-money-income)", dir: "Credit" },
              { label: "Out", value: outgoing, color: "var(--mp-text-2)", dir: "Debit" },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <Link
                  href={`/transactions?period=${selected.label}&direction=${r.dir}&sort=amount&dir=desc`}
                  className="w-8 text-xs text-accent-text hover:underline"
                  title={`Biggest ${r.label === "In" ? "deposits" : "charges"} first`}
                >
                  {r.label}
                </Link>
                <ProgressBar value={Math.max(maxFlow * 0.02, r.value)} max={maxFlow} color={r.color} className="flex-1" label={`Money ${r.label.toLowerCase()}`} />
                <Money value={r.value} kind="neutral" className="w-24 text-right text-sm" />
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-xs text-fg-3">Net</span>
              <Money value={income - outgoing} sign="always" kind={income - outgoing >= 0 ? "income" : "over"} className="text-lg font-semibold" />
            </div>
          </div>
        )}

        {/* Bills — every status as one segmented bar. */}
        <div className="border-t border-line pt-4">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>
              <span className="font-semibold">{settledCount}</span>
              <span className="text-fg-2"> of {selInstances.length} bills settled</span>
            </span>
            {outstanding > 0 ? (
              <span className="font-medium text-warn">
                <Money value={outstanding} kind="neutral" /> due
              </span>
            ) : (
              <span className="text-fg-3">All paid</span>
            )}
          </div>
          {selInstances.length > 0 && (
            <>
              <ProgressBar
                size="sm"
                className="mt-2"
                max={selInstances.length}
                segments={donut.map((d) => ({ value: d.value, color: `oklch(from ${d.color} var(--mp-tint-dot-l) c h)` }))}
                label="Bills by status"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {donut.map((d) => (
                  <Badge key={d.label} size="sm" variant="solid" color={d.color} label={`${d.label} ${d.value}`} />
                ))}
              </div>
            </>
          )}
          <div className="mt-2 text-xs text-fg-3">
            <Money value={paid} kind="neutral" /> paid of <Money value={billed} kind="neutral" /> billed
          </div>
        </div>
      </div>
    </Card>,
  );

  // 7 · Where the money went and, once a budget exists, how full each envelope is.
  add(
    "category-spend",
    "Spend by category",
    <Card
      title="Spend by category"
      meta={selPretty}
      action={
        <span className="flex items-center gap-3 text-xs text-fg-3 whitespace-nowrap">
          {budget && (
            <span className="hidden sm:flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span aria-hidden className="inline-block h-2 w-3 rounded-sm bg-fg-3" /> spent
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="inline-block h-2 w-3 rounded-sm bg-fg-3 opacity-30" /> budget left
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="inline-block h-2 w-3 rounded-sm bg-over" /> over
              </span>
            </span>
          )}
          {budget && <CardLink href={`/budget?period=${selected.label}`}>Budget</CardLink>}
        </span>
      }
    >
      {categories.length === 0 ? (
        <p className="text-sm text-fg-3">No transactions for {selPretty}.</p>
      ) : (
        <div className="space-y-1">
          {categories.map((c, i) => (
            <CategoryRow
              key={c.name}
              mobileHidden={i >= 6}
              name={c.name}
              href={categoryHref(c.raw)}
              emoji={c.raw ? catEmojiOf.get(c.raw) : null}
              color={c.raw ? catColorOf.get(c.raw) : null}
              total={c.total}
              planned={c.planned}
              segments={segmentsOf(c)}
              // Without a budget there are no envelopes to imply the scale, so the classic
              // full-width track stays and the panel looks exactly as it always has.
              track={!budget}
              withPlan={!!budget}
            />
          ))}
          {categories.length > 6 && (
            <Link href={`/budget?period=${selected.label}`} className="sm:hidden block pt-1 text-xs text-accent-text hover:underline">
              {categories.length - 6} more categories
            </Link>
          )}
        </div>
      )}
    </Card>,
  );

  // 8 · Where spending is heading, and the month's biggest charges.
  if (categoryTrends.length > 0)
    add(
      "category-trends",
      "Top categories",
      <Card title={`Top categories, last ${trendLabels.length} months`} meta={`${shortMonthLabel(selected.label)} so far`}>
        <CategoryTrends rows={categoryTrends} />
      </Card>,
    );
  add(
    "top-spending",
    "Highest spending",
    <Card
      title="Highest spending"
      meta={selPretty}
      action={<CardLink href={`/transactions?period=${selected.label}&direction=Debit&sort=amount&dir=desc`}>View all</CardLink>}
    >
      <TxnList txns={topTxns} mobileLimit={5} empty={`No spending for ${selPretty}.`} />
    </Card>,
  );

  // 9 · The long view
  add(
    "income-vs-outgoing",
    "Income vs outgoing",
    <Card title="Income vs outgoing" meta="by month">
      {flows.length === 0 ? (
        <p className="text-sm text-fg-3">No transaction data yet. Fills in as you import bank CSVs.</p>
      ) : (
        <BarsChart
          labels={flows.map((f) => shortMonthLabel(f.label))}
          series={[
            { name: "Income", color: "var(--mp-money-income)", values: flows.map((f) => f.income) },
            { name: "Outgoing", color: "var(--mp-text-3)", values: flows.map((f) => f.outgoing) },
          ]}
          valueFormat="money"
          highlightIndex={flowsHi}
        />
      )}
    </Card>,
  );

  return (
    <DashboardGrid
      initialLayouts={layout}
      widgets={widgets}
      // Compact on a phone: the month picker is the only control that earns its width; the month
      // sheet is a quiet link under the title.
      title={
        <div className="min-w-0">
          <div className="mp-pagehead__eyebrow">{greeting.date}</div>
          <h1 className="mp-pagehead__title max-sm:text-[22px]">{greeting.text}</h1>
          <div className="mt-1 flex items-center gap-x-3 flex-wrap text-xs">
            <Link href={`/months/${selected.label}`} className="text-accent-text hover:underline">
              {selPretty} bills
            </Link>
            {feeds.length > 0 && (
              <Link
                href="/settings/sync"
                className="text-fg-3 hover:underline"
                title={lastSync != null ? new Date(lastSync).toLocaleString("en-US", { timeZone: "America/Chicago" }) : undefined}
              >
                {minutesSinceSync == null ? "Never synced" : `Synced ${agoText(minutesSinceSync)}`}
              </Link>
            )}
          </div>
        </div>
      }
      controls={<MonthNav periods={navPeriods} current={selected.label} />}
    />
  );
}

/**
 * One standing balance: the figure, a one-line caption, a few small supporting figures, and the
 * month-by-month sparkline. Sized to sit three across on desktop and two on a phone, where the
 * supporting figures and the line drop away. Cards are never tinted; only the figure carries the
 * tone (owed = clay).
 */
function StandingTile({
  label,
  icon,
  kind,
  value,
  caption,
  stats,
  trend,
  trendColor,
  trendHi,
}: {
  label: string;
  icon: "wallet" | "credit-card" | "graduation-cap";
  kind: "neutral" | "owed";
  value: number | null;
  caption: React.ReactNode;
  stats: { label: string; value: number; warn?: boolean }[];
  trend: { label: string; value: number | null }[] | null;
  trendColor: string;
  trendHi: number;
}) {
  return (
    <Card>
      <StatTile label={label} icon={icon} kind={kind} value={value ?? <span className="text-fg-3">—</span>} sub={<span className="block truncate">{caption}</span>} />
      {stats.length > 0 && (
        <dl className="mt-3 hidden sm:flex flex-wrap gap-x-4 gap-y-1">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="text-[11px] text-fg-3">{s.label}</dt>
              <dd className={`text-sm font-semibold ${s.warn ? "text-warn" : ""}`}>
                <Money value={s.value} kind="neutral" className={s.warn ? "text-warn" : undefined} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {trend && (
        <div className="mt-3 hidden sm:block">
          <Sparkline points={trend} color={trendColor} highlightIndex={trendHi} />
        </div>
      )}
    </Card>
  );
}

/**
 * One category row on the shared dollar ruler: a solid bar for what's spent and, when the row has
 * a plan, a tinted envelope for the budget it sits inside, with overspend spilling rose past it.
 * The caller computes the segments because the scale belongs to the panel, not the row. The
 * user-picked color is re-lit at the theme's dot lightness (never used raw as a fill) so any hex
 * stays legible in both themes.
 *
 * Mobile: label + figures on line 1, full-width bar on line 2. sm+: one line, via the order
 * swaps. The right-hand columns share `order-2` so they stay together when wrapped, source order
 * deciding which comes first.
 */
function CategoryRow({
  name,
  href,
  emoji,
  color,
  total,
  planned,
  segments,
  track,
  withPlan,
  mobileHidden = false,
}: {
  name: string;
  href: string;
  emoji?: string | null;
  color?: string | null;
  total: number;
  planned: number | null;
  segments: { solid: number; unspent: number; over: number };
  track: boolean;
  withPlan: boolean;
  mobileHidden?: boolean;
}) {
  const fill = `oklch(from ${color || "#0ea5e9"} var(--mp-tint-dot-l) c h)`;
  const over = planned != null && total > planned;
  const remaining = planned != null ? planned - total : null;
  return (
    // The whole row is one hover target so the eye can follow a label across the bar to its
    // numbers without losing the line.
    <Link
      href={href}
      className={`${mobileHidden ? "hidden sm:flex" : "flex"} flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 rounded-control -mx-2 px-2 py-1.5 transition-colors hover:bg-hover`}
    >
      <div className="order-1 flex-1 min-w-0 sm:flex-none sm:w-44 text-sm truncate flex items-center gap-2">
        <Glyph color={color} size="sm" icon={emoji ? undefined : "tag"}>
          {emoji ? <span className="text-xs leading-none">{emoji}</span> : null}
        </Glyph>
        <span className="truncate">{name}</span>
      </div>
      <div className={`order-3 sm:order-2 w-full sm:w-auto sm:flex-1 flex h-2.5 rounded-full overflow-hidden ${track ? "bg-sunken" : ""}`}>
        <div className="h-full" style={{ width: `${segments.solid}%`, backgroundColor: fill }} />
        {segments.unspent > 0 && <div className="h-full opacity-30" style={{ width: `${segments.unspent}%`, backgroundColor: fill }} />}
        {segments.over > 0 && <div className="h-full bg-over" style={{ width: `${segments.over}%` }} />}
      </div>
      <div className="order-2 sm:order-3 shrink-0 sm:w-24 text-right text-sm">
        <Money value={total} kind="neutral" />
      </div>
      {withPlan && (
        <div className="order-2 sm:order-4 shrink-0 sm:w-40 text-right whitespace-nowrap leading-tight">
          {planned != null && remaining != null ? (
            <>
              {/* The remainder is the number that drives a decision, so it leads; the plan it's
                  measured against sits underneath. */}
              <div className={`text-sm font-medium ${over ? "text-over" : remaining === 0 ? "text-fg-3" : "text-income"}`}>
                {over ? `${formatMoney(total - planned)} over` : remaining === 0 ? "Spent to plan" : `${formatMoney(remaining)} left`}
              </div>
              <div className="text-[11px] text-fg-3">of {formatMoney(planned)}</div>
            </>
          ) : (
            <span className="text-xs text-fg-3">Not planned</span>
          )}
        </div>
      )}
    </Link>
  );
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" from a minute count. */
function agoText(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

/** Transaction rows: date · description (+ pending badge) · account · category · amount. */
function TxnList({
  txns,
  empty,
  mobileLimit,
  showAccount = false,
  hidePendingBadge = false,
}: {
  txns: (TxnSummary & { account?: string | null; accountNumber?: string | null })[];
  empty: string;
  mobileLimit?: number;
  showAccount?: boolean;
  hidePendingBadge?: boolean;
}) {
  if (txns.length === 0) return <p className="text-sm text-fg-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {txns.map((t, i) => {
        const amt = toNum(t.amount) ?? 0;
        return (
          <li
            key={t.id}
            className={`${mobileLimit != null && i >= mobileLimit ? "hidden sm:flex" : "flex"} items-center gap-3 py-2.5 first:pt-0 last:pb-0 ${t.pending ? "text-fg-2" : ""}`}
          >
            <span className="shrink-0 w-12 text-xs text-fg-3 whitespace-nowrap">{dayLabel(t.txnDate)}</span>
            <span className="flex-1 min-w-0 flex items-center gap-1.5 text-sm">
              <span className="truncate">{t.description}</span>
              {t.pending && !hidePendingBadge && <Badge variant="pending" size="sm" label="Pending" className="shrink-0" />}
            </span>
            {showAccount && (t.account || t.accountNumber) && (
              <span className="hidden sm:inline shrink-0 max-w-32 truncate text-xs text-fg-3">{t.account || `··${t.accountNumber!.slice(-4)}`}</span>
            )}
            {t.category && <span className="hidden sm:inline shrink-0 max-w-28 truncate text-xs text-fg-3">{t.category}</span>}
            <Money value={t.direction === "Credit" ? amt : -amt} kind={t.pending ? (t.direction === "Credit" ? "income" : "pending") : "auto"} sign="auto" className="shrink-0 w-24 text-right text-sm font-medium" />
          </li>
        );
      })}
    </ul>
  );
}

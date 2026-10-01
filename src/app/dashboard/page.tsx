import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { Donut } from "@/components/charts/Donut";
import { BarsChart } from "@/components/charts/BarsChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { MonthNav } from "@/components/dashboard/MonthNav";
import { PaydayCountdown } from "@/components/dashboard/PaydayCountdown";
import { BudgetPanel } from "@/components/budget/BudgetPanel";
import { CashMonthWidget } from "@/components/budget/CashMonthWidget";
import {
  getPeriods,
  getInstances,
  getStatusConfig,
  getAllInstancesWithPeriod,
  getCashflowByPeriod,
  getCategorySpend,
  getCategoryRows,
  getCashOnHand,
  getLiabilityAccounts,
  getBalanceTrends,
  getTopTransactions,
  getTopDeposits,
  getRecentTransactions,
  getPendingSummary,
  getGoalsWithProgress,
  getPaySchedule,
  getBudgetView,
  getCashProjection,
  getDailyCashOnHand,
  type TxnSummary,
} from "@/server/queries";
import { todayIso } from "@/server/lib/pay-schedule";
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
  let periods, statusConfig, allInstances, cashflow;
  try {
    // This month and next always exist — cloned from the last month with bills when missing.
    await ensureCurrentPeriods();
    [periods, statusConfig, allInstances, cashflow] = await Promise.all([
      getPeriods(), // newest first
      getStatusConfig(),
      getAllInstancesWithPeriod(),
      getCashflowByPeriod(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  if (!periods.length) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-neutral-500">
          No months yet. Run <code>npm run seed</code> or create a month.
        </p>
      </div>
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
  const statusEmojiOf = new Map(statusConfig.map((s) => [s.name, s.emoji]));
  const orderOf = new Map(statusConfig.map((s, i) => [s.name, i]));

  // Cash on hand reflects the balances recorded as of the END of the selected month,
  // so viewing a past month shows what the balances were back then (snapshots are historical).
  const monthEnd = monthBounds(selected.year, selected.month).end;
  const [
    selInstances,
    catSpend,
    topTxns,
    topDeposits,
    recentTxns,
    cashAccounts,
    liabilities,
    catRows,
    balanceTrends,
    goals,
    paySchedule,
    budget,
    dailyCash,
    pendingSummary,
  ] = await Promise.all([
    getInstances(selected.id),
    getCategorySpend(selected.label),
    getTopTransactions(selected.label),
    getTopDeposits(selected.label),
    getRecentTransactions(selected.label),
    getCashOnHand(monthEnd),
    getLiabilityAccounts(monthEnd),
    getCategoryRows(),
    getBalanceTrends(),
    getGoalsWithProgress(monthEnd),
    getPaySchedule(),
    getBudgetView(selected.label),
    getDailyCashOnHand(selected.label),
    getPendingSummary(selected.label),
  ]);
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

  // ---- Trend sparklines (all months; selected month highlighted) ----
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

  // ---- Status donut (selected month) ----
  const statusCounts = new Map<string, number>();
  for (const i of selInstances) statusCounts.set(i.status, (statusCounts.get(i.status) ?? 0) + 1);
  const donut = [...statusCounts.entries()]
    .map(([label, value]) => ({ label, value, color: colorOf.get(label) ?? "#9ca3af" }))
    .sort((a, b) => (orderOf.get(a.label) ?? 99) - (orderOf.get(b.label) ?? 99));
  const settledCount = selInstances.filter((i) => settledSet.has(i.status)).length;
  const settledPct = selInstances.length
    ? Math.round((settledCount / selInstances.length) * 100)
    : 0;

  // ---- Monthly trend: billed vs paid (all months, selected highlighted) ----
  const monthMap = new Map<string, { label: string; billed: number; paid: number }>();
  for (const i of allInstances) {
    const m = monthMap.get(i.label) ?? { label: i.label, billed: 0, paid: 0 };
    const amt = toNum(i.amount) ?? 0;
    m.billed += amt;
    if (settledSet.has(i.status)) m.paid += amt;
    monthMap.set(i.label, m);
  }
  const months = [...monthMap.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
  const monthsHi = months.findIndex((m) => m.label === selected.label);

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
  const navPeriods = [...periods]
    .map((p) => ({ label: p.label, pretty: prettyPeriod(p.year, p.month) }))
    .reverse(); // oldest -> newest

  return (
    <div className="space-y-8">
      {/* Header + month navigation */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-neutral-500">Viewing {selPretty}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthNav periods={navPeriods} current={selected.label} />
          <Link
            href={`/months/${selected.label}`}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
          >
            Open {selPretty} →
          </Link>
        </div>
      </div>

      {/* Payday countdown — only meaningful while viewing the current month; a past or future
          month has no "next paycheck" to speak of, so the card is hidden there. */}
      {isCurrentMonth && <PaydayCountdown schedule={paySchedule} today={today} />}

      {/* Financial standing — cash, credit, debt: one row on desktop, stacked on mobile */}
      <div className="flex flex-col md:flex-row gap-4">
      {/* Cash on hand (current; not month-scoped) */}
      <div className="flex-1 min-w-0 rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Cash on hand</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {hasRecordedCash ? formatMoney(cashTotal) : "—"}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {hasRecordedCash ? (
                <>
                  Checking + savings{hasWallet ? " + cash in pocket" : ""} · as of{" "}
                  {formatDate(cashAsOf)}
                </>
              ) : (
                <>
                  No balances recorded as of {selPretty}.{" "}
                  <Link href="/accounts" className="underline hover:text-neutral-700 dark:hover:text-neutral-300">
                    Record them on Accounts →
                  </Link>
                </>
              )}
            </div>
          </div>
          {hasRecordedCash && (
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <div className="text-xs text-neutral-500">Checking</div>
                <div className="text-xl font-semibold tabular-nums">{formatMoney(checkingTotal)}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Savings</div>
                <div className="text-xl font-semibold tabular-nums">{formatMoney(savingsTotal)}</div>
              </div>
              {hasWallet && (
                <div>
                  <div className="text-xs text-neutral-500">Pocket</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {formatMoney(walletTotal)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {hasRecordedCash && hasTrend(cashTrend) && (
          <div className="mt-4">
            <Sparkline points={cashTrend} color="#059669" highlightIndex={trendHi} />
          </div>
        )}
      </div>

      {/* Credit cards (as of end of selected month) — only when credit accounts exist */}
      {creditAccounts.length > 0 && (
        <div className="flex-1 min-w-0 rounded-lg border border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Credit cards owed</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-violet-700 dark:text-violet-400">
                {hasRecordedCredit ? formatMoney(creditOwed) : "—"}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {hasRecordedCredit ? (
                  <>
                    of {formatMoney(creditLimitTotal)} limit
                    {creditUtil != null && <> · {creditUtil.toFixed(0)}% utilized</>}
                    {creditInterest > 0 && <> · {formatMoney(creditInterest)}/mo interest</>}
                    {creditAsOf && <> · as of {formatDate(creditAsOf)}</>}
                  </>
                ) : (
                  <>
                    No balances recorded as of {selPretty}.{" "}
                    <Link href="/debts" className="underline hover:text-neutral-700 dark:hover:text-neutral-300">
                      Record them on Debts →
                    </Link>
                  </>
                )}
              </div>
            </div>
            {hasRecordedCredit && (
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <div className="text-xs text-neutral-500">Limit</div>
                  <div className="text-xl font-semibold tabular-nums">{formatMoney(creditLimitTotal)}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Available</div>
                  <div className="text-xl font-semibold tabular-nums">{formatMoney(creditAvailable)}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Min / mo</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {creditMinPayment > 0 ? formatMoney(creditMinPayment) : "—"}
                  </div>
                </div>
              </div>
            )}
          </div>
          {hasRecordedCredit && hasTrend(creditTrend) && (
            <div className="mt-4">
              <Sparkline points={creditTrend} color="#7c3aed" highlightIndex={trendHi} />
            </div>
          )}
        </div>
      )}

      {/* Loans outstanding (as of end of selected month) — only when a loan exists */}
      {loanAccounts.length > 0 && (
        <div className="flex-1 min-w-0 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Loans outstanding</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-orange-700 dark:text-orange-400">
                {hasRecordedDebt ? formatMoney(debtOwed) : "—"}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {hasRecordedDebt ? (
                  <>
                    across {loanAccounts.length} loan{loanAccounts.length === 1 ? "" : "s"}
                    {debtAsOf && <> · as of {formatDate(debtAsOf)}</>}
                    {" · "}
                    <Link href="/debts" className="underline hover:text-neutral-700 dark:hover:text-neutral-300">
                      manage debts →
                    </Link>
                  </>
                ) : (
                  <>
                    No balances recorded as of {selPretty}.{" "}
                    <Link href="/debts" className="underline hover:text-neutral-700 dark:hover:text-neutral-300">
                      Record them on Debts →
                    </Link>
                  </>
                )}
              </div>
            </div>
            {hasRecordedDebt && (
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <div className="text-xs text-neutral-500">Interest / mo</div>
                  <div className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    {debtMonthlyInterest > 0 ? formatMoney(debtMonthlyInterest) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Min / mo</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {debtMinPayment > 0 ? formatMoney(debtMinPayment) : "—"}
                  </div>
                </div>
              </div>
            )}
          </div>
          {hasRecordedDebt && hasTrend(loanTrend) && (
            <div className="mt-4">
              <Sparkline points={loanTrend} color="#ea580c" highlightIndex={trendHi} />
            </div>
          )}
        </div>
      )}
      </div>

      {/* Savings goals — progress + regress flags (only when goals exist) */}
      {activeGoals.length > 0 && (
        <Panel
          title="Savings goals"
          action={
            <Link href="/goals" className="text-xs text-blue-600 hover:underline whitespace-nowrap">
              Manage →
            </Link>
          }
        >
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            {activeGoals.slice(0, 6).map((g) => {
              const pct = g.targetAmount > 0 ? (g.funded / g.targetAmount) * 100 : 0;
              const achieved = g.targetAmount > 0 && g.funded >= g.targetAmount;
              const backedPct = g.targetAmount > 0 ? Math.min(100, (g.backed / g.targetAmount) * 100) : 0;
              const shortPct =
                g.targetAmount > 0 ? Math.min(100 - backedPct, (g.shortfall / g.targetAmount) * 100) : 0;
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {g.emoji && <span aria-hidden>{g.emoji}</span>}
                      <span className="truncate">{g.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      {formatMoney(g.funded)} / {formatMoney(g.targetAmount)}
                      <span className={`ml-2 font-medium ${achieved ? "text-emerald-600" : "text-neutral-700 dark:text-neutral-300"}`}>
                        {achieved ? "✔" : `${pct.toFixed(0)}%`}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full flex overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.max(g.funded > 0 ? 2 : 0, backedPct)}%`,
                        backgroundColor: achieved ? "#10b981" : g.color,
                      }}
                    />
                    {shortPct > 0 && <div className="h-full bg-red-400/80" style={{ width: `${shortPct}%` }} />}
                  </div>
                  {g.shortfall > 0 && (
                    <div className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
                      ⚠ under-funded by {formatMoney(g.shortfall)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Budget — plan vs. actual for the selected month (or a prompt to make one) */}
      <Panel
        title={`Budget — ${selPretty}`}
        action={
          budget && (
            <Link href={`/budget?period=${selected.label}`} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
              Open →
            </Link>
          )
        }
      >
        <BudgetPanel view={budget} periodLabel={selected.label} pretty={selPretty} />
      </Panel>

      {/* Cash through the month — recorded so far (ledger) joined to the projection (plan) */}
      {showCashMonth && (
        <CashMonthWidget daily={dailyCash} projection={cashProjection} periodLabel={selected.label} lines={budget?.lines ?? []} unplanned={budget?.unplannedSpend} today={todayIso()} />
      )}

      {/* Selected-month stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <Card label="Total bills" value={String(selInstances.length)} />
        <Card label="Total billed" value={formatMoney(billed)} />
        <Card label="Total paid" value={formatMoney(paid)} tone="green" />
        <Card label="Outstanding" value={formatMoney(outstanding)} tone="amber" />
        <Card label="Income" value={formatMoney(income)} tone="blue" />
      </div>

      {/* Per-month charts */}
      <div className="grid md:grid-cols-2 gap-6">
        <Panel title={`${selPretty} — status breakdown`}>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Donut data={donut} centerLabel={`${settledPct}%`} centerSub="settled" />
            <ul className="text-sm space-y-1 w-full sm:w-auto sm:flex-1">
              {donut.map((d) => (
                <li key={d.label} className="flex items-center gap-2">
                  {statusEmojiOf.get(d.label) ? (
                    <span aria-hidden className="w-3 text-center leading-none">
                      {statusEmojiOf.get(d.label)}
                    </span>
                  ) : (
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                  )}
                  <span className="flex-1 truncate">{d.label}</span>
                  <span className="tabular-nums text-neutral-500">{d.value}</span>
                </li>
              ))}
              {donut.length === 0 && <li className="text-neutral-500">No bills.</li>}
            </ul>
          </div>
        </Panel>

        <Panel title={`Income vs outgoing — ${selPretty}`}>
          {income === 0 && outgoing === 0 ? (
            <p className="text-sm text-neutral-500">
              No transactions recorded for {selPretty} yet. Import a CSV or add transactions in the
              month view — income appears here from deposit (Credit) transactions.
            </p>
          ) : (
            <div className="space-y-3">
              {[
                { label: "Income", value: income, color: "#22c55e" },
                { label: "Outgoing", value: outgoing, color: "#ef4444" },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3">
                  <div className="w-20 text-sm">{r.label}</div>
                  <div className="flex-1 bg-neutral-200 dark:bg-neutral-800 rounded h-6 overflow-hidden">
                    <div
                      className="h-full"
                      style={{ width: `${Math.max(2, (r.value / maxFlow) * 100)}%`, backgroundColor: r.color }}
                    />
                  </div>
                  <div className="w-24 text-right text-sm tabular-nums">{formatMoney(r.value)}</div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-neutral-200 dark:border-neutral-800 pt-2">
                <span className="text-sm text-neutral-500">Net</span>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    income - outgoing >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatMoney(income - outgoing)}
                </span>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Where the money went and, once a budget exists, how full each envelope is. */}
      <Panel
        title={`Spend by category — ${selPretty}`}
        action={
          budget && (
            <div className="flex items-center gap-3 text-xs text-neutral-500 whitespace-nowrap">
              <span className="hidden sm:flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span aria-hidden className="inline-block w-3 h-2 rounded-sm bg-neutral-500" /> spent
                </span>
                <span className="flex items-center gap-1">
                  <span aria-hidden className="inline-block w-3 h-2 rounded-sm bg-neutral-500 opacity-30" /> budget left
                </span>
                <span className="flex items-center gap-1">
                  <span aria-hidden className="inline-block w-3 h-2 rounded-sm bg-red-500/85" /> over
                </span>
              </span>
              <Link href={`/budget?period=${selected.label}`} className="text-blue-600 hover:underline">
                edit →
              </Link>
            </div>
          )
        }
      >
        {categories.length === 0 ? (
          <p className="text-sm text-neutral-500">No transactions for {selPretty}.</p>
        ) : (
          <div className="space-y-1">
            {categories.map((c) => (
              <CategoryRow
                key={c.name}
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
          </div>
        )}
      </Panel>

      {/* Highest spending, highest deposits, and most recent for the selected month */}
      <div className="grid md:grid-cols-3 gap-6">
        <Panel
          title={`Highest spending — ${selPretty}`}
          action={
            <ViewAllLink
              href={`/transactions?period=${selected.label}&direction=Debit&sort=amount&dir=desc`}
            />
          }
        >
          <TxnList txns={topTxns} empty={`No spending for ${selPretty}.`} />
        </Panel>
        <Panel
          title={`Highest deposits — ${selPretty}`}
          action={
            <ViewAllLink
              href={`/transactions?period=${selected.label}&direction=Credit&sort=amount&dir=desc`}
            />
          }
        >
          <TxnList txns={topDeposits} empty={`No deposits for ${selPretty}.`} />
        </Panel>
        <Panel
          title={`Recent transactions — ${selPretty}`}
          action={
            <span className="flex items-center gap-3">
              {pendingSummary.count > 0 && (
                <Link
                  href={`/transactions?period=${selected.label}&status=pending`}
                  className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 text-xs font-medium hover:underline"
                  title="Authorized at the bank but not settled yet"
                >
                  {pendingSummary.count} pending · −{formatMoney(pendingSummary.debits)}
                </Link>
              )}
              <ViewAllLink href={`/transactions?period=${selected.label}`} />
            </span>
          }
        >
          <TxnList txns={recentTxns} empty={`No transactions for ${selPretty}.`} />
        </Panel>
      </div>

      {/* Cross-month trends (selected month highlighted) */}
      <div className="grid md:grid-cols-2 gap-6">
        <Panel title="Billed vs paid by month">
          <BarsChart
            labels={months.map((m) => shortMonthLabel(m.label))}
            series={[
              { name: "Billed", color: "#3b82f6", values: months.map((m) => m.billed) },
              { name: "Paid", color: "#22c55e", values: months.map((m) => m.paid) },
            ]}
            valueFormat="money"
            highlightIndex={monthsHi}
          />
        </Panel>
        <Panel title="Income vs outgoing by month">
          {flows.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No transaction data yet. Fills in as you import bank CSVs.
            </p>
          ) : (
            <BarsChart
              labels={flows.map((f) => shortMonthLabel(f.label))}
              series={[
                { name: "Income", color: "#22c55e", values: flows.map((f) => f.income) },
                { name: "Outgoing", color: "#ef4444", values: flows.map((f) => f.outgoing) },
              ]}
              valueFormat="money"
              highlightIndex={flowsHi}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "blue";
}) {
  const tones: Record<string, string> = {
    green: "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30",
    amber: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    blue: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
  };
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone ? tones[tone] : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-xl md:text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // min-w-0: Panels sit as grid items, whose default min-width:auto would size
    // them to their content's intrinsic width (e.g. a many-month chart) and blow
    // the grid past the viewport instead of letting inner overflow-x-auto scroll.
    <section className="min-w-0 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One category row on the shared dollar ruler: a solid bar for what's spent and, when the row has
 * a plan, a tinted envelope for the budget it sits inside, with overspend spilling red past it.
 * The caller computes the segments because the scale belongs to the panel, not the row.
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
}) {
  const fill = color || "#3b82f6";
  const over = planned != null && total > planned;
  const remaining = planned != null ? planned - total : null;
  return (
    // The whole row is one hover target — a tint plus a faint shadow — so the eye can follow a
    // label across the bar to its numbers without losing the line.
    <Link
      href={href}
      className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 rounded-md -mx-2 px-2 py-1 transition-colors hover:bg-neutral-100 hover:shadow-sm dark:hover:bg-neutral-800 dark:hover:shadow-black/30"
    >
      <div className="order-1 flex-1 min-w-0 sm:flex-none sm:w-40 text-sm truncate flex items-center gap-1.5">
        {emoji && <span aria-hidden>{emoji}</span>}
        <span className="truncate">{name}</span>
      </div>
      <div
        className={`order-3 sm:order-2 w-full sm:w-auto sm:flex-1 flex h-4 rounded overflow-hidden ${
          track ? "bg-neutral-200 dark:bg-neutral-800" : ""
        }`}
      >
        <div className="h-full last:rounded-r" style={{ width: `${segments.solid}%`, backgroundColor: fill }} />
        {segments.unspent > 0 && (
          <div
            className="h-full opacity-30 last:rounded-r"
            style={{ width: `${segments.unspent}%`, backgroundColor: fill }}
          />
        )}
        {segments.over > 0 && (
          <div className="h-full bg-red-500/85 last:rounded-r" style={{ width: `${segments.over}%` }} />
        )}
      </div>
      <div className="order-2 sm:order-3 shrink-0 sm:w-24 text-right text-sm tabular-nums">
        {formatMoney(total)}
      </div>
      {withPlan && (
        <div className="order-2 sm:order-4 shrink-0 sm:w-40 text-right tabular-nums whitespace-nowrap leading-tight">
          {planned != null && remaining != null ? (
            <>
              {/* The remainder is the number that drives a decision, so it leads; the plan it's
                  measured against sits underneath. */}
              <div
                className={`text-sm font-medium ${
                  over
                    ? "text-red-600 dark:text-red-400"
                    : remaining === 0
                      ? "text-neutral-500"
                      : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {over ? `${formatMoney(total - planned)} over` : remaining === 0 ? "spent to plan" : `${formatMoney(remaining)} left`}
              </div>
              <div className="text-[11px] text-neutral-500">of {formatMoney(planned)}</div>
            </>
          ) : (
            <span className="text-xs text-neutral-400 dark:text-neutral-600">not planned</span>
          )}
        </div>
      )}
    </Link>
  );
}

function ViewAllLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
      View all →
    </Link>
  );
}

function TxnList({ txns, empty }: { txns: TxnSummary[]; empty: string }) {
  if (txns.length === 0) return <p className="text-sm text-neutral-500">{empty}</p>;
  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {txns.map((t) => {
        const isCredit = t.direction === "Credit";
        return (
          <li key={t.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span className="shrink-0 text-xs text-neutral-500 whitespace-nowrap">
              {formatDate(t.txnDate)}
            </span>
            <span className="flex-1 min-w-0 truncate text-sm">
              {t.description}
              {t.pending && (
                <span className="ml-1.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 text-[10px] font-semibold uppercase">
                  pending
                </span>
              )}
            </span>
            {t.category && (
              <span className="hidden sm:inline shrink-0 max-w-28 truncate text-xs text-neutral-400">
                {t.category}
              </span>
            )}
            <span
              className={`shrink-0 w-24 text-right text-sm tabular-nums font-medium ${
                isCredit ? "text-green-600" : ""
              }`}
            >
              {isCredit ? "+" : "−"}
              {formatMoney(t.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

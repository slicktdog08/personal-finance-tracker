import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { DebtCard, type DebtRank } from "@/components/debts/DebtCard";
import { AddDebt } from "@/components/debts/AddDebt";
import { DebtStrategySwitch } from "@/components/debts/DebtStrategySwitch";
import {
  getLiabilityAccounts,
  getLiabilityLedger,
  getLiabilityPaymentTotals,
  getBillNames,
  getAccountUsageCounts,
  getAccountLastTxnDates,
  getPeriods,
  getBudgetView,
} from "@/server/queries";
import { toNum } from "@/server/lib/money";
import { monthlyInterest } from "@/server/lib/debt";
import { isSnowballDebt, orderDebts, projectPayoff, type DebtInput } from "@/server/lib/budget";
import { defaultPeriod, monthBounds, shortMonthLabel } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { DEBT_STRATEGIES, SNOWBALL_MIN_APR, type DebtStrategy } from "@/constants/enums";
import { Card, EmptyState, Money, PageHeader, StatTile } from "@/components/ds";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isStrategy = (v: unknown): v is DebtStrategy => DEBT_STRATEGIES.includes(v as DebtStrategy);

export default async function DebtsPage({ searchParams }: { searchParams: Promise<SP> }) {
  let debts, ledger, payments, billNames, usage, lastTxn, periods;
  try {
    [debts, ledger, payments, billNames, usage, lastTxn, periods] = await Promise.all([
      getLiabilityAccounts(),
      getLiabilityLedger(),
      getLiabilityPaymentTotals(),
      getBillNames(),
      getAccountUsageCounts(),
      getAccountLastTxnDates(),
      getPeriods(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  // This month's budget (if one exists) sets the monthly payment the projection runs at and which
  // debt is getting the extra; without one the projection runs on minimums alone.
  const today = todayIso();
  const period = periods.length ? defaultPeriod(periods, today) : null;
  const budget = period ? await getBudgetView(period.label).catch(() => null) : null;

  const sp = await searchParams;
  const wanted = one(sp.order);
  const strategy: DebtStrategy = isStrategy(wanted) ? wanted : isStrategy(budget?.strategy) ? budget!.strategy as DebtStrategy : "avalanche";

  // Bills the user can adopt as a new liability's name (type-ahead in "Add debt").
  const promotableBills = billNames.map((b) => b.name);
  const usageMap = new Map(usage.map((u) => [u.accountId, Number(u.c)]));

  // Group ledger rows by accountId (newest first, as queried).
  const byAccount = new Map<number, typeof ledger>();
  for (const r of ledger) {
    const list = byAccount.get(r.accountId) ?? [];
    list.push(r);
    byAccount.set(r.accountId, list);
  }

  // Roll-ups across all liabilities (latest snapshot each).
  let totalOwed = 0;
  let totalMonthlyInterest = 0;
  let totalMinPayment = 0;
  let totalOriginal = 0;
  let anyBalance = false;
  // The debt actually being attacked: everything over the snowball's APR line.
  let hotOwed = 0;
  let hotInterest = 0;
  let hotCount = 0;
  let hotMinimums = 0;
  for (const d of debts) {
    const bal = toNum(d.balance);
    if (bal != null) {
      anyBalance = true;
      totalOwed += Math.max(0, bal);
      if (isSnowballDebt({ apr: toNum(d.apr), balance: bal })) {
        hotOwed += bal;
        hotInterest += monthlyInterest(bal, toNum(d.apr)) ?? 0;
        hotCount += 1;
        hotMinimums += toNum(d.minPayment) ?? 0;
      }
    }
    const mi = monthlyInterest(bal, toNum(d.apr));
    if (mi != null) totalMonthlyInterest += mi;
    totalMinPayment += toNum(d.minPayment) ?? 0;
    totalOriginal += toNum(d.originalPrincipal) ?? 0;
  }

  // Paid down this month: each debt's balance the day before the month began vs. now. Only debts
  // with a snapshot on both sides count — a card first recorded mid-month has no "before".
  let paidDown: number | null = null;
  if (period) {
    const { start } = monthBounds(period.year, period.month);
    for (const d of debts) {
      const now = toNum(d.balance);
      const before = (byAccount.get(d.id) ?? []).find((r) => r.asOf < start);
      if (now == null || !before) continue;
      paidDown = (paidDown ?? 0) + (Number(before.balance) - now);
    }
  }

  // Payoff order + projection. The monthly payment is what this month's budget commits to the
  // high-interest debts, else their minimums — so the dates here match the Budget page's.
  const inputs: DebtInput[] = debts
    .filter((d) => toNum(d.balance) != null)
    .map((d) => ({ accountId: d.id, label: d.label ?? `••${d.accountNumber}`, balance: toNum(d.balance)!, apr: toNum(d.apr), minPayment: toNum(d.minPayment) }));
  const budgetDebtPay = budget
    ? budget.lines
        .filter((l) => l.kind === "debt" && l.accountId != null)
        .filter((l) => {
          const d = inputs.find((x) => x.accountId === l.accountId);
          return d && isSnowballDebt(d);
        })
        .reduce((s, l) => s + l.planned, 0)
    : 0;
  const onPlan = budgetDebtPay > 0;
  const monthlyBudget = onPlan ? budgetDebtPay : hotMinimums;
  const projection =
    period && inputs.some(isSnowballDebt) && monthlyBudget > 0
      ? projectPayoff({ debts: inputs, strategy, monthlyBudget, startYear: period.year, startMonth: period.month })
      : null;
  const ordered = orderDebts(inputs, strategy);
  const hotOrder = ordered.filter(isSnowballDebt).map((d) => d.accountId);
  const budgetTarget = budget?.lines.find((l) => l.kind === "debt" && l.isTarget)?.accountId ?? null;
  const rankOf = (id: number): DebtRank => {
    const i = hotOrder.indexOf(id);
    const step = projection?.steps.find((s) => s.accountId === id);
    return {
      rank: i >= 0 ? i + 1 : null,
      isTarget: i >= 0 && (budgetTarget != null ? budgetTarget === id : i === 0),
      paidOffOn: step && Number.isFinite(step.monthsToPayoff) ? step.paidOffOn : null,
    };
  };
  const position = new Map(ordered.map((d, i) => [d.accountId, i]));
  const sorted = [...debts].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Debts"
        description={
          <>
            Cards and loans in payoff order. Same ledger as{" "}
            <Link href="/accounts" className="text-accent-text hover:underline">
              Accounts
            </Link>{" "}
            — record a balance here or there.
          </>
        }
        actions={
          <>
            <DebtStrategySwitch value={strategy} />
            <AddDebt existingBills={promotableBills} />
          </>
        }
      />

      {debts.length > 0 && (
        <Card>
          <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as React.CSSProperties}>
            <StatTile
              size="hero"
              label="Total owed"
              value={anyBalance ? totalOwed : "—"}
              kind="owed"
              className="col-span-2"
              sub={
                <>
                  {hotCount > 0 && (
                    <>
                      High-interest <Money value={hotOwed} kind="owed" />
                    </>
                  )}
                  {paidDown != null && Math.abs(paidDown) >= 0.01 && (
                    <>
                      {hotCount > 0 && " · "}
                      {paidDown > 0 ? "paid down " : "up "}
                      <Money value={Math.abs(paidDown)} kind={paidDown > 0 ? "income" : "over"} sign="none" /> this month
                    </>
                  )}
                </>
              }
            />
            <StatTile
              label="Interest / month"
              value={totalMonthlyInterest > 0 ? totalMonthlyInterest : "—"}
              sub={totalMonthlyInterest > 0 ? <><Money value={totalMonthlyInterest * 12} kind="neutral" /> / yr</> : undefined}
            />
            <StatTile
              label="Debt-free"
              value={projection?.debtFreeOn ? shortMonthLabel(projection.debtFreeOn) : "—"}
              sub={
                projection
                  ? projection.debtFreeOn
                    ? `high-interest, ${onPlan ? "on this month's plan" : "on minimums alone"}`
                    : "payments don't outrun interest"
                  : hotCount > 0
                    ? "record minimums to project"
                    : "no high-interest debt"
              }
            />
          </div>
          <div className="mp-grid mp-grid--keep2 mt-5 border-t border-line pt-4" style={{ "--cols": 3 } as React.CSSProperties}>
            <StatTile
              size="sm"
              label={`High-interest (over ${SNOWBALL_MIN_APR}%)`}
              value={hotCount > 0 ? hotOwed : "—"}
              kind="owed"
              sub={
                hotCount > 0 ? (
                  <>
                    {hotCount} debt{hotCount === 1 ? "" : "s"} · <Money value={hotInterest} kind="neutral" />
                    /mo interest · {anyBalance && totalOwed > 0 ? Math.round((hotOwed / totalOwed) * 100) : 0}% of owed
                  </>
                ) : undefined
              }
            />
            <StatTile size="sm" label="Min payments / month" value={totalMinPayment > 0 ? totalMinPayment : "—"} />
            <StatTile size="sm" label="Paid off so far" value={totalOriginal > 0 ? Math.max(0, totalOriginal - totalOwed) : "—"} kind="income" sub={totalOriginal > 0 ? "vs original balances" : undefined} />
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {sorted.map((d) => (
          <DebtCard
            key={d.id}
            debt={d}
            ledger={byAccount.get(d.id) ?? []}
            payments={payments.get(d.id) ?? null}
            txnCount={usageMap.get(d.id) ?? 0}
            lastTxn={lastTxn.get(d.id) ?? null}
            order={rankOf(d.id)}
          />
        ))}
        {debts.length === 0 && (
          <EmptyState
            icon="credit-card"
            title="No debts yet"
            body={
              <>
                Use Add debt above to create a credit card or loan, or set an existing account&apos;s type to Credit or Loan on{" "}
                <Link href="/accounts" className="text-accent-text hover:underline">
                  Accounts
                </Link>
                .
              </>
            }
          />
        )}
      </div>
    </div>
  );
}

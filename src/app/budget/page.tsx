import { EmptyState, Icon, PageHeader, buttonClass } from "@/components/ds";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { MonthNav } from "@/components/dashboard/MonthNav";
import { BudgetSetup } from "@/components/budget/BudgetSetup";
import { BudgetView } from "@/components/budget/BudgetView";
import { CashMonthWidget } from "@/components/budget/CashMonthWidget";
import {
  getPeriods,
  getBudgetView,
  getBudgetInputs,
  getBudgetedPeriodLabels,
  getCategoryOptionsRich,
  getCashProjection,
  getDailyCashOnHand,
} from "@/server/queries";
import { projectPayoff, isSnowballDebt, type DebtInput } from "@/server/lib/budget";
import type { DebtStrategy } from "@/constants/enums";
import { prettyPeriod, defaultPeriod } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { ensureCurrentPeriods } from "@/server/periods";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BudgetPage({ searchParams }: { searchParams: Promise<SP> }) {
  let periods;
  try {
    await ensureCurrentPeriods();
    periods = await getPeriods(); // newest first
  } catch (e) {
    return <SetupNotice error={e} />;
  }
  if (!periods.length) {
    return (
      <EmptyState
        icon="chart-pie"
        title="No months yet"
        body="The current month is created automatically when you open the dashboard."
        action={
          <Link href="/dashboard" className={buttonClass({ variant: "secondary" })}>
            Open the dashboard
          </Link>
        }
      />
    );
  }

  const sp = await searchParams;
  const wanted = one(sp.period);
  // Default to the month we're actually living in, not the newest one on record.
  const selected = periods.find((p) => p.label === wanted) ?? defaultPeriod(periods, todayIso());
  const pretty = prettyPeriod(selected.year, selected.month);

  const [view, budgeted, categories] = await Promise.all([
    getBudgetView(selected.label),
    getBudgetedPeriodLabels(),
    getCategoryOptionsRich(),
  ]);
  const inputs = view ? null : await getBudgetInputs(selected.label);

  // Projection runs over the debts that HAVE a line, in the plan's own order (target first),
  // at the total the lines actually commit — so editing a planned payment moves the date. Only
  // the high-interest lines count toward that total; parked low-APR debts are reported, not raced.
  let projection = null;
  let debtBudget = 0;
  if (view) {
    const debtLines = view.lines.filter((l) => l.kind === "debt" && l.accountId != null);
    const byId = new Map(view.debts.map((d) => [d.accountId, d]));
    const ordered: DebtInput[] = [
      ...debtLines.filter((l) => l.isTarget),
      ...debtLines.filter((l) => !l.isTarget),
    ]
      .map((l) => byId.get(l.accountId!))
      .filter((d): d is DebtInput => !!d && d.balance > 0);
    const monthlyBudget = debtLines
      .filter((l) => {
        const d = byId.get(l.accountId!);
        return d && isSnowballDebt(d);
      })
      .reduce((s, l) => s + l.planned, 0);
    debtBudget = monthlyBudget;
    if (ordered.some(isSnowballDebt) && monthlyBudget > 0) {
      projection = projectPayoff({
        debts: ordered,
        strategy: (view.strategy as DebtStrategy) ?? "snowball",
        monthlyBudget,
        startYear: view.year,
        startMonth: view.month,
        preserveOrder: true,
      });
    }
  }

  const [cash, dailyCash] = view
    ? await Promise.all([getCashProjection(view), getDailyCashOnHand(selected.label)])
    : [null, []];

  const navPeriods = [...periods]
    .map((p) => ({
      label: p.label,
      pretty: `${prettyPeriod(p.year, p.month)}${budgeted.has(p.label) ? " ✓" : ""}`,
    }))
    .reverse();

  const today = todayIso();
  // The next payday the projection still expects (it already nets paydays that landed).
  const nextPaycheck = cash?.events.find((e) => e.kind === "paycheck" && e.date >= today)?.date ?? null;

  const nav = (
    <>
      <MonthNav periods={navPeriods} current={selected.label} basePath="/budget" />
      <Link href={`/dashboard?period=${selected.label}`} className={buttonClass({ variant: "ghost", size: "sm", className: "max-sm:hidden" })}>
        Dashboard
        <Icon name="arrow-right" size={14} />
      </Link>
    </>
  );

  if (view) {
    return (
      <BudgetView
        view={view}
        pretty={pretty}
        nav={nav}
        projection={projection}
        projectionBudget={debtBudget}
        categories={categories}
        cashWidget={<CashMonthWidget daily={dailyCash} projection={cash} periodLabel={selected.label} lines={view.lines} unplanned={view.unplannedSpend} today={today} />}
        projectedEndCash={cash?.endBalance ?? null}
        today={today}
        nextPaycheck={nextPaycheck}
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={pretty} title="Budget" description={<>No plan for {pretty} yet. Pick how to start.</>} actions={nav} />
      <BudgetSetup periodLabel={selected.label} pretty={pretty} year={selected.year} month={selected.month} inputs={inputs!} />
    </div>
  );
}

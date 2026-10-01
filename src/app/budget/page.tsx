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
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!periods.length) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Budget</h1>
        <p className="text-neutral-500">
          No months yet. Open the{" "}
          <Link href="/dashboard" className="text-blue-600 hover:underline">
            dashboard
          </Link>{" "}
          — the current month is created automatically.
        </p>
      </div>
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

  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Budget</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight">{pretty}</h1>
          {!view && <p className="mt-1 text-sm text-neutral-500">No plan for {pretty} yet. Pick how to start.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthNav periods={navPeriods} current={selected.label} basePath="/budget" />
          <Link href={`/dashboard?period=${selected.label}`} className="text-sm text-neutral-500 hover:text-indigo-600 whitespace-nowrap">
            Dashboard →
          </Link>
        </div>
      </div>

      {view ? (
        <BudgetView
          view={view}
          pretty={pretty}
          projection={projection}
          projectionBudget={debtBudget}
          categories={categories}
          cashWidget={<CashMonthWidget daily={dailyCash} projection={cash} periodLabel={selected.label} lines={view.lines} unplanned={view.unplannedSpend} today={todayIso()} />}
          projectedEndCash={cash?.endBalance ?? null}
        />
      ) : (
        <BudgetSetup
          periodLabel={selected.label}
          pretty={pretty}
          year={selected.year}
          month={selected.month}
          inputs={inputs!}
        />
      )}
    </div>
  );
}

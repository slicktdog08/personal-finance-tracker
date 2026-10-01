import Link from "next/link";
import { formatMoney } from "@/server/lib/money";
import { PlanBar } from "@/components/budget/PlanBar";
import type { BudgetView } from "@/server/queries";

/**
 * Dashboard snapshot of the selected month's budget: the whole-plan bar, the snowball target,
 * and the lines furthest over. Server component — the page already fetched the view.
 */
export function BudgetPanel({ view, periodLabel, pretty }: { view: BudgetView | null; periodLabel: string; pretty: string }) {
  if (!view) {
    return (
      <Link
        href={`/budget?period=${periodLabel}`}
        className="block rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 hover:border-blue-400 transition-colors"
      >
        <div className="text-sm font-medium">⛄ Plan a budget for {pretty}</div>
        <div className="text-xs text-neutral-500 mt-0.5">
          Debt snowball or blank — then watch plan vs. actual fill in from your transactions.
        </div>
      </Link>
    );
  }
  // Savings is kept, not spent — it stays out of the spend bar and is noted separately.
  const spendable = view.lines.filter((l) => l.kind !== "savings");
  const planned = spendable.reduce((s, l) => s + l.planned, 0);
  const actual = spendable.reduce((s, l) => s + l.actual, 0);
  const savings = view.lines.filter((l) => l.kind === "savings").reduce((s, l) => s + l.planned, 0);
  const target = view.lines.find((l) => l.isTarget) ?? null;
  const over = view.lines
    .filter((l) => l.kind !== "debt" && l.actual > l.planned)
    .sort((a, b) => b.actual - b.planned - (a.actual - a.planned))
    .slice(0, 3);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{formatMoney(actual)}</span>{" "}
          <span className="text-neutral-500">
            of {formatMoney(planned)} planned{savings > 0 && <> · {formatMoney(savings)} to savings</>}
          </span>
        </span>
        <span className={`tabular-nums font-medium ${actual > planned ? "text-red-600" : "text-neutral-600 dark:text-neutral-300"}`}>
          {actual > planned ? `${formatMoney(actual - planned)} over` : `${formatMoney(planned - actual)} left`}
        </span>
      </div>
      <PlanBar planned={planned} actual={actual} color="#3b82f6" />
      {target && (
        <div className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">⛄ {target.label}</span>
            <span className="tabular-nums text-neutral-500">
              {formatMoney(target.actual)} / {formatMoney(target.planned)}
            </span>
          </div>
          <PlanBar planned={target.planned} actual={target.actual} color="#2563eb" className="mt-1 h-2" />
        </div>
      )}
      {over.length > 0 && (
        <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
          {over.map((l) => (
            <li key={l.id}>
              {l.emoji && <span aria-hidden>{l.emoji} </span>}
              {l.label} — {formatMoney(l.actual - l.planned)} over
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

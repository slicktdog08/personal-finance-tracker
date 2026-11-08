import Link from "next/link";
import { Icon } from "@/components/ds";
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
        className="block rounded-card border border-dashed border-line-strong p-4 hover:border-accent transition-colors"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Icon name="flag" size={14} className="text-accent-text" />
          Plan a budget for {pretty}
        </div>
        <div className="text-xs text-fg-3 mt-0.5">
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
          <span className="text-fg-3">
            of {formatMoney(planned)} planned{savings > 0 && <> · {formatMoney(savings)} to savings</>}
          </span>
        </span>
        <span className={`tabular-nums font-medium ${actual > planned ? "text-over" : "text-fg-2"}`}>
          {actual > planned ? `${formatMoney(actual - planned)} over` : `${formatMoney(planned - actual)} left`}
        </span>
      </div>
      <PlanBar planned={planned} actual={actual} color="var(--mp-accent)" />
      {target && (
        <div className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon name="flag" size={14} className="shrink-0 text-owed" />
              <span className="truncate">{target.label}</span>
            </span>
            <span className="tabular-nums text-fg-3">
              {formatMoney(target.actual)} / {formatMoney(target.planned)}
            </span>
          </div>
          <PlanBar planned={target.planned} actual={target.actual} color="var(--mp-money-owed)" className="mt-1 h-2" />
        </div>
      )}
      {over.length > 0 && (
        <ul className="text-xs text-over space-y-0.5">
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

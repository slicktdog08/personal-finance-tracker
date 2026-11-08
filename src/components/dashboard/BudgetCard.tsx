import Link from "next/link";
import { Glyph, Money, ProgressBar, StatTile, EmptyState } from "@/components/ds";
import { formatMoney } from "@/server/lib/money";
import type { BudgetView } from "@/server/queries";

/**
 * "This month's budget": spent vs planned on one bar, with a tick where an even pace would have
 * you today — so "on track" reads without arithmetic. Savings is kept, not spent, so it stays out
 * of the bar and is noted separately. The snowball target and the envelopes furthest over (what
 * the old dashboard budget panel listed) follow underneath.
 */
export function BudgetCard({
  view,
  periodLabel,
  pretty,
  today,
}: {
  view: BudgetView | null;
  periodLabel: string;
  pretty: string;
  today: string;
}) {
  if (!view)
    return (
      <EmptyState
        compact
        icon="chart-pie"
        title={`No budget for ${pretty} yet`}
        body="Debt snowball or blank — then plan vs actual fills in from your transactions."
        action={
          <Link href={`/budget?period=${periodLabel}`} className="text-sm font-medium text-accent-text hover:underline">
            Plan a budget
          </Link>
        }
      />
    );

  const spendable = view.lines.filter((l) => l.kind !== "savings");
  const planned = spendable.reduce((s, l) => s + l.planned, 0);
  const actual = spendable.reduce((s, l) => s + l.actual, 0);
  const savings = view.lines.filter((l) => l.kind === "savings").reduce((s, l) => s + l.planned, 0);
  const target = view.lines.find((l) => l.isTarget) ?? null;
  const overLines = view.lines.filter((l) => l.kind !== "debt" && l.actual > l.planned).sort((a, b) => b.actual - b.planned - (a.actual - a.planned));

  // Even-pace marker, only while the month is running: a finished month's pace is the whole plan.
  const dim = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const running = today.slice(0, 7) === periodLabel;
  const marker = running && planned > 0 ? (planned * Number(today.slice(8, 10))) / dim : undefined;
  const left = planned - actual;

  return (
    <div>
      <StatTile
        label="Spent so far"
        value={actual}
        sub={
          <>
            of <Money value={planned} kind="neutral" /> planned
            {savings > 0 && (
              <>
                {" · "}
                <Money value={savings} kind="neutral" whole /> to savings
              </>
            )}
          </>
        }
      />
      <ProgressBar
        value={actual}
        max={planned || 1}
        marker={marker}
        color={actual > planned ? "var(--mp-money-over)" : undefined}
        className="mt-3.5"
        label="Spent against plan"
        legendLeft={
          overLines.length ? (
            <span className="text-over">
              {overLines.length} envelope{overLines.length === 1 ? "" : "s"} over
            </span>
          ) : (
            "All envelopes inside plan"
          )
        }
        legendRight={
          left >= 0 ? (
            <>
              <Money value={left} kind="neutral" /> left
            </>
          ) : (
            <span className="text-over">
              <Money value={-left} kind="over" sign="none" /> over
            </span>
          )
        }
      />
      {(target || overLines.length > 0) && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {target && (
            <div className="text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Glyph icon="target" color="#0ea5e9" size="sm" />
                  <span className="truncate">{target.label}</span>
                </span>
                <span className="shrink-0 text-fg-3">
                  <Money value={target.actual} kind="neutral" /> of <Money value={target.planned} kind="neutral" />
                </span>
              </div>
              <ProgressBar value={target.actual} max={target.planned || 1} size="sm" className="mt-1.5" label={`${target.label} paid against plan`} />
            </div>
          )}
          {overLines.slice(0, 3).map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <Glyph color={l.color} size="sm">
                  {l.emoji ? <span className="text-xs">{l.emoji}</span> : null}
                </Glyph>
                <span className="truncate">{l.label}</span>
              </span>
              <span className="shrink-0 text-over">{formatMoney(l.actual - l.planned)} over</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

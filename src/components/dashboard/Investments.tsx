import { Money, StatTile } from "@/components/ds";
import { Sparkline } from "@/components/charts/Sparkline";
import { formatMoney } from "@/server/lib/money";
import { dayLabel } from "./kit";

export interface InvestmentAccountRow {
  id: number;
  name: string;
  balance: number | null;
  asOf: string | null;
}
export interface HoldingRow {
  key: string;
  symbol: string | null;
  name: string;
  value: number;
}

/**
 * Retirement and brokerage money: owned, not spendable, and the slowest-moving line on the page —
 * so it gets its own panel instead of hiding inside net worth. The total and its line follow the
 * month being viewed; the per-account and per-holding detail is the latest on record, so it only
 * appears beside the current month.
 */
export function Investments({
  total,
  prev,
  prevLabel,
  yearAgo,
  trend,
  highlightIndex,
  accounts,
  holdings,
  holdingsAsOf,
}: {
  total: number;
  /** The month before the one viewed; null when nothing was recorded then. */
  prev: number | null;
  prevLabel: string | null;
  /** Twelve months before the one viewed. */
  yearAgo: number | null;
  trend: { label: string; value: number | null }[];
  highlightIndex: number;
  accounts: InvestmentAccountRow[];
  /** Largest positions at the latest statement close. */
  holdings: HoldingRow[];
  holdingsAsOf: string | null;
}) {
  const delta = prev != null ? total - prev : null;
  const yearDelta = yearAgo != null ? total - yearAgo : null;
  const held = holdings.reduce((t, h) => t + h.value, 0);
  return (
    <div>
      <StatTile
        label="Invested"
        icon="trending-up"
        value={<Money value={total} kind="neutral" />}
        delta={
          delta != null
            ? {
                dir: delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat",
                label: `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta))} vs ${prevLabel ?? "last month"}`,
              }
            : undefined
        }
        sub={
          yearDelta != null ? (
            <>
              {yearDelta >= 0 ? "Up" : "Down"} <Money value={Math.abs(yearDelta)} kind="neutral" whole /> over twelve months, contributions included
            </>
          ) : (
            "Not spendable. Counted in net worth only."
          )
        }
      />
      <div className="mt-3">
        <Sparkline points={trend} color="var(--mp-accent)" highlightIndex={highlightIndex} />
      </div>
      {accounts.length > 1 && (
        <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="shrink-0 text-right">
                {a.balance != null ? <Money value={a.balance} kind="neutral" /> : <span className="text-fg-3">—</span>}
                {a.asOf && <span className="ml-2 text-xs text-fg-3">{dayLabel(a.asOf)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {holdings.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-fg-3">
            <span>Largest holdings</span>
            {holdingsAsOf && <span>as of {dayLabel(holdingsAsOf)}</span>}
          </div>
          <ul className="space-y-1.5 text-sm">
            {holdings.map((h) => (
              <li key={h.key} className="flex items-center gap-3">
                <span className="w-14 shrink-0 truncate font-medium">{h.symbol ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-2">{h.name}</span>
                <span className="w-10 shrink-0 text-right text-xs text-fg-3">{held > 0 ? `${Math.round((h.value / held) * 100)}%` : ""}</span>
                <Money value={h.value} kind="neutral" className="w-24 shrink-0 text-right" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

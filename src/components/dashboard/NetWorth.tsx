import { Money, StatTile } from "@/components/ds";
import { Sparkline } from "@/components/charts/Sparkline";
import { formatMoney } from "@/server/lib/money";

/** Cash minus everything owed, month by month — the one line that says whether the rebuild is working. */
export function NetWorth({
  now,
  prev,
  prevLabel,
  cash,
  credit,
  loans,
  trend,
  highlightIndex,
}: {
  now: number;
  prev: number | null;
  /** "Sep" — what the delta is measured against. */
  prevLabel?: string | null;
  cash: number;
  credit: number;
  loans: number;
  trend: { label: string; value: number | null }[];
  highlightIndex: number;
}) {
  const delta = prev != null ? now - prev : null;
  return (
    <div>
      <StatTile
        label="Assets − debts"
        value={<Money value={now} kind="neutral" />}
        delta={
          delta != null
            ? {
                dir: delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat",
                label: `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta))} vs ${prevLabel ?? "last month"}`,
              }
            : undefined
        }
        sub={
          <>
            Cash <Money value={cash} kind="neutral" /> · Cards <Money value={credit} kind="neutral" /> · Loans <Money value={loans} kind="neutral" />
          </>
        }
      />
      <div className="mt-3">
        <Sparkline points={trend} color={now < 0 ? "var(--mp-money-owed)" : "var(--mp-accent)"} highlightIndex={highlightIndex} />
      </div>
    </div>
  );
}

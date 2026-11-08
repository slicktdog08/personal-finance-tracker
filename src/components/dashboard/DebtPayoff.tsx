import { Money, ProgressBar, StatTile } from "@/components/ds";
import { formatMoney } from "@/server/lib/money";
import { shortMonthLabel } from "@/server/lib/period";

/**
 * Momentum on the high-interest debt: where it stands, how much this month's planned payments take
 * off it (the bar filling up is the paid-off share), what interest is costing, and — at the current
 * payment rate, avalanche order — when it's gone. Low-APR debt (student loans) is left out of the
 * payoff date on purpose; it's not the target, so it rides along as context only.
 */
export function DebtPayoff({
  hotNow,
  hotEnd,
  allNow,
  interest,
  paying,
  debtFreeOn,
  months,
  stalls,
  periodLabel,
}: {
  hotNow: number;
  hotEnd: number | null; // null when there's no projection (past month)
  allNow: number;
  interest: number;
  paying: number; // this month's planned payments toward high-interest debt
  debtFreeOn: string | null; // YYYY-MM
  months: number | null;
  stalls: boolean;
  periodLabel: string;
}) {
  const drop = hotEnd != null ? Math.max(0, hotNow - hotEnd) : null;
  const pct = drop != null && hotNow > 0 ? Math.min(100, (drop / hotNow) * 100) : null;
  const month = shortMonthLabel(periodLabel).replace(/ '\d\d$/, "");
  return (
    <div>
      <StatTile
        label="High-interest debt"
        value={hotNow}
        kind="owed"
        delta={drop != null && drop > 0 ? { dir: "up", label: <>−{formatMoney(drop)} by end of {month}</> } : undefined}
        sub={
          allNow > hotNow ? (
            <>
              <Money value={allNow} kind="neutral" /> incl. low-rate loans
            </>
          ) : undefined
        }
      />
      <ProgressBar
        value={drop ?? 0}
        max={hotNow || 1}
        color="var(--mp-money-income)"
        className="mt-3.5"
        label="Share of high-interest debt paid off this month"
        legendLeft={pct != null ? `${pct.toFixed(0)}% paid off this month` : "No projection for this month"}
        legendRight={
          stalls ? (
            <span className="text-over">Never debt-free at this rate</span>
          ) : debtFreeOn ? (
            `Debt-free ${shortMonthLabel(debtFreeOn)}`
          ) : (
            "No payoff date yet"
          )
        }
      />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
        <span>
          Interest <Money value={interest} kind="neutral" />
          /mo
        </span>
        {paying > 0 && (
          <span>
            Paying <Money value={paying} kind="neutral" />
            /mo
          </span>
        )}
        {months != null && debtFreeOn && !stalls && (
          <span>
            {months} month{months === 1 ? "" : "s"} to clear, highest APR first
          </span>
        )}
      </div>
      {stalls ? (
        <p className="mt-2 text-xs text-fg-2">{formatMoney(paying)}/mo doesn&apos;t outpace the interest — the balance never reaches zero.</p>
      ) : (
        !debtFreeOn && <p className="mt-2 text-xs text-fg-2">Plan debt payments in the budget to see a payoff date.</p>
      )}
    </div>
  );
}

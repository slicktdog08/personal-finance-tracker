import { formatMoney } from "@/server/lib/money";
import { shortMonthLabel } from "@/server/lib/period";
import { round2, type PayoffProjection } from "@/server/lib/budget";

/**
 * The one sentence both the wizard and the plan view say about the projection. It speaks about
 * HIGH-INTEREST debt only and names what's parked, so "debt-free" is never read as "student loan
 * gone too".
 */
export function ProjectionSummary({
  projection,
  monthlyBudget,
}: {
  projection: PayoffProjection;
  monthlyBudget: number;
}) {
  const mo = projection.minimumsOnly;
  const parked = projection.excluded;
  return (
    <>
      {projection.debtFreeOn ? (
        <>
          Putting {formatMoney(monthlyBudget)}/mo toward debt over {projection.minApr}% APR, you&apos;re{" "}
          <strong>free of high-interest debt by {shortMonthLabel(projection.debtFreeOn)}</strong> (
          {projection.months} month{projection.months === 1 ? "" : "s"}), paying about{" "}
          {formatMoney(projection.totalInterest)} in interest along the way.
          {mo?.debtFreeOn && mo.months > projection.months && (
            <>
              {" "}
              Minimums alone: {shortMonthLabel(mo.debtFreeOn)} and {formatMoney(mo.totalInterest)} interest — this
              plan saves <strong>{formatMoney(round2(mo.totalInterest - projection.totalInterest))}</strong> and{" "}
              {mo.months - projection.months} months.
            </>
          )}
        </>
      ) : (
        <>
          At this payment the high-interest balances never reach zero — a debt&apos;s payment isn&apos;t
          outrunning its interest. Raise the target&apos;s planned amount.
        </>
      )}
      {parked.length > 0 && (
        <span className="block mt-1 text-xs text-neutral-500">
          Not part of this:{" "}
          {parked
            .map(
              (d) =>
                `${d.label}${d.apr != null ? ` (${d.apr.toFixed(2)}%)` : ""} stays on its ${formatMoney(d.minPayment)} minimum`,
            )
            .join("; ")}
          . Cheap debt isn&apos;t worth racing.
        </span>
      )}
    </>
  );
}

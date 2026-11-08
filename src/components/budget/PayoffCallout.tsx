import { Badge, Glyph, Money } from "@/components/ds";
import { prettyPeriod, shortMonthLabel } from "@/server/lib/period";
import { round2, type PayoffProjection } from "@/server/lib/budget";

const longMonth = (label: string) => {
  const [y, m] = label.split("-").map(Number);
  return y && m ? prettyPeriod(y, m) : label;
};

/**
 * "If this plan holds…" — the payoff projection as one calm sentence, the numbers behind it, and
 * the debts in the order they fall. Speaks about HIGH-INTEREST debt only and names what's parked,
 * so "free of debt" is never read as "student loan gone too".
 */
export function PayoffCallout({ projection, monthlyBudget }: { projection: PayoffProjection; monthlyBudget: number }) {
  const mo = projection.minimumsOnly;
  const saved = mo?.debtFreeOn && mo.months > projection.months ? round2(mo.totalInterest - projection.totalInterest) : null;
  return (
    <section className="rounded-card bg-accent-soft p-5 md:p-6">
      <div className="flex items-start gap-3.5">
        <Glyph icon="flag" color="var(--mp-accent)" size="lg" className="max-sm:hidden" />
        <div className="grid min-w-0 gap-1.5">
          {projection.debtFreeOn ? (
            <p className="font-display text-[17px] font-semibold leading-snug text-fg">
              If this plan holds, you&apos;re free of high-interest debt by{" "}
              <span className="text-accent-text">{longMonth(projection.debtFreeOn)}</span>.
            </p>
          ) : (
            <p className="font-display text-[17px] font-semibold leading-snug text-fg">At this payment the high-interest balances never reach zero.</p>
          )}
          <p className="text-sm text-fg-2">
            {projection.debtFreeOn ? (
              <>
                <Money value={monthlyBudget} kind="neutral" whole />
                /mo toward debt over {projection.minApr}% APR — {projection.months} month{projection.months === 1 ? "" : "s"}, about{" "}
                <Money value={projection.totalInterest} kind="neutral" whole /> in interest along the way
                {saved != null && mo?.debtFreeOn ? (
                  <>
                    , and <Money value={saved} kind="income" sign="none" whole /> saved vs. minimums alone ({shortMonthLabel(mo.debtFreeOn)}, {mo.months - projection.months} months later).
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              <>A debt&apos;s payment isn&apos;t outrunning its interest. Raise the target&apos;s planned amount.</>
            )}
          </p>
          {projection.excluded.length > 0 && (
            <p className="text-xs text-fg-3">
              Not part of this:{" "}
              {projection.excluded.map((d, i) => (
                <span key={d.accountId}>
                  {i > 0 && "; "}
                  {d.label}
                  {d.apr != null && ` (${d.apr.toFixed(2)}%)`} stays on its <Money value={d.minPayment} kind="neutral" /> minimum
                </span>
              ))}
              . Cheap debt isn&apos;t worth racing.
            </p>
          )}
          {projection.debtFreeOn && projection.steps.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {projection.steps.map((s, i) => (
                <Badge
                  key={s.accountId}
                  variant="outline"
                  dot={false}
                  label={`${i + 1}. ${s.label} · ${Number.isFinite(s.monthsToPayoff) ? shortMonthLabel(s.paidOffOn) : "—"}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

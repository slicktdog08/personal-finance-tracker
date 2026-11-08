import { Card, Money, StatTile } from "@/components/ds";
import type { CashProjection } from "@/server/lib/cash-projection";
import { dayLabel } from "./kit";

/**
 * The one number to check before buying something: how much could leave today and still keep
 * every savings goal intact through the projection's low point. That is the spendable low (cash
 * minus goal-backed reserves, at the lowest day on the horizon) — so it already accounts for every
 * bill, debt payment and everyday envelope between now and then.
 *
 * Shown with its arithmetic beside it (cash − goals − what leaves before the low = safe) so the
 * figure is trusted rather than magic. Below zero means the plan as it stands dips into the
 * reserves; the hero then shows $0 and the sentence says by how much.
 */
export function SafeToSpend({ projection: p, className }: { projection: CashProjection; className?: string }) {
  const sp = p.spendable;
  const safe = sp.low.balance;
  const short = safe < 0;
  // Everything that leaves between now and the low point, net of any paycheck before it:
  // cash − reserved − toLow = safe, exactly.
  const toLow = p.start - sp.reserved - safe;
  const low = <b className="font-semibold">{dayLabel(sp.low.date)}</b>;
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <StatTile
          size="hero"
          label="Safe to spend"
          icon="shield-check"
          value={Math.max(0, safe)}
          kind={short ? "over" : "neutral"}
          className="max-w-[360px]"
          sub={
            short ? (
              <>
                <Money value={-safe} kind="over" sign="none" /> short of keeping goals whole through the {low} low point.
              </>
            ) : (
              <>Yours to spend and still keep goals whole through the {low} low point.</>
            )
          }
        />
        <div className="grid gap-2.5 text-sm min-w-0 w-full sm:w-auto sm:min-w-[220px] sm:flex-[0_1_280px]">
          <Row label="Cash on hand" value={<Money value={p.start} kind="neutral" />} />
          <Row label="Set aside for goals" value={<Money value={-sp.reserved} kind="muted" />} />
          <Row label="Bills & plan to the low" value={<Money value={-toLow} kind="muted" />} />
          <hr className="border-line" />
          <Row strong label="Safe to spend" value={<Money value={safe} kind={short ? "over" : "neutral"} />} />
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "font-semibold text-fg" : ""}`}>
      <span className={strong ? "" : "text-fg-2"}>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

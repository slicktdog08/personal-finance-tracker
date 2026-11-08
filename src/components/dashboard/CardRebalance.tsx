import { Glyph, Money, StatTile } from "@/components/ds";
import type { CardRebalance as CardRebalanceData } from "@/server/lib/card-rebalance";
import { LinkRow, dayLabel } from "./kit";

/**
 * "What do I owe my cards right now?" How far each card's balance (plus its pending charges) has
 * climbed above where it should be — the month's starting balance until the budget's payoff payment
 * is made, then the balance that payment leaves. The rule lives in server/lib/card-rebalance.ts.
 */
export function CardRebalance({ data }: { data: CardRebalanceData }) {
  const { rows, owe, missing } = data;
  const over = rows.filter((r) => r.owe > 0).length;
  return (
    <div>
      <StatTile
        label="Pay to rebalance"
        value={owe}
        kind={owe > 0 ? "owed" : "neutral"}
        sub={
          owe > 0
            ? `${over} card${over === 1 ? "" : "s"} over target · start of month, or the plan's balance once the payoff is paid`
            : "Every card is at or under its target"
        }
      />
      <div className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <LinkRow
            key={r.accountId}
            href="/debts"
            // Side by side from sm up, where a divider under only some of the cells reads as broken.
            className="sm:border-b-0!"
            lead={<Glyph icon="credit-card" color="var(--mp-money-owed)" size="sm" />}
            title={r.label}
            tooltip={`Started the month at ${r.start.toFixed(2)} (${dayLabel(r.startAsOf)})${r.planPaid ? `; payoff paid, so the plan's ${r.target.toFixed(2)} is the target` : ""}; balance ${r.balance.toFixed(2)} as of ${dayLabel(r.nowAsOf)}${r.pending ? ` ${r.pending > 0 ? "+" : "−"} ${Math.abs(r.pending).toFixed(2)} pending` : ""} = ${r.now.toFixed(2)}`}
            sub={
              <>
                {r.planPaid ? "After payoff" : "Started"} <Money value={r.target} kind="neutral" whole /> · now{" "}
                <Money value={r.now} kind="neutral" whole />
              </>
            }
            end={r.owe > 0 ? <Money value={r.owe} kind="owed" /> : <span className="text-fg-3">Not over</span>}
            endSub={
              r.now < r.target ? (
                <>
                  <Money value={r.target - r.now} kind="neutral" whole /> under
                </>
              ) : undefined
            }
          />
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-fg-3">
          Not counted (no balance recorded this month yet): {missing.join(", ")}
        </p>
      )}
    </div>
  );
}

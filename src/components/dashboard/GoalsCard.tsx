import { Glyph, Money, ProgressBar, type IconName } from "@/components/ds";
import type { GoalProgressRow } from "@/server/queries";
import { LinkRow, dayLabel } from "./kit";

const GOAL_ICONS: Record<string, IconName> = { savings: "piggy-bank", purchase: "shopping-bag", debt_payoff: "credit-card", custom: "target" };

/**
 * Savings goals: a row per goal, then a two-part bar — what the funding account really backs, and
 * (in rose) what the goal has regressed by when the account dipped under it. Reaching the target
 * turns the fill to income green; the reality check still applies after that.
 */
export function GoalsCard({ goals }: { goals: GoalProgressRow[] }) {
  return (
    <div className="space-y-4">
      {goals.map((g) => {
        const target = g.targetAmount;
        const achieved = target > 0 && g.funded >= target;
        const pct = target > 0 ? Math.round((g.funded / target) * 100) : 0;
        return (
          <div key={g.id}>
            <LinkRow
              href="/goals"
              lead={
                <Glyph icon={g.emoji ? undefined : GOAL_ICONS[g.goalType] ?? "target"} color={g.color}>
                  {g.emoji ? <span className="text-sm leading-none">{g.emoji}</span> : null}
                </Glyph>
              }
              title={g.name}
              sub={
                achieved
                  ? "Target reached"
                  : g.targetDate
                    ? `${pct}% · by ${dayLabel(g.targetDate)}`
                    : `${pct}% funded`
              }
              end={<Money value={g.funded} kind="neutral" />}
              endSub={
                <>
                  of <Money value={target} kind="neutral" />
                </>
              }
            />
            <ProgressBar
              segments={[
                { value: g.backed, color: achieved ? "var(--mp-money-income)" : g.color },
                ...(g.shortfall > 0 ? [{ value: g.shortfall, color: "var(--mp-money-over)" }] : []),
              ]}
              max={target || 1}
              className="mt-1.5"
              label={`${g.name} funded`}
              legendLeft={
                <>
                  Funded <Money value={g.backed} kind="neutral" />
                </>
              }
              legendRight={
                g.shortfall > 0 ? (
                  <span className="text-over">
                    Short <Money value={g.shortfall} kind="over" sign="none" />
                  </span>
                ) : achieved ? (
                  "Fully backed"
                ) : (
                  <>
                    <Money value={Math.max(0, target - g.funded)} kind="neutral" /> to go
                  </>
                )
              }
            />
          </div>
        );
      })}
    </div>
  );
}

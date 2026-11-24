import { Badge, Card, Money } from "@/components/ds";
import { PaceSparkline } from "@/components/charts/PaceChart";
import { CardLink } from "./kit";
import { LEVEL_LABEL, type PaceLevel } from "@/server/lib/spending-pace";

export const PACE_COLORS: Record<PaceLevel | "stale", string> = {
  green: "#16a34a",
  watch: "#d97706",
  warning: "#ea580c",
  alert: "#dc2626",
  stale: "#64748b",
};

export interface PaceCardData {
  status: PaceLevel;
  stale: boolean;
  avgMid: number;
  target: number;
  breakEven: number;
  remainingToday: number;
  midDays: number;
  sparkline: { date: string; value: number }[];
  lastSyncAt: string | null;
}

/**
 * The small Pace card: status, the 14-day average against target and break-even, and what's left
 * of today's allowance. Factual and quiet — numbers, not judgments.
 */
export function PaceCard({ data: d }: { data: PaceCardData }) {
  const level = d.stale ? "stale" : d.status;
  const over = d.remainingToday < 0;
  return (
    <Card title="Spending pace" meta={<Badge label={LEVEL_LABEL[level]} color={PACE_COLORS[level]} size="sm" />} action={<CardLink href="/pace">Details</CardLink>}>
      <div className="space-y-3">
        {d.stale && (
          <p className="text-sm text-fg-2">
            Bank sync hasn&apos;t completed recently{d.lastSyncAt ? ` (last ${d.lastSyncAt.slice(0, 10)})` : ""}, so the status isn&apos;t computed from incomplete data.
          </p>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-xs text-fg-3">{d.midDays}-day average</div>
            <div className="text-2xl font-semibold tabular-nums">
              <Money value={d.avgMid} kind="neutral" whole />
              <span className="text-sm font-normal text-fg-3">/day</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-fg-3">Left today</div>
            <div className="text-lg font-semibold tabular-nums">
              <Money value={d.remainingToday} kind={over ? "over" : "neutral"} whole />
            </div>
          </div>
        </div>
        <PaceSparkline points={d.sparkline} target={d.target} breakEven={d.breakEven} label={`${d.midDays}-day average spending per day`} />
      </div>
    </Card>
  );
}

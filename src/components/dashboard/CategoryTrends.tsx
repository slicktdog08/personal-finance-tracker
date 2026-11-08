import { Glyph, Money } from "@/components/ds";
import { Sparkline } from "@/components/charts/Sparkline";
import { LinkRow } from "./kit";

export interface CategoryTrendRow {
  key: string;
  name: string;
  emoji: string | null;
  color: string | null;
  href: string;
  points: { label: string; value: number | null }[]; // oldest → newest, selected month last
  current: number;
  avg: number | null; // mean of the earlier months that had spend
}

/**
 * Small multiples: one row per big category with its last few months as a sparkline, this month's
 * figure, and how it compares to its own recent average — "is groceries creeping up?" at a glance.
 * A partial month naturally reads low against the average; the caller says so in the title.
 */
export function CategoryTrends({ rows }: { rows: CategoryTrendRow[] }) {
  if (!rows.length) return <p className="text-sm text-fg-3">Not enough history yet.</p>;
  return (
    <div>
      {rows.map((r) => {
        const diff = r.avg != null && r.avg > 0 ? ((r.current - r.avg) / r.avg) * 100 : null;
        return (
          <LinkRow
            key={r.key}
            href={r.href}
            lead={
              <Glyph color={r.color} size="sm" icon={r.emoji ? undefined : "tag"}>
                {r.emoji ? <span className="text-xs leading-none">{r.emoji}</span> : null}
              </Glyph>
            }
            title={
              <span className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="w-20 shrink-0 sm:w-28">
                  <Sparkline points={r.points} color={r.color || "var(--mp-money-plan)"} highlightIndex={r.points.length - 1} />
                </span>
              </span>
            }
            end={<Money value={r.current} kind="neutral" />}
            endSub={
              diff != null ? (
                <span className={diff > 10 ? "text-over" : diff < -10 ? "text-income" : undefined}>
                  {diff >= 0 ? "+" : "−"}
                  {Math.abs(diff).toFixed(0)}% vs avg
                </span>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}

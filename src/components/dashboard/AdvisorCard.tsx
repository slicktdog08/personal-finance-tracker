import Link from "next/link";
import { Badge, Money } from "@/components/ds";
import { CATEGORY_LABEL, SEVERITY_META, type AdvisorInsightDto } from "@/lib/advisor";
import { dayLabel } from "./kit";

/**
 * What the advisor has flagged and nobody has dealt with yet — the worst first, a handful at most.
 * The dashboard's own panels show the numbers; this is the one place that says what they mean
 * (drift, creep, a leak). Reading it here doesn't mark anything seen: that happens on Insights,
 * where a finding can be acted on.
 */
export function AdvisorCard({
  insights,
  checkin,
}: {
  insights: AdvisorInsightDto[];
  /** The latest daily check-in's one-line summary, when there is one. */
  checkin: { summary: string; finishedAt: string | null } | null;
}) {
  return (
    <div className="space-y-3">
      {insights.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
          {insights.map((i) => {
            const sev = SEVERITY_META[i.severity];
            return (
              <Link
                key={i.id}
                href="/insights"
                className="flex min-w-0 flex-col gap-1.5 rounded-control border border-line p-3 transition-colors hover:bg-hover"
              >
                <div className="flex items-center gap-2 text-[11px] text-fg-3">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `oklch(from ${sev.color} var(--mp-tint-dot-l) c h)` }} />
                  <span className="truncate">
                    {sev.label} · {CATEGORY_LABEL[i.category]}
                  </span>
                  {i.status === "new" && <Badge variant="pending" size="sm" label="New" className="ml-auto shrink-0" />}
                </div>
                <div className="text-sm font-medium leading-snug text-pretty">{i.title}</div>
                <p className="line-clamp-2 text-xs leading-relaxed text-fg-2">{plain(i.body)}</p>
                {i.amount != null && (
                  <div className="mt-auto pt-1 text-sm font-semibold">
                    <Money value={i.amount} kind="neutral" />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-fg-3">Nothing open. New findings land here after the next insights run.</p>
      )}
      {checkin && (
        <p className="flex items-baseline gap-2 border-t border-line pt-3 text-xs text-fg-2">
          <span className="shrink-0 text-fg-3">Check-in{checkin.finishedAt ? ` · ${dayLabel(checkin.finishedAt)}` : ""}</span>
          <span className="line-clamp-2 min-w-0">{plain(checkin.summary)}</span>
        </p>
      )}
    </div>
  );
}

/** Findings are written in Markdown; a two-line teaser reads better without the punctuation. */
const plain = (md: string) =>
  md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

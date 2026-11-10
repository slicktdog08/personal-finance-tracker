"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Icon, Money, buttonClass } from "@/components/ds";
import { CATEGORY_LABEL, SEVERITY_META, type AdvisorInsightDto, type InsightStatus } from "@/lib/advisor";
import { updateInsightStatus } from "@/server/actions/advisor";
import { Markdown } from "./Markdown";

function evidenceHref(i: AdvisorInsightDto): string | null {
  if (!i.search && !i.period) return null;
  const sp = new URLSearchParams();
  if (i.search) sp.set("q", i.search);
  if (i.period) sp.set("period", i.period);
  return `/transactions?${sp.toString()}`;
}

/**
 * One finding. Done = "handled it" (it comes back as new if a later run sees it again);
 * Dismiss = "not useful" (it stays dismissed, and the routine is told not to raise it again).
 */
export function InsightCard({ insight }: { insight: AdvisorInsightDto }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sev = SEVERITY_META[insight.severity];
  const href = evidenceHref(insight);
  const closed = insight.status === "done" || insight.status === "dismissed";

  const set = (status: InsightStatus) =>
    start(async () => {
      await updateInsightStatus([insight.id], status);
      router.refresh();
    });

  return (
    <Card className={closed ? "opacity-70" : undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={sev.label} color={sev.color} size="sm" />
          <Badge label={CATEGORY_LABEL[insight.category]} variant="outline" dot={false} size="sm" />
          {insight.status === "new" && <Badge label="New" color="#10b981" size="sm" />}
          {insight.occurrences > 1 && (
            <span className="text-xs text-fg-3" title="How many runs have reported this">
              seen {insight.occurrences}×
            </span>
          )}
          {insight.amount != null && (
            <span className="ml-auto text-sm font-semibold">
              <Money value={Math.abs(insight.amount)} kind="neutral" sign="none" whole />
            </span>
          )}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug text-fg">{insight.title}</h3>
        <Markdown text={insight.body} className="text-fg-2" />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {href && (
            <Link href={href} className={buttonClass({ variant: "soft", size: "sm" })}>
              <Icon name="search" size={15} /> See transactions
            </Link>
          )}
          <Link href={`/advisor?ask=${insight.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <Icon name="message-circle" size={15} /> Ask about this
          </Link>
          <span className="ml-auto flex gap-1">
            {closed ? (
              <Button size="sm" variant="ghost" icon="rotate-ccw" loading={pending} onClick={() => set("seen")}>
                Reopen
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" icon="check" loading={pending} onClick={() => set("done")}>
                  Done
                </Button>
                <Button size="sm" variant="ghost" icon="x" disabled={pending} onClick={() => set("dismissed")} title="Not useful: don't raise this again">
                  Dismiss
                </Button>
              </>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

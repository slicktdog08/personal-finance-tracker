import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { Card, EmptyState, Icon, Notice, PageHeader, buttonClass } from "@/components/ds";
import { InsightCard } from "@/components/advisor/InsightCard";
import { LiveRefresh } from "@/components/advisor/LiveRefresh";
import { Markdown } from "@/components/advisor/Markdown";
import { RoutineButtons } from "@/components/advisor/RoutineButtons";
import { RunList } from "@/components/advisor/RunList";
import { isActive, type AdvisorInsightDto } from "@/lib/advisor";
import { routineConfigured } from "@/server/lib/advisor/routine";
import { latestCheckin, listInsights, listRuns, markInsightsSeen, sweepStale } from "@/server/lib/advisor/store";

export const dynamic = "force-dynamic";

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function InsightsPage() {
  let open: AdvisorInsightDto[], closed: AdvisorInsightDto[], runs, checkin;
  try {
    await sweepStale();
    [open, closed, runs, checkin] = await Promise.all([
      listInsights({ statuses: ["new", "seen"], limit: 60 }),
      listInsights({ statuses: ["done", "dismissed"], limit: 40 }),
      listRuns({ limit: 15 }),
      latestCheckin(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  // Rendered with their "New" badge this once; the next visit shows them as seen.
  await markInsightsSeen(open.filter((i) => i.status === "new").map((i) => i.id)).catch(() => {});

  const active = runs.filter((r) => isActive(r.status));
  const busy = {
    insights: active.some((r) => r.kind === "insights"),
    checkin: active.some((r) => r.kind === "checkin"),
  };
  const configured = routineConfigured();

  return (
    <div className="space-y-6">
      <LiveRefresh active={active.length > 0} />
      <PageHeader
        title="Insights"
        description="What Claude notices in your transactions that the screens don't show: drift, creep, timing and leaks. Runs on your Claude routine, so no API credit."
        actions={configured ? <RoutineButtons busy={busy} /> : undefined}
      />

      {!configured && (
        <Notice tone="warn" title="The advisor routine isn't connected yet">
          Set <code>CLAUDE_ADVISOR_ROUTINE_ID</code> and <code>CLAUDE_ADVISOR_ROUTINE_TOKEN</code> on the server to run insights and chat from here.
          Scheduled routines that use the MCP connector still report their runs below. Setup: planning/features/ai-advisor.md.
        </Notice>
      )}

      {busy.insights && (
        <Notice tone="info" icon="loader-circle" title="Claude is going through your transactions">
          New findings appear here as soon as the run saves them. You can leave this page; the run keeps going.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {open.length ? (
            open.map((i) => <InsightCard key={i.id} insight={i} />)
          ) : (
            <Card>
              <EmptyState
                icon="sparkles"
                title="No open insights"
                body={configured ? "Generate insights to have Claude look for patterns across your recent months." : "Once the routine is connected, findings show up here."}
              />
            </Card>
          )}

          {closed.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-fg-2 hover:text-fg">
                <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
                Done and dismissed ({closed.length})
              </summary>
              <div className="mt-3 space-y-4">
                {closed.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="space-y-4">
          <Card
            title="Latest check-in"
            icon={<Icon name="calendar-check" size={16} />}
            meta={checkin?.finishedAt ? <span suppressHydrationWarning>{fmtWhen(checkin.finishedAt)}</span> : undefined}
          >
            {checkin?.report ? (
              <Markdown text={checkin.report} className="text-fg-2" />
            ) : checkin?.summary ? (
              <p className="text-sm text-fg-2">{checkin.summary}</p>
            ) : (
              <p className="text-sm text-fg-3">The daily check-in lands here once its routine records it.</p>
            )}
          </Card>

          <Card
            title="Ask the advisor"
            icon={<Icon name="message-circle" size={16} />}
            action={
              <Link href="/advisor" className={buttonClass({ variant: "ghost", size: "sm" })}>
                Open
              </Link>
            }
          >
            <p className="text-sm text-fg-2">Questions about your money, answered from your own data.</p>
          </Card>

          <Card title="Runs" icon={<Icon name="history" size={16} />} meta={active.length ? `${active.length} in progress` : undefined}>
            <RunList runs={runs} />
          </Card>
        </div>
      </div>
    </div>
  );
}

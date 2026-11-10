import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { Card, Icon, Notice, PageHeader, buttonClass, cx } from "@/components/ds";
import { ChatView } from "@/components/advisor/ChatView";
import { LiveRefresh } from "@/components/advisor/LiveRefresh";
import { isActive } from "@/lib/advisor";
import { routineConfigured } from "@/server/lib/advisor/routine";
import { countNewInsights, getInsight, getThread, listMessages, listRuns, listThreads, sweepStale } from "@/server/lib/advisor/store";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const positiveInt = (v: string | undefined) => (v && /^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : null);

const ago = (iso: string) => {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, Math.floor(mins))}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};

/** `?ask=<insight id>` (the "Ask about this" button) starts a new chat prefilled with the card. */
async function draftFromInsight(id: number | null): Promise<string> {
  if (!id) return "";
  const insight = await getInsight(id);
  return insight ? `About the insight "${insight.title}": ` : "";
}

export default async function AdvisorPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const threadId = positiveInt(one(sp.t));
  const askId = positiveInt(one(sp.ask));

  let threads, thread, messages, runs, draft, openCount;
  try {
    await sweepStale();
    [threads, thread, messages, runs, draft, openCount] = await Promise.all([
      listThreads(40),
      threadId ? getThread(threadId) : Promise.resolve(null),
      threadId ? listMessages(threadId) : Promise.resolve([]),
      threadId ? listRuns({ kind: "chat", threadId, limit: 5 }) : Promise.resolve([]),
      threadId ? Promise.resolve("") : draftFromInsight(askId),
      countNewInsights(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  const activeRun = runs.find((r) => isActive(r.status)) ?? null;
  const waiting = Boolean(activeRun) || messages.some((m) => m.role === "user" && m.status === "pending");
  const configured = routineConfigured();

  return (
    <div className="space-y-6">
      <LiveRefresh active={waiting} threadId={thread?.id ?? null} />
      <PageHeader
        title="Advisor"
        description="Talk to your financial advisor here. Each message runs on your Claude routine and is answered from your own data."
        actions={
          <div className="flex gap-2">
            <Link href="/insights" className={buttonClass({ variant: "secondary" })}>
              <Icon name="sparkles" size={16} /> Insights{openCount ? ` (${openCount} new)` : ""}
            </Link>
            <Link href="/advisor" className={buttonClass({ variant: "primary" })}>
              <Icon name="plus" size={16} /> New chat
            </Link>
          </div>
        }
      />

      {!configured && (
        <Notice tone="warn" title="The advisor routine isn't connected yet">
          Set <code>CLAUDE_ADVISOR_ROUTINE_ID</code> and <code>CLAUDE_ADVISOR_ROUTINE_TOKEN</code> on the server to chat from here (planning/features/ai-advisor.md).
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card title="Conversations" icon={<Icon name="message-circle" size={16} />} padded={false} className="max-lg:order-2 self-start">
          {threads.length ? (
            <ul className="divide-y divide-line">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/advisor?t=${t.id}`}
                    aria-current={t.id === thread?.id ? "page" : undefined}
                    className={cx("block px-4 py-3 hover:bg-hover", t.id === thread?.id && "bg-accent-soft")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{t.title}</span>
                      {t.pending > 0 && <Icon name="loader-circle" size={13} className="mp-spinner text-fg-3" />}
                      <span className="shrink-0 text-xs text-fg-3" suppressHydrationWarning>
                        {ago(t.updatedAt)}
                      </span>
                    </div>
                    {t.preview && <p className="mt-0.5 truncate text-xs text-fg-3">{t.preview}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-fg-3">Your conversations will be listed here.</p>
          )}
        </Card>

        <Card
          title={thread ? thread.title : "New conversation"}
          icon={<Icon name="sparkles" size={16} />}
          className="max-lg:order-1"
        >
          {threadId && !thread ? (
            <p className="text-sm text-fg-2">That conversation no longer exists. Start a new one.</p>
          ) : (
            <ChatView
              key={thread?.id ?? `new-${askId ?? ""}`}
              threadId={thread?.id ?? null}
              messages={messages}
              sessionUrl={activeRun?.sessionUrl ?? null}
              working={Boolean(activeRun)}
              initialDraft={draft}
              canSend={configured}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

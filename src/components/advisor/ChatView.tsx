"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, Notice, cx } from "@/components/ds";
import { CATEGORIZE_PROMPT, type AdvisorMessageDto } from "@/lib/advisor";
import { sendAdvisorMessage } from "@/server/actions/advisor";
import { Markdown } from "./Markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { mergeMessages, useLiveThread } from "./useLiveThread";

const SUGGESTIONS = [
  CATEGORIZE_PROMPT,
  "What changed in my spending this month compared to the last three?",
  "Which subscriptions or recurring charges went up this year?",
  "Am I on track to cover every bill before my next paycheck?",
  "What's the fastest way to cut my interest costs?",
];

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * One conversation with the advisor. A sent message is stored as pending and fires the
 * routine; while it answers, useLiveThread streams its reply and current step into the page
 * (/api/advisor/stream), and the page refreshes once when it's done.
 * threadId null = a new conversation (the first send creates it and navigates there).
 */
export function ChatView({
  threadId,
  messages,
  sessionUrl,
  working,
  initialDraft = "",
  canSend,
}: {
  threadId: number | null;
  messages: AdvisorMessageDto[];
  /** The Claude Code session of the run answering right now, if any. */
  sessionUrl: string | null;
  /** A run is answering this thread. */
  working: boolean;
  initialDraft?: string;
  canSend: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<AdvisorMessageDto | null>(null);
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // The server copy replaces the optimistic one once the page re-renders with it.
  const base = optimistic && !messages.some((m) => m.id === optimistic.id) ? [...messages, optimistic] : messages;
  const serverWaiting = working || base.some((m) => (m.role === "user" && m.status === "pending") || m.status === "streaming");
  const live = useLiveThread(threadId, serverWaiting);
  const shown = mergeMessages(base, live.messages);
  const streaming = shown.some((m) => m.status === "streaming");
  const waiting = serverWaiting && !shown.some((m) => m.role === "assistant" && m.status !== "streaming" && m.id > lastUserId(shown));
  const streamedLength = shown.reduce((n, m) => (m.status === "streaming" ? n + m.body.length : n), 0);
  const watchUrl = live.sessionUrl ?? sessionUrl;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [shown.length, waiting, streamedLength]);

  const send = (text: string) => {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    start(async () => {
      const res = await sendAdvisorMessage(threadId, body);
      if (res.status === "error") {
        setError(res.message);
        if (res.threadId && res.threadId !== threadId) router.push(`/advisor?t=${res.threadId}`);
        else router.refresh();
        return;
      }
      setDraft("");
      setOptimistic(res.message);
      if (res.threadId !== threadId) router.push(`/advisor?t=${res.threadId}`);
      else router.refresh();
    });
  };

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-4 pb-4">
        {shown.length === 0 && (
          <div className="space-y-3 py-6">
            <p className="text-sm text-fg-2">Ask anything about your money. Claude answers from your own accounts, bills, budget and transactions.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm text-fg-2 hover:bg-hover hover:text-fg"
                  onClick={() => {
                    setDraft(s);
                    input.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {shown.map((m) => (
          <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cx(
                "max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[80%]",
                m.role === "user" ? "bg-accent-soft text-fg" : "border border-line bg-surface text-fg",
                m.status === "failed" && "border-danger/40",
              )}
            >
              {m.role === "assistant" && (
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg-3">
                  <Icon name="sparkles" size={13} /> Advisor
                  {m.status === "streaming" && <span className="font-normal">· writing…</span>}
                </div>
              )}
              {m.role === "assistant" ? (
                m.status === "streaming" ? <StreamingMarkdown text={m.body} /> : <Markdown text={m.body} />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
              )}
              <div className="mt-1.5 text-[11px] text-fg-3" suppressHydrationWarning>
                {time(m.createdAt)}
                {m.role === "user" && m.status === "pending" && " · waiting for Claude"}
                {m.status === "failed" && <span className="text-danger"> · {m.role === "user" ? "not answered" : "couldn't finish"}</span>}
              </div>
            </div>
          </div>
        ))}

        {waiting && (
          <div className="flex items-center gap-2 text-sm text-fg-2" role="status" aria-live="polite">
            <Icon name="loader-circle" size={16} className="mp-spinner" />
            <span className="min-w-0 truncate">{live.activity || (streaming ? "Claude is writing…" : "Claude is looking into it…")}</span>
            {watchUrl && (
              <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
                watch the session <Icon name="external-link" size={12} />
              </a>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && (
        <Notice tone="danger" className="mb-3">
          {error}
        </Notice>
      )}

      <form
        className="flex items-end gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={Math.min(6, Math.max(1, draft.split("\n").length))}
          maxLength={8000}
          disabled={!canSend}
          placeholder={canSend ? (waiting ? "Add to your question…" : "Ask about your finances…") : "Connect the advisor routine to chat here"}
          aria-label="Message the advisor"
          className="mp-input flex-1 resize-none"
          style={{ height: "auto", minHeight: 44, lineHeight: 1.5, paddingTop: 10, paddingBottom: 10 }}
        />
        <Button type="submit" icon="send" loading={pending} disabled={!canSend || !draft.trim()} aria-label="Send">
          Send
        </Button>
      </form>
    </div>
  );
}

function lastUserId(messages: AdvisorMessageDto[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].id;
  return 0;
}

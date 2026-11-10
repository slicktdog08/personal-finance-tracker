"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, cx } from "@/components/ds";
import { RUN_KIND_LABEL, isActive, runDuration, type AdvisorRunDto } from "@/lib/advisor";

const DOT: Record<AdvisorRunDto["status"], string> = {
  queued: "bg-warn animate-pulse",
  running: "bg-warn animate-pulse",
  ok: "bg-ok",
  failed: "bg-danger",
};
const STATUS_LABEL: Record<AdvisorRunDto["status"], string> = {
  queued: "Waiting for Claude",
  running: "Working",
  ok: "Done",
  failed: "Failed",
};
const TRIGGER_LABEL: Record<AdvisorRunDto["trigger"], string> = { app: "from the app", cron: "scheduled", manual: "from claude.ai" };

const when = (isoStr: string) =>
  new Date(isoStr).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The routine's runs, newest first: what kind, how it's going, how long it took, and a link
 * to the Claude Code session so the work itself can be watched on claude.ai.
 */
export function RunList({ runs, empty = "Runs show up here once a routine reports in." }: { runs: AdvisorRunDto[]; empty?: string }) {
  const anyActive = runs.some((r) => isActive(r.status));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyActive]);

  if (!runs.length) return <p className="px-1 py-4 text-center text-sm text-fg-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {runs.map((run) => (
        <li key={run.id} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className={cx("h-2 w-2 shrink-0 rounded-full", DOT[run.status])} aria-hidden />
            <span className="font-semibold text-fg">{RUN_KIND_LABEL[run.kind]}</span>
            <span className={run.status === "failed" ? "text-danger" : "text-fg-2"}>{STATUS_LABEL[run.status]}</span>
            <span className="text-fg-3" suppressHydrationWarning>
              {when(run.startedAt)} · {runDuration(run, now)} · {TRIGGER_LABEL[run.trigger]}
            </span>
            {run.kind === "chat" && run.threadId && (
              <Link href={`/advisor?t=${run.threadId}`} className="rounded bg-sunken px-1.5 text-xs text-fg-2 hover:text-fg">
                thread
              </Link>
            )}
            {run.insightsSaved > 0 && <span className="text-xs text-fg-3">{run.insightsSaved} insight{run.insightsSaved === 1 ? "" : "s"}</span>}
            {run.sessionUrl && (
              <a href={run.sessionUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
                Session <Icon name="external-link" size={12} />
              </a>
            )}
          </div>
          {run.summary && <p className="mt-1 pl-4 text-xs leading-relaxed text-fg-2 line-clamp-3" title={run.summary}>{run.summary}</p>}
        </li>
      ))}
    </ul>
  );
}

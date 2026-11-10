"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { advisorLiveState } from "@/server/actions/advisor";

const POLL_MS = 4_000;

/**
 * While a routine run is in flight, poll the advisor tables and refresh the page when a run
 * or the open thread changes — the routine writes back through the MCP connector, so there
 * is no push channel to the browser. Idle pages don't poll at all, and a hidden tab pauses.
 */
export function LiveRefresh({ active, threadId = null }: { active: boolean; threadId?: number | null }) {
  const router = useRouter();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const { runs, messages } = await advisorLiveState(threadId);
          const key = JSON.stringify([
            runs.map((r) => [r.id, r.status, r.insightsSaved, r.sessionUrl]),
            messages?.map((m) => [m.id, m.status]) ?? null,
          ]);
          if (last.current !== null && key !== last.current) router.refresh();
          last.current = key;
        } catch {
          // A failed poll (deploy, network) just waits for the next tick.
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      last.current = null;
    };
  }, [active, threadId, router]);

  return null;
}

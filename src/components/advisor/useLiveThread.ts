"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdvisorMessageDto } from "@/lib/advisor";

export interface LiveThread {
  /** The newest messages as the stream last saw them (null until the first event). */
  messages: AdvisorMessageDto[] | null;
  /** What the run says it's doing right now. */
  activity: string | null;
  sessionUrl: string | null;
}

/**
 * Subscribe to /api/advisor/stream while a run answers this thread: the reply appears as the
 * run streams it, with its current step. When the stream says nothing more is coming, the page
 * refreshes once so everything else (thread list, run status) catches up.
 */
export function useLiveThread(threadId: number | null, active: boolean): LiveThread {
  const router = useRouter();
  const [live, setLive] = useState<LiveThread>({ messages: null, activity: null, sessionUrl: null });
  const doneRef = useRef(false);

  useEffect(() => {
    if (!threadId || !active || typeof EventSource === "undefined") return;
    doneRef.current = false;
    const source = new EventSource(`/api/advisor/stream?thread=${threadId}`);
    source.addEventListener("state", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as {
          run: { activity: string | null; sessionUrl: string | null } | null;
          messages: AdvisorMessageDto[];
        };
        setLive({ messages: data.messages, activity: data.run?.activity ?? null, sessionUrl: data.run?.sessionUrl ?? null });
      } catch {
        // A malformed event is skipped; the next one carries the full state again.
      }
    });
    source.addEventListener("done", () => {
      doneRef.current = true;
      source.close();
      setLive((l) => ({ ...l, activity: null }));
      router.refresh();
    });
    // EventSource reconnects by itself after a dropped connection (and after the server ends
    // a long stream), so errors need no handling beyond not reconnecting once we're done.
    source.onerror = () => {
      if (doneRef.current) source.close();
    };
    return () => source.close();
  }, [threadId, active, router]);

  return live;
}

/** Server-rendered messages overlaid with the live ones (same id → the live copy is newer). */
export function mergeMessages(server: AdvisorMessageDto[], live: AdvisorMessageDto[] | null): AdvisorMessageDto[] {
  if (!live?.length) return server;
  const byId = new Map(server.map((m) => [m.id, m]));
  for (const m of live) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

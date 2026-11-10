"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ds";
import { generateInsights, runCheckinNow } from "@/server/actions/advisor";
import type { RequestResult } from "@/server/lib/advisor/requests";

type Kind = "insights" | "checkin";
const LABEL: Record<Kind, string> = { insights: "Generate insights", checkin: "Run check-in" };

/**
 * The Insights page's two triggers. Each fires the advisor routine (a Claude Code run on the
 * owner's plan, no API credit) and the page then follows the run through LiveRefresh. A click
 * while a run of the same kind is going says so and offers to start another anyway.
 */
export function RoutineButtons({ busy }: { busy: Partial<Record<Kind, boolean>> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<Kind | null>(null);
  const [result, setResult] = useState<{ kind: Kind; res: RequestResult } | null>(null);

  const fire = (kind: Kind, force = false) =>
    start(async () => {
      setWhich(kind);
      const res = kind === "insights" ? await generateInsights(force) : await runCheckinNow(force);
      setResult({ kind, res });
      router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon="calendar-check" loading={pending && which === "checkin"} disabled={pending || busy.checkin} onClick={() => fire("checkin")}>
          {busy.checkin ? "Check-in running…" : LABEL.checkin}
        </Button>
        <Button icon="sparkles" loading={pending && which === "insights"} disabled={pending || busy.insights} onClick={() => fire("insights")}>
          {busy.insights ? "Finding insights…" : LABEL.insights}
        </Button>
      </div>
      {result?.res.status === "error" && (
        <Notice tone="danger" className="max-w-md">
          {result.res.message}
        </Notice>
      )}
      {result?.res.status === "running" && (
        <Notice
          tone="info"
          className="max-w-md"
          action={
            <Button size="sm" variant="ghost" onClick={() => fire(result.kind, true)}>
              Start another
            </Button>
          }
        >
          A run is already going; this page will update when it reports back.
        </Notice>
      )}
    </div>
  );
}

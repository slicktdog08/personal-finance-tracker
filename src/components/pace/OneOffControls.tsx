"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ds";
import { removeOneOff, tagOneOff } from "@/server/actions/pace";

/** "Spread over 90 days" / "Exclude" for one charge. Tagging is only ever this explicit click. */
export function TagOneOff({ txnId, spreadDays }: { txnId: number; spreadDays: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tag = (mode: "spread" | "exclude") =>
    start(async () => {
      const note = window.prompt(mode === "spread" ? `Note for this one-off (spread over ${spreadDays} days):` : "Note for this one-off (excluded):", "") ?? null;
      const r = await tagOneOff(txnId, mode, note);
      setError(r.ok ? null : (r.error ?? "Could not tag it."));
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => tag("spread")}>
        Spread {spreadDays}d
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => tag("exclude")}>
        Exclude
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export function RemoveOneOff({ txnId }: { txnId: number }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => start(() => removeOneOff(txnId))}>
      Remove tag
    </Button>
  );
}

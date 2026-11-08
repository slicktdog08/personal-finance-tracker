"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { keepPendingSeparate, mergePendingTransaction, setTransactionPending } from "@/server/actions/transactions";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { Button, Money, Notice } from "@/components/ds";
import type { PendingReviewItem } from "@/server/pending";

// The pending-transactions tray on /transactions, drawn as the kit's neutral pending Notice.
// Each charge entered by hand before it posted either has a likely posted twin (same account
// and direction, close date, amount within a tip's reach) — one click merges them so the
// charge counts once — or is still waiting on the bank. "Mark posted" clears the flag for one
// that will never show up in an import (or already did under a different account); "Keep
// both" does the same when the suggested twin is a different charge.
export function PendingReview({ items }: { items: PendingReviewItem[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // Collapsed by default: the notice's headline + first match already say what's going on,
  // and the list is one click away.
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  if (!items.length) return null;
  const matched = items.filter((i) => i.match);

  function merge(item: PendingReviewItem) {
    if (!item.match) return;
    setError("");
    start(async () => {
      const res = await mergePendingTransaction(item.pending.id, item.match!.id, "/transactions");
      if (!res.ok) {
        setError(res.error);
        router.refresh();
      }
    });
  }

  function mergeAll() {
    setError("");
    start(async () => {
      const errors: string[] = [];
      for (const item of matched) {
        const res = await mergePendingTransaction(item.pending.id, item.match!.id, "/transactions");
        if (!res.ok) errors.push(res.error);
      }
      if (errors.length) {
        setError(errors.join(" "));
        router.refresh();
      }
    });
  }

  function clearPending(id: number) {
    start(async () => {
      const res = await setTransactionPending(id, false, "/transactions");
      if (!res.ok) {
        setError(res.error ?? "Couldn't mark it posted.");
        router.refresh();
      }
    });
  }

  function keepBoth(pendingId: number, postedId: number) {
    start(async () => {
      const res = await keepPendingSeparate(pendingId, postedId, "/transactions");
      if (!res.ok) {
        setError(res.error ?? "Couldn't keep them separate.");
        router.refresh();
      }
    });
  }

  const signed = (dir: string, amount: number) => (dir === "Credit" ? amount : -amount);
  // The tip gap, phrased the way you'd say it: "$4.46 tip?" only for a charge that grew.
  const gapNote = (p: PendingReviewItem["pending"], m: NonNullable<PendingReviewItem["match"]>) => {
    const diff = Math.round((m.amount - p.amount) * 100) / 100;
    if (diff === 0) return "";
    return ` (${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))}${
      diff > 0 && p.direction === "Debit" ? " tip?" : ""
    })`;
  };
  const first = matched[0];

  return (
    <Notice
      tone="neutral"
      icon="clock-3"
      title={
        <>
          {items.length} pending
          {matched.length > 0 && ` · ${matched.length} look${matched.length === 1 ? "s" : ""} posted`}
        </>
      }
      action={
        matched.length > 0 ? (
          <Button size="sm" variant="secondary" icon="merge" onClick={mergeAll} disabled={busy}>
            Merge {matched.length}
          </Button>
        ) : undefined
      }
    >
      <p>
        {first?.match ? (
          <>
            {first.pending.description} posted as {formatMoney(first.match.amount)}
            {gapNote(first.pending, first.match)}.{" "}
          </>
        ) : (
          <>Entered by hand and waiting for the bank to post. </>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="font-medium text-accent-text hover:underline"
        >
          {open ? "Hide the list" : `Review ${items.length === 1 ? "it" : `all ${items.length}`}`}
        </button>
      </p>
      {error && <p className="mt-1 text-xs text-over">{error}</p>}
      {open && (
        <ul className="mt-2 divide-y divide-line rounded-panel border border-line bg-surface text-sm">
          {items.map((item) => {
            const p = item.pending;
            const m = item.match;
            return (
              <li key={p.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="truncate font-medium text-fg" title={p.description}>
                    {p.description}
                  </div>
                  <div className="text-xs text-fg-3 tabular-nums">
                    {formatDate(p.txnDate)} · {p.accountLabel ?? p.accountNumber ?? "no account"} ·{" "}
                    <Money value={signed(p.direction, p.amount)} kind="pending" />
                  </div>
                </div>
                {m ? (
                  <>
                    <div className="min-w-0 flex-1 basis-56 text-xs">
                      <div className="text-fg-3">Posted as</div>
                      <div className="truncate text-fg" title={m.description}>
                        {m.description}
                      </div>
                      <div className="text-fg-3 tabular-nums">
                        {formatDate(m.txnDate)} · <Money value={signed(p.direction, m.amount)} />
                        <span className="text-warn">{gapNote(p, m)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="merge"
                        onClick={() => merge(item)}
                        disabled={busy}
                        title="Keep the bank's row, carry over your category and notes, and remove this pending entry"
                      >
                        Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => keepBoth(p.id, m.id)}
                        disabled={busy}
                        title="Not the same charge — stop suggesting this pair and keep both transactions"
                      >
                        Keep both
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-fg-3">
                      {p.synced ? "The bank settles it on a later sync" : "Waiting for it to post"}
                    </span>
                    {!p.synced && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => clearPending(p.id)}
                        disabled={busy}
                        title="Stop tracking this as pending — keep it as a regular transaction"
                      >
                        Mark posted
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Notice>
  );
}

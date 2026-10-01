"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergePendingTransaction, setTransactionPending } from "@/server/actions/transactions";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { PendingReviewItem } from "@/server/pending";

// The pending-transactions tray on /transactions. Each charge entered by hand before it
// posted either has a likely posted twin (same account and direction, close date, amount
// within a tip's reach) — one click merges them so the charge counts once — or is still
// waiting on the bank. "Posted" clears the flag for one that will never show up in an
// import (or already did under a different account); "Keep both" does the same when the
// suggested twin is a different charge.
export function PendingReview({ items }: { items: PendingReviewItem[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");

  if (!items.length) return null;
  const matched = items.filter((i) => i.match);

  function merge(item: PendingReviewItem) {
    if (!item.match) return;
    setError("");
    start(async () => {
      const res = await mergePendingTransaction(item.pending.id, item.match!.id, "/transactions");
      if (!res.ok) setError(res.error);
      router.refresh();
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
      if (errors.length) setError(errors.join(" "));
      router.refresh();
    });
  }

  function clearPending(id: number) {
    start(async () => {
      await setTransactionPending(id, false, "/transactions");
      router.refresh();
    });
  }

  const sign = (dir: string) => (dir === "Credit" ? "+" : "−");

  return (
    <section className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200"
        >
          <span className="w-3 text-xs">{open ? "▾" : "▸"}</span>
          ⏳ {items.length} pending
          {matched.length > 0 && (
            <span className="font-normal text-amber-800 dark:text-amber-300">
              · {matched.length} look{matched.length === 1 ? "s" : ""} posted
            </span>
          )}
        </button>
        {matched.length > 1 && (
          <button
            onClick={mergeAll}
            disabled={busy}
            className="ml-auto px-2.5 py-1 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            Merge all {matched.length}
          </button>
        )}
      </div>
      {error && <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {open && (
        <ul className="divide-y divide-amber-200 dark:divide-amber-900 border-t border-amber-200 dark:border-amber-900 text-sm">
          {items.map((item) => {
            const p = item.pending;
            const m = item.match;
            const diff = m ? Math.round((m.amount - p.amount) * 100) / 100 : 0;
            return (
              <li key={p.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="truncate font-medium" title={p.description}>
                    {p.description}
                  </div>
                  <div className="text-xs text-neutral-500 tabular-nums">
                    {formatDate(p.txnDate)} · {p.accountLabel ?? p.accountNumber ?? "no account"} ·{" "}
                    {sign(p.direction)}
                    {formatMoney(p.amount)}
                  </div>
                </div>
                {m ? (
                  <>
                    <div className="min-w-0 flex-1 basis-56 text-xs">
                      <div className="text-neutral-500">Posted as</div>
                      <div className="truncate" title={m.description}>
                        {m.description}
                      </div>
                      <div className="text-neutral-500 tabular-nums">
                        {formatDate(m.txnDate)} · {sign(p.direction)}
                        {formatMoney(m.amount)}
                        {diff !== 0 && (
                          <span className="text-amber-700 dark:text-amber-400">
                            {" "}
                            ({diff > 0 ? "+" : "−"}
                            {formatMoney(Math.abs(diff))}
                            {diff > 0 && p.direction === "Debit" ? " tip?" : ""})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        onClick={() => merge(item)}
                        disabled={busy}
                        title="Keep the bank's row, carry over your category and notes, and remove this pending entry"
                        className="px-2.5 py-1 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => clearPending(p.id)}
                        disabled={busy}
                        title="Not the same charge — keep both as separate transactions (this one stops being pending)"
                        className="text-xs text-neutral-500 hover:underline disabled:opacity-50"
                      >
                        Keep both
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-neutral-500">Waiting for it to post</span>
                    <button
                      onClick={() => clearPending(p.id)}
                      disabled={busy}
                      title="Stop tracking this as pending — keep it as a regular transaction"
                      className="text-xs text-neutral-500 hover:underline disabled:opacity-50"
                    >
                      Mark posted
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

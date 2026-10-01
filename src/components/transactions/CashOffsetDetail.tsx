"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  loadWithdrawalDetail,
  allocateCash,
  unallocateCash,
  type WithdrawalDetail,
} from "@/server/actions/cash";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";

/**
 * The inside of a cash withdrawal: what the money actually bought, and how much of it never
 * got explained. Loaded on demand when a withdrawal row is expanded on /transactions.
 *
 * The unaccounted figure is the point of the whole screen — it's the part that still counts
 * as spending, so it stays visible even at $0.00 (where it reads as "fully accounted for").
 */
export function CashOffsetDetail({ withdrawalId }: { withdrawalId: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<WithdrawalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  const [pickId, setPickId] = useState("");
  const [error, setError] = useState("");

  // Re-read after a link/unlink so the remaining figure moves immediately, without waiting on
  // the page-level refresh.
  const reload = useCallback(async () => {
    const next = await loadWithdrawalDetail(withdrawalId);
    setDetail(next);
    setLoading(false);
  }, [withdrawalId]);

  useEffect(() => {
    let cancelled = false;
    loadWithdrawalDetail(withdrawalId).then((next) => {
      if (cancelled) return;
      setDetail(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [withdrawalId]);

  function link() {
    if (!pickId) return;
    setError("");
    start(async () => {
      const res = await allocateCash(withdrawalId, Number(pickId));
      if (!res.ok) setError(res.error);
      setPickId("");
      await reload();
      router.refresh();
    });
  }

  function unlink(spendId: number) {
    start(async () => {
      await unallocateCash(withdrawalId, spendId);
      await reload();
      router.refresh();
    });
  }

  if (loading && !detail)
    return <div className="px-3 py-2 text-xs text-neutral-500">Loading cash detail…</div>;
  if (!detail)
    return <div className="px-3 py-2 text-xs text-neutral-500">Couldn&apos;t load this one.</div>;

  const { withdrawal: w, spends, linkable } = detail;
  const pct = w.amount > 0 ? Math.min(100, (w.allocated / w.amount) * 100) : 0;

  return (
    <div className="px-3 py-3 space-y-3 bg-amber-50/60 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs font-medium text-amber-900 dark:text-amber-200">
          💵 {formatMoney(w.amount)} withdrawn
        </span>
        <span className="text-xs text-neutral-600 dark:text-neutral-300">
          {formatMoney(w.allocated)} accounted for
        </span>
        <span
          className={`text-xs font-semibold ${
            w.remaining > 0
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {formatMoney(w.remaining)} unaccounted
          {w.remaining > 0 ? " — still counts as spending" : " — fully accounted for"}
        </span>
      </div>

      <div className="h-1.5 w-full max-w-md rounded-full bg-amber-200/70 dark:bg-amber-900/50 overflow-hidden">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>

      {spends.length > 0 ? (
        <ul className="space-y-1">
          {spends.map((s) => (
            <li key={s.id} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 min-w-0 truncate">{s.description}</span>
                <span className="shrink-0 tabular-nums font-medium">
                  {formatMoney(s.allocatedAmount)}
                  {Math.abs(s.allocatedAmount - s.amount) > 0.004 && (
                    <span className="ml-1 font-normal text-neutral-400">
                      of {formatMoney(s.amount)}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => unlink(s.id)}
                  disabled={pending}
                  className="shrink-0 px-1.5 py-1 text-red-600 hover:underline disabled:opacity-50"
                  title="Unlink — this purchase goes back to being separate spending"
                >
                  Unlink
                </button>
              </div>
              <div className="text-neutral-500 tabular-nums">
                {formatDate(s.txnDate)}
                {s.category ? ` · ${s.category}` : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-neutral-500">
          Nothing logged against this withdrawal yet, so all {formatMoney(w.amount)} counts as
          spending.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          disabled={!linkable.length || w.remaining <= 0}
          className="w-full sm:w-auto sm:max-w-md min-w-0 border rounded px-2 py-1.5 text-xs bg-transparent border-neutral-300 dark:border-neutral-700 disabled:opacity-50"
        >
          <option value="">
            {w.remaining <= 0
              ? "— nothing left to account for —"
              : linkable.length
                ? "— add a cash purchase —"
                : "— no unfunded cash purchases nearby —"}
          </option>
          {linkable.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {formatDate(s.txnDate)} · {s.description.slice(0, 40)} ·{" "}
              {formatMoney(s.uncovered)}
            </option>
          ))}
        </select>
        <button
          onClick={link}
          disabled={pending || !pickId}
          className="px-3 py-1.5 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          Offset
        </button>
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}

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
import { Icon, ProgressBar } from "@/components/ds";
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
      if (!res.ok) router.refresh();
    });
  }

  function unlink(spendId: number) {
    start(async () => {
      await unallocateCash(withdrawalId, spendId);
      await reload();
    });
  }

  if (loading && !detail)
    return <div className="px-3 py-2 text-xs text-fg-3">Loading cash detail…</div>;
  if (!detail)
    return <div className="px-3 py-2 text-xs text-fg-3">Couldn&apos;t load this one.</div>;

  const { withdrawal: w, spends, linkable } = detail;
  const pct = w.amount > 0 ? Math.min(100, (w.allocated / w.amount) * 100) : 0;

  return (
    <div className="px-4 py-3 space-y-3 bg-sunken">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg">
          <Icon name="banknote" size={14} />
          {formatMoney(w.amount)} withdrawn
        </span>
        <span className="text-xs text-fg-2">
          {formatMoney(w.allocated)} accounted for
        </span>
        <span
          className={`text-xs font-semibold ${
            w.remaining > 0
              ? "text-over"
              : "text-income"
          }`}
        >
          {formatMoney(w.remaining)} unaccounted
          {w.remaining > 0 ? " — still counts as spending" : " — fully accounted for"}
        </span>
      </div>

      <ProgressBar
        value={pct}
        max={100}
        size="sm"
        className="max-w-md"
        label="Share of this withdrawal accounted for"
      />

      {spends.length > 0 ? (
        <ul className="space-y-1">
          {spends.map((s) => (
            <li key={s.id} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 min-w-0 truncate">{s.description}</span>
                <span className="shrink-0 tabular-nums font-medium">
                  {formatMoney(s.allocatedAmount)}
                  {Math.abs(s.allocatedAmount - s.amount) > 0.004 && (
                    <span className="ml-1 font-normal text-fg-3">
                      of {formatMoney(s.amount)}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => unlink(s.id)}
                  disabled={pending}
                  className="shrink-0 px-1.5 py-1 font-medium text-fg-2 hover:text-over hover:underline disabled:opacity-50"
                  title="Unlink — this purchase goes back to being separate spending"
                >
                  Unlink
                </button>
              </div>
              <div className="text-fg-3 tabular-nums">
                {formatDate(s.txnDate)}
                {s.category ? ` · ${s.category}` : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-3">
          Nothing logged against this withdrawal yet, so all {formatMoney(w.amount)} counts as
          spending.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          disabled={!linkable.length || w.remaining <= 0}
          className="mp-select !h-9 !text-xs sm:!w-auto sm:max-w-md min-w-0 disabled:opacity-50"
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
          className="mp-btn mp-btn--secondary mp-btn--sm"
        >
          Offset
        </button>
        {error && <span className="text-xs text-over">{error}</span>}
      </div>
    </div>
  );
}

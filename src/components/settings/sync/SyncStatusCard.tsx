"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSyncSettings, syncNow } from "@/server/actions/sync";
import { SYNC_INTERVAL_CHOICES } from "@/constants/sync";
import { RefreshIcon, SpinnerIcon } from "@/components/icons";
import { formatMoney } from "@/server/lib/money";
import { intervalLabel, relativeTime } from "@/lib/sync-format";

export interface SyncStatusCardProps {
  settings: {
    enabled: boolean;
    intervalMinutes: number;
    nextRunAt: string | null;
    lastWebhookAt: string | null;
    /** A run holds the lock right now (computed server-side so render stays pure). */
    running: boolean;
  };
  lastRun: {
    id: number;
    status: string;
    trigger: string;
    startedAt: string | null;
    inserted: number;
    updated: number;
    promoted: number;
    expired: number;
    error: string | null;
  } | null;
  pending: { count: number; debits: number; credits: number };
  /** SYNC_SCHEDULER=1 on this server — without it the interval is informational only. */
  schedulerEnv: boolean;
  activeEnrollments: number;
}

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
};

export function SyncStatusCard({ settings, lastRun, pending, schedulerEnv, activeEnrollments }: SyncStatusCardProps) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [interval, setIntervalMin] = useState(settings.intervalMinutes);

  const running = settings.running;

  const save = (patch: { enabled?: boolean; intervalMinutes?: number }) => {
    setMsg(null);
    start(async () => {
      const res = await saveSyncSettings(patch);
      if (!res.ok) setMsg({ kind: "err", text: res.error });
      router.refresh();
    });
  };

  const run = (dryRun: boolean) => {
    setMsg(null);
    setSyncing(true);
    start(async () => {
      const res = await syncNow({ dryRun });
      setSyncing(false);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error });
      } else {
        const s = res.value!;
        setMsg({
          kind: s.status === "failed" ? "err" : "ok",
          text:
            `${dryRun ? "Dry run" : "Sync"} ${s.status}: +${s.inserted} new, ${s.updated} changed (${s.promoted} posted), ` +
            `${s.expired} expired, ${s.skippedDupes} duplicates skipped, ${s.balancesRecorded} balances` +
            (s.error ? ` — ${s.error}` : ""),
        });
      }
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => {
                setEnabled(e.target.checked);
                save({ enabled: e.target.checked });
              }}
              className="h-5 w-5"
            />
            <span className="font-semibold">Automatic sync {enabled ? "on" : "off"}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Every</span>
            <select
              value={interval}
              disabled={busy}
              onChange={(e) => {
                const v = Number(e.target.value);
                setIntervalMin(v);
                save({ intervalMinutes: v });
              }}
              className="border rounded px-2 py-1 bg-transparent border-neutral-300 dark:border-neutral-700"
            >
              {SYNC_INTERVAL_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {intervalLabel(m)}
                </option>
              ))}
            </select>
            <span className="text-neutral-500">
              {enabled && settings.nextRunAt ? `· next ${relativeTime(settings.nextRunAt)}` : ""}
            </span>
          </label>
          {!schedulerEnv && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              The scheduler isn&apos;t running on this server (SYNC_SCHEDULER is not 1). Webhooks and
              “Sync now” still work; the interval takes effect once it is set.
            </p>
          )}
          {activeEnrollments === 0 && (
            <p className="text-xs text-neutral-500">No active bank links yet — link one below.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={busy || running || activeEnrollments === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? <SpinnerIcon /> : <RefreshIcon width={16} height={16} />}
            {running ? "Sync running…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy || running || activeEnrollments === 0}
            title="Fetch and reconcile without writing anything — the result is logged in run history."
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            Dry run
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`text-sm rounded-md px-3 py-2 ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <dt className="text-neutral-500">Last run</dt>
          <dd className="mt-0.5">
            {lastRun ? (
              <span className="inline-flex items-center gap-2 flex-wrap">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[lastRun.status] ?? ""}`}>{lastRun.status}</span>
                <span>{relativeTime(lastRun.startedAt)}</span>
                <span className="text-neutral-500">
                  via {lastRun.trigger} · +{lastRun.inserted} / ~{lastRun.updated} / −{lastRun.expired}
                </span>
              </span>
            ) : (
              "never"
            )}
            {lastRun?.error && <div className="text-xs text-rose-600 mt-1">{lastRun.error}</div>}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Pending right now</dt>
          <dd className="mt-0.5">
            {pending.count === 0 ? (
              "none"
            ) : (
              <>
                {pending.count} · <span className="text-rose-600 dark:text-rose-400">−{formatMoney(pending.debits)}</span>
                {pending.credits > 0 && <span className="text-emerald-600 dark:text-emerald-400"> +{formatMoney(pending.credits)}</span>}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Last webhook</dt>
          <dd className="mt-0.5">{relativeTime(settings.lastWebhookAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

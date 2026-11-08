"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSyncSettings, syncNow } from "@/server/actions/sync";
import { SYNC_INTERVAL_CHOICES } from "@/constants/sync";
import { Badge, Button, Card, Money, Notice, Select, Switch } from "@/components/ds";
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
  /** This server process runs the scheduler (production build, not SYNC_SCHEDULER=0). */
  schedulerEnv: boolean;
  activeEnrollments: number;
}

// Run status → badge color (one meaning per color: green ok, amber partial, rose failed, sky running).
export const RUN_STATUS_COLOR: Record<string, string> = {
  ok: "#22c55e",
  partial: "#eab308",
  failed: "#ef4444",
  running: "#0ea5e9",
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
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error });
        router.refresh();
      }
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
        // A run that threw revalidated nothing, but may have got part-way: show where it stopped.
        router.refresh();
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
    });
  };

  return (
    <Card
      title="Sync status"
      meta={enabled ? `every ${intervalLabel(interval)}` : "automatic sync off"}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => run(true)}
            disabled={busy || running || activeEnrollments === 0}
            title="Fetch and reconcile without writing anything; the result is logged in run history."
          >
            Dry run
          </Button>
          <Button size="sm" icon="refresh-cw" loading={syncing} onClick={() => run(false)} disabled={busy || running || activeEnrollments === 0}>
            {running ? "Sync running…" : "Sync now"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Switch
            label={<span className="font-medium">Automatic sync {enabled ? "on" : "off"}</span>}
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              setEnabled(e.target.checked);
              save({ enabled: e.target.checked });
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-fg-2">Every</span>
            <Select
              value={String(interval)}
              disabled={busy}
              onChange={(e) => {
                const v = Number(e.target.value);
                setIntervalMin(v);
                save({ intervalMinutes: v });
              }}
              className="!h-9 w-auto"
              options={SYNC_INTERVAL_CHOICES.map((m) => ({ value: String(m), label: intervalLabel(m) }))}
            />
            {enabled && settings.nextRunAt && <span className="text-fg-3">· next {relativeTime(settings.nextRunAt)}</span>}
          </label>
        </div>
        {!schedulerEnv && (
          <Notice tone="warn">
            Automatic sync runs on the deployed server, not this one (a dev server never polls banks). Sync now still works here.
          </Notice>
        )}
        {activeEnrollments === 0 && <p className="text-xs text-fg-3">No active bank links yet. Link one below.</p>}

        {msg && <Notice tone={msg.kind === "ok" ? "ok" : "danger"}>{msg.text}</Notice>}

        <dl className="grid gap-3 rounded-panel bg-sunken p-3 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-fg-3">Last run</dt>
            <dd className="mt-1">
              {lastRun ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge label={lastRun.status} color={RUN_STATUS_COLOR[lastRun.status]} size="sm" />
                  <span>{relativeTime(lastRun.startedAt)}</span>
                  <span className="text-fg-3">
                    via {lastRun.trigger} · +{lastRun.inserted} / ~{lastRun.updated} / −{lastRun.expired}
                  </span>
                </span>
              ) : (
                "never"
              )}
              {lastRun?.error && <div className="mt-1 text-xs text-over">{lastRun.error}</div>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">Pending right now</dt>
            <dd className="mt-1">
              {pending.count === 0 ? (
                "none"
              ) : (
                <>
                  {pending.count} · <Money value={-pending.debits} kind="pending" />
                  {pending.credits > 0 && (
                    <>
                      {" "}
                      <Money value={pending.credits} kind="income" sign="always" />
                    </>
                  )}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">Last webhook</dt>
            <dd className="mt-1">{relativeTime(settings.lastWebhookAt)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

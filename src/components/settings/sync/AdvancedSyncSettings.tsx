"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSyncSettings } from "@/server/actions/sync";

const inputCls = "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700 w-20";

export interface AdvancedSyncSettingsProps {
  settings: {
    syncWindowDays: number;
    pendingExpiryDays: number;
    recordBalances: boolean;
    autoCategorize: boolean;
    webhookEnabled: boolean;
  };
}

export function AdvancedSyncSettings({ settings }: AdvancedSyncSettingsProps) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [windowDays, setWindowDays] = useState(String(settings.syncWindowDays));
  const [expiryDays, setExpiryDays] = useState(String(settings.pendingExpiryDays));
  const [recordBalances, setRecordBalances] = useState(settings.recordBalances);
  const [autoCategorize, setAutoCategorize] = useState(settings.autoCategorize);
  const [webhookEnabled, setWebhookEnabled] = useState(settings.webhookEnabled);

  const submit = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveSyncSettings({
        syncWindowDays: Number(windowDays),
        pendingExpiryDays: Number(expiryDays),
        recordBalances,
        autoCategorize,
        webhookEnabled,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <div className="font-medium">Re-query window (days)</div>
          <div className="text-xs text-neutral-500">
            Each run re-reads this many days so pending charges that post on a different date are caught (7–10 is
            typical).
          </div>
          <input type="number" min={3} max={90} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1">
          <div className="font-medium">Pending expiry (days)</div>
          <div className="text-xs text-neutral-500">
            A pending charge the bank stops reporting for this long is dropped (it was declined or re-issued under a
            new id). Notes and hand-set categories move to the posted twin when one is found.
          </div>
          <input type="number" min={1} max={30} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={recordBalances} onChange={(e) => setRecordBalances(e.target.checked)} className="h-4 w-4" />
          <span>
            Record balances <span className="text-xs text-neutral-500">(one snapshot per account per day)</span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={autoCategorize} onChange={(e) => setAutoCategorize(e.target.checked)} className="h-4 w-4" />
          <span>
            Apply category rules <span className="text-xs text-neutral-500">(never overwrites a hand-set category)</span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} className="h-4 w-4" />
          <span>
            Accept provider webhooks <span className="text-xs text-neutral-500">(sync when the bank has news)</span>
          </span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-emerald-600 text-xs">Saved.</span>}
        {error && <span className="text-rose-600 text-xs">{error}</span>}
      </div>
    </div>
  );
}

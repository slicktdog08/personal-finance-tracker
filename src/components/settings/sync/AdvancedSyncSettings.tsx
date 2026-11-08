"use client";

import { useState, useTransition } from "react";
import { saveSyncSettings } from "@/server/actions/sync";
import { Button, Card, Field, Icon, Input, Switch } from "@/components/ds";

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
    });
  };

  const toggle = (label: string, hint: string, checked: boolean, set: (v: boolean) => void) => (
    <Switch
      label={
        <span className="text-sm">
          {label} <span className="block text-xs text-fg-3">{hint}</span>
        </span>
      }
      checked={checked}
      onChange={(e) => set(e.target.checked)}
      className="items-start"
    />
  );

  return (
    <Card title="Advanced" meta="saved together">
      <div className="space-y-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Re-query window (days)"
            htmlFor="sync-window"
            hint="Each run re-reads this many days so pending charges that post on a different date are caught (7–10 is typical)."
          >
            <Input id="sync-window" type="number" min={3} max={90} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className="max-w-28" />
          </Field>
          <Field
            label="Pending expiry (days)"
            htmlFor="sync-expiry"
            hint="A pending charge the bank stops reporting for this long is dropped (it was declined or re-issued under a new id). Notes and hand-set categories move to the posted twin when one is found."
          >
            <Input id="sync-expiry" type="number" min={1} max={30} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} className="max-w-28" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {toggle("Record balances", "One snapshot per account per day", recordBalances, setRecordBalances)}
          {toggle("Apply category rules", "Never overwrites a hand-set category", autoCategorize, setAutoCategorize)}
          {toggle("Accept provider webhooks", "Sync when the bank has news", webhookEnabled, setWebhookEnabled)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} loading={busy} icon="check">
            Save settings
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-income">
              <Icon name="circle-check" size={14} /> Saved
            </span>
          )}
          {error && <span className="text-xs text-over">{error}</span>}
        </div>
      </div>
    </Card>
  );
}

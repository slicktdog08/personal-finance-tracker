"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEnrollment, setAccountMapping, setEnrollmentPaused, suggestSyncFrom, syncNow, updateSyncAccount } from "@/server/actions/sync";
import type { ConnectConfig } from "@/server/actions/sync";
import { relativeTime } from "@/lib/sync-format";
import { formatDate } from "@/server/lib/period";
import { LinkSimplefin } from "./LinkSimplefin";
import { PlaidLinkButton } from "./PlaidLink";
import { Badge, Button, Card, Checkbox, EmptyState, Glyph, Input, Notice, Select } from "@/components/ds";

export interface EnrollmentView {
  id: number;
  provider: string;
  enrollmentId: string;
  institutionName: string | null;
  status: string;
  disconnectReason: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  accounts: SyncAccountView[];
}

export interface SyncAccountView {
  id: number;
  externalAccountId: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  lastFour: string | null;
  accountId: number | null;
  enabled: boolean;
  syncBalances: boolean;
  syncFrom: string | null;
  externalStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface LocalAccountView {
  id: number;
  label: string;
  accountNumber: string;
  institution: string | null;
  accountType: string | null;
}

// The kit's health badge, derived from the link's real state: a disconnected link needs a fresh
// login, a paused one is yours to resume, an active one with an error is degraded.
function health(e: EnrollmentView): { label: string; color: string } {
  if (e.status === "disconnected") return { label: "Needs login", color: "#ef4444" };
  if (e.status === "paused") return { label: "Paused", color: "#64748b" };
  if (e.lastError) return { label: "Errors", color: "#eab308" };
  return { label: "Healthy", color: "#22c55e" };
}

export function EnrollmentList({
  enrollments,
  localAccounts,
  connect,
}: {
  enrollments: EnrollmentView[];
  localAccounts: LocalAccountView[];
  connect: ConnectConfig;
}) {
  if (!enrollments.length) {
    return (
      <Card variant="sunken" padded={false}>
        <EmptyState
          compact
          icon="landmark"
          title="No banks linked"
          body={
            connect.demo
              ? "Demo Bank was removed. It comes back the next time the demo data resets."
              : connect.ready
              ? "Paste a SimpleFIN Setup Token above. The accounts it exposes appear here for mapping."
              : "Linking becomes available once a bank provider is wired up. Everything else here (mapping, runs, history) is ready."
          }
        />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {enrollments.map((e) => (
        <EnrollmentCard key={e.id} e={e} localAccounts={localAccounts} envToken={connect.simplefinEnvToken} />
      ))}
    </div>
  );
}

function EnrollmentCard({ e, localAccounts, envToken }: { e: EnrollmentView; localAccounts: LocalAccountView[]; envToken: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const simplefin = e.provider === "simplefin";
  const plaid = e.provider === "plaid";

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Failed.");
        router.refresh();
      }
    });
  };

  const h = health(e);
  const mapped = e.accounts.filter((a) => a.accountId != null).length;

  return (
    <Card padded={false}>
      {/* The kit's bank row: glyph, institution, accounts · last run, health badge. */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 max-md:px-3.5">
        <Glyph icon="landmark" color={e.status === "disconnected" ? "#ef4444" : "#0ea5e9"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{e.institutionName ?? e.enrollmentId}</span>
            <Badge label={h.label} color={h.color} size="sm" />
          </div>
          <div className="mt-0.5 text-xs text-fg-3">
            {e.accounts.length} account{e.accounts.length === 1 ? "" : "s"} ({mapped} mapped) · last synced {relativeTime(e.lastSyncedAt)}
            {e.status === "disconnected" && e.disconnectReason && <> · {e.disconnectReason}</>}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-fg-3">
            {e.provider} · {e.enrollmentId}
          </div>
          {e.lastError && <div className="mt-0.5 text-xs text-over">{e.lastError}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {e.status === "disconnected" && !simplefin && !plaid && (
            <span className="text-xs text-over" title="Reconnecting needs the provider's link flow, which is not available right now.">
              needs reconnecting
            </span>
          )}
          {plaid && (
            <PlaidLinkButton
              reconnectEnrollmentDbId={e.id}
              urgent={e.status === "disconnected"}
              label={e.status === "disconnected" ? "Reconnect (sign in again)" : "Reconnect"}
            />
          )}
          {simplefin && (
            <Button
              size="sm"
              variant={e.status === "disconnected" ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => setReconnecting((v) => !v)}
              title="Swap in a new Setup Token; account mappings are kept."
            >
              Reconnect
            </Button>
          )}
          {e.status === "active" && (
            <Button size="sm" variant="secondary" icon="refresh-cw" disabled={busy} onClick={() => act(() => syncNow({ enrollmentDbId: e.id }))}>
              Sync this bank
            </Button>
          )}
          {e.status !== "disconnected" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => setEnrollmentPaused(e.id, e.status !== "paused"))}>
              {e.status === "paused" ? "Resume" : "Pause"}
            </Button>
          )}
          {!confirmRemove && (
            <Button size="sm" variant="ghost" icon="trash-2" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {confirmRemove && (
        <div className="px-5 pb-3 max-md:px-3.5">
          <Notice
            tone="danger"
            action={
              <span className="flex gap-1.5">
                <Button size="sm" variant="danger" disabled={busy} onClick={() => act(() => deleteEnrollment(e.id, true))}>
                  Yes, remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
              </span>
            }
          >
            {simplefin
              ? "Forget this connection? Synced transactions stay. Also disable this app's access in SimpleFIN Bridge."
              : plaid
                ? "Revoke this bank at Plaid and forget it? Synced transactions stay. On the Trial plan the Item slot is not returned."
                : "Revoke access and forget this bank? Synced transactions stay."}
          </Notice>
        </div>
      )}
      {error && <div className="px-5 pb-3 text-sm text-over max-md:px-3.5">{error}</div>}
      {reconnecting && (
        <div className="border-t border-line px-5 py-3 max-md:px-3.5">
          <LinkSimplefin reconnectEnrollmentDbId={e.id} envToken={envToken} onDone={() => setReconnecting(false)} />
        </div>
      )}

      {/* Desktop: table. Mobile: cards. */}
      <div className="hidden overflow-x-auto border-t border-line md:block">
        <table className="w-full text-sm">
          <thead className="text-xs text-fg-3">
            <tr className="text-left">
              <th className="px-5 py-2 font-medium">Bank account</th>
              <th className="px-3 py-2 font-medium">Feeds</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">On</th>
              <th className="px-3 py-2 font-medium">Balances</th>
              <th className="px-3 py-2 font-medium">Synced</th>
            </tr>
          </thead>
          <tbody>
            {e.accounts.map((a) => (
              <AccountRow key={a.id} a={a} localAccounts={localAccounts} busy={busy} act={act} layout="row" />
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-line border-t border-line md:hidden">
        {e.accounts.map((a) => (
          <AccountRow key={a.id} a={a} localAccounts={localAccounts} busy={busy} act={act} layout="card" />
        ))}
      </div>
    </Card>
  );
}

function AccountRow({
  a,
  localAccounts,
  busy,
  act,
  layout,
}: {
  a: SyncAccountView;
  localAccounts: LocalAccountView[];
  busy: boolean;
  act: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  layout: "row" | "card";
}) {
  const [syncFrom, setSyncFrom] = useState(a.syncFrom ?? "");
  const closed = a.externalStatus === "closed";

  const onMap = async (value: string) => {
    const accountId = value === "" ? null : Number(value);
    act(async () => {
      const res = await setAccountMapping(a.id, accountId);
      if (res.ok && accountId != null) setSyncFrom(await suggestSyncFrom(accountId));
      return res;
    });
  };

  const name = (
    <div>
      <div className={`font-medium ${closed ? "line-through text-fg-3" : ""}`}>
        {a.name ?? a.externalAccountId} {a.lastFour && <span className="font-mono text-fg-3">··{a.lastFour}</span>}
      </div>
      <div className="text-xs text-fg-3">
        {a.type} · {a.subtype}
        {closed && " · closed at bank"}
      </div>
      {a.lastError && <div className="text-xs text-over">{a.lastError}</div>}
      {a.accountId != null && !a.enabled && !closed && (
        <div className="text-xs text-warn">Matched by last four. Check Feeds, then turn it on.</div>
      )}
    </div>
  );
  const feeds = (
    <Select
      value={a.accountId != null ? String(a.accountId) : ""}
      disabled={busy || closed}
      onChange={(ev) => onMap(ev.target.value)}
      aria-label={`Account that ${a.name ?? a.externalAccountId} feeds`}
      className="!h-9 max-w-64"
      options={[
        { value: "", label: "Not mapped" },
        ...localAccounts.map((l) => ({
          value: String(l.id),
          label: `${l.label} (${l.institution ?? "?"} · ${l.accountType ?? "?"} · ${l.accountNumber})`,
        })),
      ]}
    />
  );
  const from = (
    <Input
      type="date"
      value={syncFrom}
      disabled={busy || a.accountId == null}
      onChange={(ev) => setSyncFrom(ev.target.value)}
      onBlur={() => {
        if ((syncFrom || null) !== (a.syncFrom || null)) act(() => updateSyncAccount(a.id, { syncFrom: syncFrom || null }));
      }}
      title="Transactions before this date are never pulled (they already came in via CSV/PDF)."
      aria-label="Sync from"
      className="!h-9 w-40"
    />
  );
  const on = (
    <Checkbox aria-label="Sync on" checked={a.enabled} disabled={busy || closed || a.accountId == null} onChange={(ev) => act(() => updateSyncAccount(a.id, { enabled: ev.target.checked }))} />
  );
  const balances = (
    <Checkbox aria-label="Sync balances" checked={a.syncBalances} disabled={busy || closed || a.accountId == null} onChange={(ev) => act(() => updateSyncAccount(a.id, { syncBalances: ev.target.checked }))} />
  );
  const synced = <span className="text-xs text-fg-3">{a.lastSyncedAt ? relativeTime(a.lastSyncedAt) : a.accountId == null ? "unmapped" : "not yet"}</span>;

  if (layout === "row") {
    return (
      <tr className="border-t border-line align-top">
        <td className="px-5 py-2.5">{name}</td>
        <td className="px-3 py-2">{feeds}</td>
        <td className="px-3 py-2">{from}</td>
        <td className="px-3 py-2">{on}</td>
        <td className="px-3 py-2">{balances}</td>
        <td className="px-3 py-2">{synced}</td>
      </tr>
    );
  }
  return (
    <div className="space-y-2 px-3.5 py-3">
      {name}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-fg-3">Feeds</span>
        {feeds}
        <span className="text-fg-3">From</span>
        <span>
          {from} {a.syncFrom && <span className="ml-1 text-xs text-fg-3">({formatDate(a.syncFrom)})</span>}
        </span>
        <span className="text-fg-3">On</span>
        {on}
        <span className="text-fg-3">Balances</span>
        {balances}
        <span className="text-fg-3">Synced</span>
        {synced}
      </div>
    </div>
  );
}

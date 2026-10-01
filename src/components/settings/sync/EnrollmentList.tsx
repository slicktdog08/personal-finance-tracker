"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEnrollment, setAccountMapping, setEnrollmentPaused, suggestSyncFrom, syncNow, updateSyncAccount } from "@/server/actions/sync";
import type { ConnectConfig } from "@/server/actions/sync";
import { relativeTime } from "@/lib/sync-format";
import { formatDate } from "@/server/lib/period";

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

const STATUS_PILL: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  paused: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  disconnected: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

const inputCls = "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";
const btnCls =
  "rounded-md border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50";

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
      <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-sm text-neutral-500">
        No banks linked.
        {connect.ready
          ? " Use Link a bank to connect one — the provider walks you through the bank's own login and MFA, then the accounts it exposes appear here for mapping."
          : " Linking becomes available once a bank provider is wired up; everything else here (mapping, runs, history) is ready."}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {enrollments.map((e) => (
        <EnrollmentCard key={e.id} e={e} localAccounts={localAccounts} />
      ))}
    </div>
  );
}

function EnrollmentCard({ e, localAccounts }: { e: EnrollmentView; localAccounts: LocalAccountView[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{e.institutionName ?? e.enrollmentId}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[e.status] ?? ""}`}>{e.status}</span>
            <span className="text-xs text-neutral-400 font-mono">{e.provider} · {e.enrollmentId}</span>
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            Last synced {relativeTime(e.lastSyncedAt)}
            {e.status === "disconnected" && e.disconnectReason && <> · {e.disconnectReason}</>}
          </div>
          {e.lastError && <div className="text-xs text-rose-600 mt-0.5">{e.lastError}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {e.status === "disconnected" && (
            <span className="text-xs text-rose-600" title="Reconnecting needs the provider's link flow, which is not available right now.">
              needs reconnecting
            </span>
          )}
          {e.status === "active" && (
            <button type="button" className={btnCls} disabled={busy} onClick={() => act(() => syncNow({ enrollmentDbId: e.id }))}>
              Sync this bank
            </button>
          )}
          {e.status !== "disconnected" && (
            <button type="button" className={btnCls} disabled={busy} onClick={() => act(() => setEnrollmentPaused(e.id, e.status !== "paused"))}>
              {e.status === "paused" ? "Resume" : "Pause"}
            </button>
          )}
          {!confirmRemove ? (
            <button type="button" className={`${btnCls} text-rose-600`} disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="text-neutral-500">Revoke access and forget this bank? Synced transactions stay.</span>
              <button type="button" className={`${btnCls} text-rose-600`} disabled={busy} onClick={() => act(() => deleteEnrollment(e.id, true))}>
                Yes, remove
              </button>
              <button type="button" className={btnCls} onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </span>
          )}
        </div>
      </div>
      {error && <div className="px-4 py-2 text-sm text-rose-600">{error}</div>}

      {/* Desktop: table. Mobile: cards. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Bank account</th>
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
      <div className="md:hidden divide-y divide-neutral-100 dark:divide-neutral-800">
        {e.accounts.map((a) => (
          <AccountRow key={a.id} a={a} localAccounts={localAccounts} busy={busy} act={act} layout="card" />
        ))}
      </div>
    </div>
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
      <div className={`font-medium ${closed ? "line-through text-neutral-400" : ""}`}>
        {a.name ?? a.externalAccountId} {a.lastFour && <span className="text-neutral-400 font-mono">····{a.lastFour}</span>}
      </div>
      <div className="text-xs text-neutral-500">
        {a.type} · {a.subtype}
        {closed && " · closed at bank"}
      </div>
      {a.lastError && <div className="text-xs text-rose-600">{a.lastError}</div>}
      {a.accountId != null && !a.enabled && !closed && (
        <div className="text-xs text-amber-700 dark:text-amber-400">Matched by last four — check “Feeds”, then turn it on.</div>
      )}
    </div>
  );
  const feeds = (
    <select value={a.accountId ?? ""} disabled={busy || closed} onChange={(ev) => onMap(ev.target.value)} className={inputCls}>
      <option value="">— not mapped —</option>
      {localAccounts.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label} ({l.institution ?? "?"} · {l.accountType ?? "?"} · {l.accountNumber})
        </option>
      ))}
    </select>
  );
  const from = (
    <input
      type="date"
      value={syncFrom}
      disabled={busy || a.accountId == null}
      onChange={(ev) => setSyncFrom(ev.target.value)}
      onBlur={() => {
        if ((syncFrom || null) !== (a.syncFrom || null)) act(() => updateSyncAccount(a.id, { syncFrom: syncFrom || null }));
      }}
      title="Transactions before this date are never pulled (they already came in via CSV/PDF)."
      className={inputCls}
    />
  );
  const on = (
    <input type="checkbox" checked={a.enabled} disabled={busy || closed || a.accountId == null} onChange={(ev) => act(() => updateSyncAccount(a.id, { enabled: ev.target.checked }))} className="h-4 w-4" />
  );
  const balances = (
    <input type="checkbox" checked={a.syncBalances} disabled={busy || closed || a.accountId == null} onChange={(ev) => act(() => updateSyncAccount(a.id, { syncBalances: ev.target.checked }))} className="h-4 w-4" />
  );
  const synced = <span className="text-xs text-neutral-500">{a.lastSyncedAt ? relativeTime(a.lastSyncedAt) : a.accountId == null ? "unmapped" : "not yet"}</span>;

  if (layout === "row") {
    return (
      <tr className="border-t border-neutral-100 dark:border-neutral-800 align-top">
        <td className="px-4 py-2">{name}</td>
        <td className="px-3 py-2">{feeds}</td>
        <td className="px-3 py-2">{from}</td>
        <td className="px-3 py-2">{on}</td>
        <td className="px-3 py-2">{balances}</td>
        <td className="px-3 py-2">{synced}</td>
      </tr>
    );
  }
  return (
    <div className="px-4 py-3 space-y-2">
      {name}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center text-sm">
        <span className="text-neutral-500">Feeds</span>
        {feeds}
        <span className="text-neutral-500">From</span>
        <span>
          {from} {a.syncFrom && <span className="text-xs text-neutral-400 ml-1">({formatDate(a.syncFrom)})</span>}
        </span>
        <span className="text-neutral-500">On</span>
        {on}
        <span className="text-neutral-500">Balances</span>
        {balances}
        <span className="text-neutral-500">Synced</span>
        {synced}
      </div>
    </div>
  );
}

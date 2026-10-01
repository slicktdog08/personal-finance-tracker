"use client";

import { useState } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/sync-format";
import { formatMoney } from "@/server/lib/money";

export interface RunView {
  id: number;
  trigger: string;
  status: string;
  dryRun: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  inserted: number;
  updated: number;
  promoted: number;
  expired: number;
  skippedDupes: number;
  balancesRecorded: number;
  error: string | null;
  details: unknown;
}

interface RunDetails {
  enrollments?: {
    institution: string | null;
    status: string;
    error: string | null;
    accounts: {
      name: string | null;
      range: { startDate: string; endDate: string } | null;
      fetched: number;
      inserted: number;
      updated: number;
      promoted: number;
      expired: number;
      softDupes: { date: string; amount: number; direction: string; description: string; existingId: number; existingDescription: string }[];
      balance: { recorded: boolean; value: number | null; field: string | null } | null;
      error: string | null;
      skipped: string | null;
    }[];
  }[];
}

const STATUS_STYLE: Record<string, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  partial: "text-amber-700 dark:text-amber-400",
  failed: "text-rose-700 dark:text-rose-400",
  running: "text-blue-700 dark:text-blue-400",
};

export function SyncRunHistory({ runs, showingAll }: { runs: RunView[]; showingAll: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!runs.length) return <p className="text-sm text-neutral-500">No runs yet.</p>;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Via</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">New</th>
              <th className="px-3 py-2 font-medium text-right">Changed</th>
              <th className="px-3 py-2 font-medium text-right">Posted</th>
              <th className="px-3 py-2 font-medium text-right">Expired</th>
              <th className="px-3 py-2 font-medium text-right">Dupes</th>
              <th className="px-3 py-2 font-medium text-right">Bal.</th>
              <th className="px-3 py-2 font-medium text-right">Took</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const took =
                r.startedAt && r.finishedAt ? `${Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000))}s` : "…";
              const isOpen = open === r.id;
              return (
                <RunRows key={r.id} r={r} took={took} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : r.id)} />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-neutral-500 border-t border-neutral-100 dark:border-neutral-800">
        {showingAll ? (
          <Link href="/settings/sync" className="hover:text-blue-600">
            Show recent only
          </Link>
        ) : (
          <Link href="/settings/sync?all=1" className="hover:text-blue-600">
            Show all kept runs (up to 200)
          </Link>
        )}
      </div>
    </div>
  );
}

function RunRows({ r, took, isOpen, onToggle }: { r: RunView; took: string; isOpen: boolean; onToggle: () => void }) {
  const details = (r.details ?? {}) as RunDetails;
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-neutral-100 dark:border-neutral-800 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
      >
        <td className="px-4 py-2 whitespace-nowrap">
          {relativeTime(r.startedAt)}
          {r.dryRun && <span className="ml-1 text-xs text-neutral-400">(dry)</span>}
        </td>
        <td className="px-3 py-2">{r.trigger}</td>
        <td className={`px-3 py-2 font-medium ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.inserted}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.updated}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.promoted}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.expired}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.skippedDupes}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.balancesRecorded}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{took}</td>
      </tr>
      {isOpen && (
        <tr className="bg-neutral-50 dark:bg-neutral-800/40">
          <td colSpan={10} className="px-4 py-3 text-xs space-y-2">
            {r.error && <div className="text-rose-600">Run error: {r.error}</div>}
            {(details.enrollments ?? []).map((e, i) => (
              <div key={i} className="space-y-1">
                <div className="font-medium">
                  {e.institution ?? "?"} — {e.status}
                  {e.error && <span className="text-rose-600 font-normal"> · {e.error}</span>}
                </div>
                <ul className="pl-3 space-y-1">
                  {e.accounts.map((a, j) => (
                    <li key={j}>
                      <span className="font-medium">{a.name ?? "?"}</span>
                      {a.skipped ? (
                        <span className="text-neutral-500"> · skipped ({a.skipped})</span>
                      ) : (
                        <span className="text-neutral-600 dark:text-neutral-300">
                          {" "}
                          {a.range && `[${a.range.startDate} → ${a.range.endDate}]`} fetched {a.fetched}, +{a.inserted}, ~{a.updated} ({a.promoted} posted), −{a.expired}
                          {a.balance?.recorded && a.balance.value != null && ` · balance ${formatMoney(a.balance.value)} (${a.balance.field})`}
                        </span>
                      )}
                      {a.error && <span className="text-rose-600"> · {a.error}</span>}
                      {a.softDupes.length > 0 && (
                        <ul className="pl-3 text-neutral-500">
                          {a.softDupes.map((s, k) => (
                            <li key={k}>
                              skipped as duplicate: {s.date} {s.direction === "Debit" ? "−" : "+"}
                              {formatMoney(s.amount)} “{s.description}” ≈ #{s.existingId} “{s.existingDescription}”
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!details.enrollments?.length && !r.error && <div className="text-neutral-500">No details recorded.</div>}
          </td>
        </tr>
      )}
    </>
  );
}

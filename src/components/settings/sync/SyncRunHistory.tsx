"use client";

import { useState } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/sync-format";
import { formatMoney } from "@/server/lib/money";
import { Badge, Button, Card, EmptyState } from "@/components/ds";
import { RUN_STATUS_COLOR } from "./SyncStatusCard";

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
    providerResponse?: unknown;
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

export function SyncRunHistory({ runs, showingAll }: { runs: RunView[]; showingAll: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!runs.length)
    return (
      <Card variant="sunken" padded={false}>
        <EmptyState compact icon="history" title="No runs yet" body="Each sync, scheduled or by hand, is logged here." />
      </Card>
    );

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Ten columns don't fit a phone; the table scrolls inside its card rather than the page. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-fg-3">
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
      <div className="border-t border-line px-4 py-2.5 text-xs text-fg-3">
        {showingAll ? (
          <Link href="/settings/sync" className="hover:text-accent-text">
            Show recent only
          </Link>
        ) : (
          <Link href="/settings/sync?all=1" className="hover:text-accent-text">
            Show all kept runs (up to 200)
          </Link>
        )}
      </div>
    </Card>
  );
}

function RunRows({ r, took, isOpen, onToggle }: { r: RunView; took: string; isOpen: boolean; onToggle: () => void }) {
  const details = (r.details ?? {}) as RunDetails;
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={isOpen}
        className="cursor-pointer border-t border-line hover:bg-hover"
      >
        <td className="px-4 py-2 whitespace-nowrap">
          {relativeTime(r.startedAt)}
          {r.dryRun && <span className="ml-1 text-xs text-fg-3">(dry)</span>}
        </td>
        <td className="px-3 py-2">{r.trigger}</td>
        <td className="px-3 py-2">
          <Badge label={r.status} color={RUN_STATUS_COLOR[r.status]} size="sm" />
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{r.inserted}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.updated}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.promoted}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.expired}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.skippedDupes}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.balancesRecorded}</td>
        <td className="px-3 py-2 text-right tabular-nums text-fg-3">{took}</td>
      </tr>
      {isOpen && (
        <tr className="bg-sunken">
          <td colSpan={10} className="px-4 py-3 text-xs space-y-2">
            {r.error && <div className="text-over">Run error: {r.error}</div>}
            {(details.enrollments ?? []).map((e, i) => (
              <div key={i} className="space-y-1">
                <div className="font-medium">
                  {e.institution ?? "?"} — {e.status}
                  {e.error && <span className="text-over font-normal"> · {e.error}</span>}
                </div>
                <ul className="pl-3 space-y-1">
                  {e.accounts.map((a, j) => (
                    <li key={j}>
                      <span className="font-medium">{a.name ?? "?"}</span>
                      {a.skipped ? (
                        <span className="text-fg-3"> · skipped ({a.skipped})</span>
                      ) : (
                        <span className="text-fg-2">
                          {" "}
                          {a.range && `[${a.range.startDate} → ${a.range.endDate}]`} fetched {a.fetched}, +{a.inserted}, ~{a.updated} ({a.promoted} posted), −{a.expired}
                          {a.balance?.recorded && a.balance.value != null && ` · balance ${formatMoney(a.balance.value)} (${a.balance.field})`}
                        </span>
                      )}
                      {a.error && <span className="text-over"> · {a.error}</span>}
                      {a.softDupes.length > 0 && (
                        <ul className="pl-3 text-fg-3">
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
                {e.providerResponse != null && <ResponseJson value={e.providerResponse} />}
              </div>
            ))}
            {!details.enrollments?.length && !r.error && <div className="text-fg-3">No details recorded.</div>}
          </td>
        </tr>
      )}
    </>
  );
}

// Dry runs keep the provider's raw response; shown collapsed with a copy button for debugging
// (e.g. where a bank actually puts its available balance).
function ResponseJson({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  const [copied, setCopied] = useState(false);
  return (
    <details className="pl-3">
      <summary className="cursor-pointer text-fg-3 hover:text-accent-text">Provider response (JSON)</summary>
      <div className="mt-1 space-y-1">
        <Button
          size="sm"
          variant="secondary"
          icon="copy"
          onClick={() => {
            navigator.clipboard?.writeText(json).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy JSON"}
        </Button>
        <pre className="max-h-96 overflow-auto whitespace-pre rounded-control border border-line bg-surface p-2 font-mono text-[11px] leading-snug">
          {json}
        </pre>
      </div>
    </details>
  );
}

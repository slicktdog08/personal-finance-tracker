"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { TransfersData, TxnLite } from "@/server/lib/transfers";
import {
  linkTransfer,
  unlinkTransfer,
  unmarkTransfer,
  dismissSuggestion,
} from "@/server/actions/transfers";

export function TransfersManager({
  data,
  periods,
  selected,
}: {
  data: TransfersData;
  periods: { label: string; pretty: string }[];
  selected: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Record<number, number>>(
    Object.fromEntries(
      data.unmatched.filter((u) => u.candidates.length).map((u) => [u.txn.id, u.candidates[0].id]),
    ),
  );

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  const selectCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  return (
    <div className="space-y-6">
      {/* Month filter */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-neutral-500">Month</label>
        <select
          value={selected}
          onChange={(e) =>
            router.push(e.target.value ? `/transfers?period=${e.target.value}` : "/transfers")
          }
          className={selectCls}
        >
          <option value="">All months</option>
          {periods.map((p) => (
            <option key={p.label} value={p.label}>
              {p.pretty}
            </option>
          ))}
        </select>
        {selected && (
          <span className="text-xs text-neutral-500">showing transfers touching {selected}</span>
        )}
      </div>

      {/* Suggested matches */}
      <Section
        title="Suggested transfers"
        count={data.suggestions.length}
        hint="Same amount, opposite direction, different accounts, within a few days. Hover a row to read full descriptions."
      >
        {data.suggestions.length === 0 ? (
          <Empty>No unflagged transfer-like pairs found.</Empty>
        ) : (
          <div className="space-y-2">
            {data.suggestions.map((s, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2"
              >
                <TxnLine t={s.debit} />
                <span className="text-neutral-400 shrink-0">⇄</span>
                <TxnLine t={s.credit} />
                <span className="text-xs text-neutral-500 shrink-0">
                  {s.daysApart === 0 ? "same day" : `${s.daysApart}d apart`}
                </span>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => run(() => dismissSuggestion(s.debit.id, s.credit.id))}
                    disabled={pending}
                    className="text-xs text-neutral-500 hover:underline disabled:opacity-50"
                    title="Hide this suggestion permanently"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => run(() => linkTransfer(s.debit.id, s.credit.id))}
                    disabled={pending}
                    className="px-3 py-1 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Confirm transfer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Flagged but unmatched */}
      <Section
        title="Flagged transfers needing a match"
        count={data.unmatched.length}
        hint="Transactions you categorized as Transfer that aren't linked to their other side yet."
      >
        {data.unmatched.length === 0 ? (
          <Empty>Nothing flagged and unmatched.</Empty>
        ) : (
          <div className="space-y-2">
            {data.unmatched.map((u) => {
              const selId = sel[u.txn.id] ?? u.candidates[0]?.id;
              const selCand = u.candidates.find((c) => c.id === selId);
              return (
                <div
                  key={u.txn.id}
                  className="rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <TxnLine t={u.txn} />
                    <button
                      onClick={() => run(() => unmarkTransfer(u.txn.id))}
                      disabled={pending}
                      className="ml-auto shrink-0 text-xs text-neutral-500 hover:underline disabled:opacity-50"
                    >
                      Not a transfer
                    </button>
                  </div>
                  {u.candidates.length === 0 ? (
                    <div className="text-xs text-amber-600">
                      No matching counterpart found in imported data (the other side may not be
                      imported). It still won&apos;t count as income/spending.
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-neutral-500 shrink-0">Link to:</span>
                      <select
                        value={selId}
                        onChange={(e) => setSel((m) => ({ ...m, [u.txn.id]: Number(e.target.value) }))}
                        disabled={pending}
                        title={
                          selCand
                            ? `${selCand.account} · ${formatDate(selCand.date)} · ${formatMoney(
                                selCand.amount,
                              )} · ${selCand.description}`
                            : undefined
                        }
                        className={`${selectCls} flex-1 min-w-0 sm:min-w-[26rem]`}
                      >
                        {u.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.account} · {formatDate(c.date)} · {formatMoney(c.amount)} ·{" "}
                            {c.description}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => run(() => linkTransfer(u.txn.id, selId))}
                        disabled={pending || !selId}
                        className="shrink-0 px-3 py-1 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        Link
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Linked */}
      <Section title="Linked transfers" count={data.linked.length}>
        {data.linked.length === 0 ? (
          <Empty>No linked transfers yet.</Empty>
        ) : (
          <div className="space-y-2">
            {data.linked.map((p, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-green-200 dark:border-green-900 bg-green-50/40 dark:bg-green-950/20 px-3 py-2"
              >
                <TxnLine t={p.a} />
                <span className="text-neutral-400 shrink-0">⇄</span>
                <TxnLine t={p.b} />
                <button
                  onClick={() => run(() => unlinkTransfer(p.a.id))}
                  disabled={pending}
                  className="ml-auto shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Unlink
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function TxnLine({ t }: { t: TxnLite }) {
  const credit = t.direction === "Credit";
  const full = `${t.direction} ${formatMoney(t.amount)} · ${t.account} · ${formatDate(t.date)} · ${t.description}`;
  return (
    <span className="inline-flex items-center gap-2 text-sm min-w-0 flex-1 basis-72" title={full}>
      <span
        className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
          credit
            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
        }`}
      >
        {credit ? "+" : "−"}
        {formatMoney(t.amount)}
      </span>
      <span className="text-neutral-500 shrink-0">{t.account}</span>
      <span className="text-neutral-400 tabular-nums shrink-0">{formatDate(t.date)}</span>
      <span className="truncate min-w-0">{t.description}</span>
    </span>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
      <div>
        <h2 className="font-semibold">
          {title} <span className="text-neutral-400 font-normal">({count})</span>
        </h2>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}

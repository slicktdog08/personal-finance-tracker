"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CategoryCell } from "@/components/transactions/CategoryCell";
import { formatMoney, toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { createTransaction, deleteTransaction } from "@/server/actions/transactions";
import { NoteCell } from "@/components/transactions/NoteCell";
import { SplitTransaction, SplitSummary } from "@/components/transactions/SplitTransaction";
import { MarkPostedButton, SourceGlyph } from "@/components/transactions/StatusBadge";

function PendingBadge() {
  return (
    <span
      title="Pending — entered before the bank posted it. Merge it with the posted row from the pending tray once it's imported."
      className="shrink-0 inline-flex px-1.5 py-px rounded-full border text-[10px] font-medium uppercase tracking-wide bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
    >
      Pending
    </span>
  );
}
import type { CategoryOption, SplitPiece } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";

export interface MonthTxn {
  id: number;
  txnDate: string;
  description: string;
  notes: string | null;
  category: string | null;
  categoryRuleId?: number | null;
  amount: string | null;
  direction: string;
  accountNumber: string | null;
  accountLabel: string | null;
  /** Parts filed under other categories; `category` keeps the rest. */
  splits?: SplitPiece[];
  /** Entered by hand before the bank posted it. */
  pending?: boolean;
  /** Where the row came from: import | pdf | manual | <provider id>. */
  source?: string | null;
}

export function MonthTransactions({
  periodId,
  path,
  monthStart,
  transactions,
  categoryOptions,
  rules = [],
}: {
  periodId: number;
  path: string;
  monthStart: string;
  transactions: MonthTxn[];
  categoryOptions: CategoryOption[];
  rules?: CategoryRule[];
}) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const [date, setDate] = useState(monthStart);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("Debit");
  const [acct, setAcct] = useState("");
  const [cat, setCat] = useState("");
  const [notes, setNotes] = useState("");

  const out = transactions
    .filter((t) => t.direction === "Debit")
    .reduce((s, t) => s + (toNum(t.amount) ?? 0), 0);
  const inn = transactions
    .filter((t) => t.direction === "Credit")
    .reduce((s, t) => s + (toNum(t.amount) ?? 0), 0);

  function submit() {
    const amt = Number(amount.replace(/[$,\s]/g, ""));
    if (!desc.trim() || !date || Number.isNaN(amt)) return;
    start(async () => {
      await createTransaction(
        periodId,
        {
          txnDate: date,
          description: desc.trim(),
          amount: amt,
          direction,
          accountNumber: acct || null,
          category: cat || null,
          notes: notes.trim() || null,
        },
        path,
      );
      setDesc("");
      setAmount("");
      setAcct("");
      setCat("");
      setNotes("");
      setAdding(false);
      router.refresh();
    });
  }

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Transactions this month{" "}
          <span className="text-sm font-normal text-neutral-500">
            ({transactions.length} · out {formatMoney(out)} · in {formatMoney(inn)})
          </span>
        </h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium"
        >
          {adding ? "Close" : "+ Add transaction"}
        </button>
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-300 dark:border-neutral-700 p-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls + " w-full sm:w-auto"}
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="description"
            className={inputCls + " w-full sm:w-auto sm:flex-1 sm:min-w-48"}
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="amount"
            inputMode="decimal"
            className={inputCls + " flex-1 min-w-20 sm:flex-none sm:w-28"}
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className={inputCls + " flex-1 sm:flex-none"}
          >
            <option value="Debit">Debit</option>
            <option value="Credit">Credit</option>
          </select>
          <input
            value={acct}
            onChange={(e) => setAcct(e.target.value)}
            placeholder="acct #"
            className={inputCls + " flex-1 min-w-20 sm:flex-none sm:w-24"}
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className={inputCls + " flex-1 min-w-32 sm:flex-none"}
          >
            <option value="">— category —</option>
            {categoryOptions.filter((c) => c.active).map((c) => (
              <option key={c.name} value={c.name}>
                {c.emoji ? `${c.emoji} ` : ""}
                {c.name}
              </option>
            ))}
          </select>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="notes — what was this actually for?"
            className={inputCls + " w-full resize-y"}
          />
          <button
            onClick={submit}
            disabled={pending}
            className="w-full sm:w-auto px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      <div className="hidden md:block overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatDate(t.txnDate)}</td>
                <td className="px-3 py-1.5 max-w-sm align-top">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate" title={t.description}>
                      {t.description}
                    </span>
                    {t.pending && <PendingBadge />}
                    <MarkPostedButton id={t.id} pending={t.pending} source={t.source} path={path} />
                    <SourceGlyph source={t.source} />
                  </div>
                  <NoteCell id={t.id} value={t.notes} path={path} />
                </td>
                <td className="px-3 py-1.5">{t.accountLabel ?? t.accountNumber ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <CategoryCell
                    id={t.id}
                    value={t.category}
                    options={categoryOptions}
                    path={path}
                    description={t.description}
                    rules={rules}
                    categoryRuleId={t.categoryRuleId ?? null}
                  />
                  <SplitSummary
                    amount={t.amount}
                    splits={t.splits ?? []}
                    categoryOptions={categoryOptions}
                  />
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    t.direction === "Credit" ? "text-green-600 dark:text-green-400" : ""
                  }`}
                >
                  {t.direction === "Credit" ? "+" : "−"}
                  {formatMoney(t.amount)}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <SplitTransaction
                    txn={t}
                    categoryOptions={categoryOptions}
                    path={path}
                  />
                  <button
                    onClick={() => {
                      if (confirm("Delete this transaction?"))
                        start(async () => {
                          await deleteTransaction(t.id, path);
                          router.refresh();
                        });
                    }}
                    className="ml-2 text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No transactions for this month. Add one above, or import a CSV.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards instead of the table. */}
      <ul className="md:hidden rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
        {transactions.map((t) => (
          <li key={t.id} className="p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium" title={t.description}>
                    {t.description}
                  </span>
                  {t.pending && <PendingBadge />}
                  <MarkPostedButton id={t.id} pending={t.pending} source={t.source} path={path} />
                </div>
                <div className="text-xs text-neutral-500 tabular-nums">
                  {formatDate(t.txnDate)} · {t.accountLabel ?? t.accountNumber ?? "no account"}
                </div>
              </div>
              <div
                className={`shrink-0 text-right tabular-nums ${
                  t.direction === "Credit" ? "text-green-600 dark:text-green-400" : ""
                }`}
              >
                {t.direction === "Credit" ? "+" : "−"}
                {formatMoney(t.amount)}
              </div>
            </div>
            <NoteCell id={t.id} value={t.notes} path={path} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <CategoryCell
                  id={t.id}
                  value={t.category}
                  options={categoryOptions}
                  path={path}
                  description={t.description}
                  rules={rules}
                  categoryRuleId={t.categoryRuleId ?? null}
                />
                <SplitSummary
                  amount={t.amount}
                  splits={t.splits ?? []}
                  categoryOptions={categoryOptions}
                />
              </div>
              <div className="flex items-center gap-3">
              <SplitTransaction
                txn={t}
                categoryOptions={categoryOptions}
                path={path}
              />
              <button
                onClick={() => {
                  if (confirm("Delete this transaction?"))
                    start(async () => {
                      await deleteTransaction(t.id, path);
                      router.refresh();
                    });
                }}
                className="text-xs text-red-600 hover:underline"
              >
                Delete
              </button>
              </div>
            </div>
          </li>
        ))}
        {transactions.length === 0 && (
          <li className="px-3 py-6 text-center text-neutral-500">
            No transactions for this month. Add one above, or import a CSV.
          </li>
        )}
      </ul>
    </section>
  );
}

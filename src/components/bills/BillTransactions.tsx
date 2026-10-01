"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setTransactionBill } from "@/server/actions/transactions";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";

export interface BillTxnRow {
  id: number;
  txnDate: string;
  description: string;
  amount: string | null;
  direction: string;
  accountNumber: string | null;
  accountLabel: string | null;
  periodLabel: string | null;
}

interface BillOpt {
  id: number;
  name: string;
}

// Bill-page list of every transaction attributed to this bill. This is where a
// mislink gets fixed: when two bills share one statement line (two cards through
// the same lender), the wrong months end up here — unlink them, or move them
// straight to the other bill without touching anything else.
export function BillTransactions({
  billId,
  billName,
  rows,
  others,
}: {
  billId: number;
  billName: string;
  rows: BillTxnRow[];
  others: BillOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const path = `/settings/bills/${billId}`;

  function run(id: number, target: number | null) {
    setBusyId(id);
    start(async () => {
      const res = await setTransactionBill(id, target, path);
      setBusyId(null);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  function unlink(r: BillTxnRow) {
    if (
      !confirm(
        `Unlink the ${formatDate(r.txnDate)} ${formatMoney(r.amount)} transaction from ${billName}?`,
      )
    )
      return;
    run(r.id, null);
  }

  const total = rows.reduce((s, r) => s + (r.direction === "Credit" ? -1 : 1) * Number(r.amount ?? 0), 0);
  const selectCls =
    "border rounded px-1.5 py-0.5 text-xs bg-transparent border-neutral-300 dark:border-neutral-700 max-w-36";

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Linked transactions</h2>
        {rows.length > 0 && (
          <span className="text-xs text-neutral-500 tabular-nums">
            {rows.length} · {formatMoney(total)} total
          </span>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        Payments matched to this bill. If one belongs elsewhere, unlink it or move it to the right
        bill — the bill and its months are left as they are.
      </p>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const busy = pending && busyId === r.id;
              return (
                <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {r.periodLabel ? (
                      <Link
                        href={`/months/${r.periodLabel}`}
                        className="text-blue-600 hover:underline"
                        title={`Open ${r.periodLabel}`}
                      >
                        {formatDate(r.txnDate)}
                      </Link>
                    ) : (
                      formatDate(r.txnDate)
                    )}
                  </td>
                  <td className="px-3 py-1.5 max-w-[24rem] truncate" title={r.description}>
                    {r.description}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500">
                    {r.accountLabel ?? (r.accountNumber ? `…${r.accountNumber}` : "—")}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${
                      r.direction === "Credit" ? "text-emerald-700 dark:text-emerald-400" : ""
                    }`}
                  >
                    {formatMoney(r.amount)}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      {others.length > 0 && (
                        <select
                          value=""
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.value) run(r.id, Number(e.target.value));
                          }}
                          title="Move this transaction to a different bill"
                          className={selectCls}
                        >
                          <option value="">Move to…</option>
                          {others.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={() => unlink(r)}
                        disabled={busy}
                        title="Unlink from this bill"
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {busy ? "…" : "Unlink"}
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  No transactions linked yet. Use “To bill” on the Transactions screen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

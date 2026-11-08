"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, DataTable, EmptyState, IconButton, Money, Select } from "@/components/ds";
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

// Signed for display: a payment (Debit) is money out, a refund (Credit) money in.
const signed = (r: BillTxnRow) => (r.direction === "Credit" ? 1 : -1) * Number(r.amount ?? 0);

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
    });
  }

  function unlink(r: BillTxnRow) {
    if (!confirm(`Unlink the ${formatDate(r.txnDate)} ${formatMoney(r.amount)} transaction from ${billName}?`)) return;
    run(r.id, null);
  }

  // Total paid toward the bill: payments add, refunds subtract.
  const total = rows.reduce((s, r) => s - signed(r), 0);
  const account = (r: BillTxnRow) => r.accountLabel ?? (r.accountNumber ? `…${r.accountNumber}` : "—");
  const date = (r: BillTxnRow) =>
    r.periodLabel ? (
      <Link href={`/months/${r.periodLabel}`} className="text-accent-text hover:underline" title={`Open ${r.periodLabel}`}>
        {formatDate(r.txnDate)}
      </Link>
    ) : (
      formatDate(r.txnDate)
    );
  const actions = (r: BillTxnRow) => {
    const busy = pending && busyId === r.id;
    return (
      <span className="inline-flex items-center gap-1">
        {others.length > 0 && (
          <Select
            value=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) run(r.id, Number(e.target.value));
            }}
            title="Move this transaction to a different bill"
            aria-label="Move to another bill"
            className="h-8 w-auto max-w-36 text-xs"
            options={[{ value: "", label: "Move to…" }, ...others.map((b) => ({ value: String(b.id), label: b.name }))]}
          />
        )}
        <IconButton icon="unlink" label="Unlink from this bill" size="sm" onClick={() => unlink(r)} disabled={busy} />
      </span>
    );
  };

  return (
    <Card
      title="Linked transactions"
      meta={
        rows.length > 0 ? (
          <span className="tnum">
            {rows.length} · <Money value={total} kind="neutral" /> total
          </span>
        ) : undefined
      }
      padded={false}
    >
      <p className="px-5 pb-1 pt-3 text-sm text-fg-2 max-md:px-3.5">
        Payments matched to this bill. If one belongs elsewhere, unlink it or move it to the right bill —
        the bill and its months stay as they are.
      </p>
      <DataTable
        rows={rows}
        columns={[
          { key: "date", header: "Date", shrink: true, render: (r) => <span className="tnum">{date(r)}</span> },
          {
            key: "desc",
            header: "Description",
            render: (r) => (
              <span className="block max-w-[24rem] truncate" title={r.description}>
                {r.description}
              </span>
            ),
          },
          { key: "acct", header: "Account", shrink: true, render: (r) => <span className="text-fg-2">{account(r)}</span> },
          { key: "amt", header: "Amount", num: true, render: (r) => <Money value={signed(r)} /> },
          { key: "act", header: <span className="sr-only">Actions</span>, shrink: true, render: actions },
        ]}
        mobile={{
          title: (r) => <span title={r.description}>{r.description}</span>,
          sub: (r) => (
            <>
              {date(r)} · {account(r)}
            </>
          ),
          amount: (r) => <Money value={signed(r)} />,
          meta: actions,
        }}
        empty={
          <EmptyState
            compact
            icon="link"
            title="Nothing linked yet"
            body="When a payment posts, link it with “To bill” in Activity and it shows up here."
          />
        }
      />
    </Card>
  );
}

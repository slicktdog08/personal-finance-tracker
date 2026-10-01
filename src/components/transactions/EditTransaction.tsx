"use client";

import { useState, useRef, useTransition } from "react";
import { LOCAL_SOURCES } from "@/constants/sync";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { PencilIcon } from "@/components/icons";
import { updateTransaction } from "@/server/actions/transactions";
import { toNum } from "@/server/lib/money";
import type { CategoryOption } from "@/server/queries";

export interface EditAccountOption {
  id: number;
  accountNumber: string;
  label: string | null;
}

export interface EditableTxn {
  id: number;
  txnDate: string;
  description: string;
  notes: string | null;
  category: string | null;
  amount: string | null;
  direction: string;
  accountNumber: string | null;
  pending?: boolean;
  /** Where the row came from; bank-synced rows can't have their pending flag edited here. */
  source?: string | null;
}

// Per-row "Edit" action: fix a transaction's date, description, amount,
// direction, account or category after the fact instead of deleting and
// re-adding it. Rendered in a Sheet (bottom sheet on mobile, anchored popover
// on desktop) so the table's overflow-x-auto container can't clip it.
export function EditTransaction({
  txn,
  accounts,
  categoryOptions,
  path = "/transactions",
}: {
  txn: EditableTxn;
  accounts: EditAccountOption[];
  categoryOptions: CategoryOption[];
  path?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);

  const [date, setDate] = useState(txn.txnDate);
  const [desc, setDesc] = useState(txn.description);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState(txn.direction);
  const [acct, setAcct] = useState(txn.accountNumber ?? "");
  const [cat, setCat] = useState(txn.category ?? "");
  const [notes, setNotes] = useState(txn.notes ?? "");
  const [isPending, setIsPending] = useState(!!txn.pending);
  // A bank-synced row's pending flag belongs to the provider until the next run, so editing it
  // here would only disagree with the bank.
  const synced = !!txn.source && !LOCAL_SOURCES.includes(txn.source);

  // Always (re)seed the form from the row when opening, so a cancelled edit or a
  // refreshed row never leaves stale values behind.
  function openPanel() {
    setDate(txn.txnDate);
    setDesc(txn.description);
    setAmount(String(toNum(txn.amount) ?? ""));
    setDirection(txn.direction);
    setAcct(txn.accountNumber ?? "");
    setCat(txn.category ?? "");
    setNotes(txn.notes ?? "");
    setIsPending(!!txn.pending);
    setOpen(true);
  }

  const amt = Number(amount.replace(/[$,\s]/g, ""));
  const valid = !!desc.trim() && !!date && !Number.isNaN(amt) && amt !== 0;

  function submit() {
    if (!valid) return;
    start(async () => {
      const res = await updateTransaction(
        txn.id,
        {
          txnDate: date,
          description: desc.trim(),
          amount: amt,
          direction,
          accountNumber: acct || null,
          category: cat || null,
          notes: notes.trim() || null,
          ...(synced ? {} : { pending: isPending }),
        },
        path,
      );
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  }

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700 w-full";

  const panel = (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Edit transaction"
      anchorRef={btnRef}
      desktop="anchored"
      width={300}
    >
          <div className="space-y-2 text-left">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Description</span>
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className={inputCls}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-col gap-1 flex-1">
                <span className="text-xs text-neutral-500">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Type</span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  className={inputCls}
                >
                  <option value="Debit">Debit</option>
                  <option value="Credit">Credit</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Account</span>
              <select
                value={acct}
                onChange={(e) => setAcct(e.target.value)}
                className={inputCls}
              >
                <option value="">— none —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.accountNumber}>
                    {a.label ? `${a.label} (${a.accountNumber})` : a.accountNumber}
                  </option>
                ))}
                {/* Keep an account the row already points at but that isn't in the
                    list (inactive/unregistered) selectable rather than silently lost. */}
                {acct && !accounts.some((a) => a.accountNumber === acct) && (
                  <option value={acct}>{acct}</option>
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Category</span>
              <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
                <option value="">— category —</option>
                {/* Active categories only, plus the txn's current (possibly disabled) one. */}
                {categoryOptions.filter((c) => c.active || c.name === cat).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.emoji ? `${c.emoji} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What was this actually for?"
                className={inputCls + " resize-y"}
              />
            </div>
            {!synced && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isPending}
                  onChange={(e) => setIsPending(e.target.checked)}
                  className="h-4 w-4 accent-amber-600"
                />
                <span className="text-xs text-neutral-600 dark:text-neutral-300">
                  Pending — not posted by the bank yet
                </span>
              </label>
            )}
            <p className="text-[11px] text-neutral-400">
              Changing the date moves the transaction to that month. Account balance
              snapshots aren&apos;t changed — edit those on the account.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-sm text-neutral-500 hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending || !valid}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
    </Sheet>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openPanel())}
        disabled={pending}
        title="Edit date, amount, type, account or category"
        aria-label="Edit transaction"
        className="inline-flex items-center justify-center rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 dark:hover:bg-blue-950/40"
      >
        <PencilIcon className="h-4 w-4" />
      </button>
      {panel}
    </>
  );
}

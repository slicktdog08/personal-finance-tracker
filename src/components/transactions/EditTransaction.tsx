"use client";

import { useState, useRef, useTransition } from "react";
import { LOCAL_SOURCES } from "@/constants/sync";
import { Sheet } from "@/components/ui/Sheet";
import { ColorSelect } from "@/components/ColorSelect";
import { Icon } from "@/components/ds";
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
      } else {
        alert(res.error);
      }
    });
  }

  const inputCls =
    "mp-input !h-9";

  const selectCls = "mp-select !h-9";

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
              <span className="mp-field__label">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="mp-field__label">Description</span>
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className={inputCls}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-col gap-1 flex-1">
                <span className="mp-field__label">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="mp-field__label">Type</span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  className={selectCls}
                >
                  <option value="Debit">Debit</option>
                  <option value="Credit">Credit</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="mp-field__label">Account</span>
              <select
                value={acct}
                onChange={(e) => setAcct(e.target.value)}
                className={selectCls}
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
              <span className="mp-field__label">Category</span>
              {/* Active categories only, plus the txn's current (possibly disabled) one. A colored
                  thing is picked from its color tiles, never a plain select. */}
              <div>
                <ColorSelect
                  value={cat}
                  options={categoryOptions.filter((c) => c.active || c.name === cat)}
                  allowEmpty
                  placeholder="Set category"
                  onSelect={setCat}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="mp-field__label">Notes</span>
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
                  className="h-4 w-4 accent-accent"
                />
                <span className="text-xs text-fg-2">
                  Pending — not posted by the bank yet
                </span>
              </label>
            )}
            <p className="text-[11px] text-fg-3">
              Changing the date moves the transaction to that month. Account balance
              snapshots aren&apos;t changed — edit those on the account.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                className="mp-btn mp-btn--ghost mp-btn--sm"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending || !valid}
                className="mp-btn mp-btn--primary mp-btn--sm"
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
        className="mp-btn mp-iconbtn mp-btn--ghost mp-btn--sm"
      >
        <Icon name="pencil" size={16} />
      </button>
      {panel}
    </>
  );
}

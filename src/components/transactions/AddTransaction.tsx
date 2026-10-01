"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { createTransaction } from "@/server/actions/transactions";
import { LIABILITY_ACCOUNT_TYPES, WALLET_ACCOUNT_TYPES } from "@/constants/enums";
import {
  canFund,
  defaultOffsetsFor,
  defaultWithdrawalFor,
  type OpenWithdrawal,
} from "@/server/lib/cash";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { CategoryOption } from "@/server/queries";

interface AccountOption {
  id: number;
  accountNumber: string;
  label: string | null;
  accountType: string | null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function AddTransaction({
  accounts,
  categoryOptions,
  defaultAccountNumber,
  openWithdrawals = [],
  path = "/transactions",
}: {
  accounts: AccountOption[];
  categoryOptions: CategoryOption[];
  /** Last-4 of the account currently selected in the page filter, if any. */
  defaultAccountNumber?: string;
  /** Cash withdrawals that still hold unspent money — offered when spending from the wallet. */
  openWithdrawals?: OpenWithdrawal[];
  path?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);

  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("Debit");
  const [acct, setAcct] = useState(defaultAccountNumber ?? "");
  const [cat, setCat] = useState("");
  const [notes, setNotes] = useState("");
  const [adjustBalance, setAdjustBalance] = useState(false);
  const [isPending, setIsPending] = useState(false);
  // Cash offsets: one row per withdrawal this purchase draws from. `wid` "" = none picked,
  // `amt` "" = auto (as much as that withdrawal and the price allow). `offsetTouched` marks
  // the user having taken over, which freezes the auto-plan from moving under them.
  const [offsetRows, setOffsetRows] = useState<{ wid: string; amt: string }[]>([]);
  const [offsetTouched, setOffsetTouched] = useState(false);
  const [error, setError] = useState("");

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  // Reset to a clean form each time it opens, defaulting the account to whatever
  // the page is currently filtered to.
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setDate(todayIso());
    setDesc("");
    setAmount("");
    setDirection("Debit");
    setAcct(defaultAccountNumber ?? "");
    setCat("");
    setNotes("");
    setAdjustBalance(false);
    setIsPending(false);
    setOffsetRows([]);
    setOffsetTouched(false);
    setError("");
    setOpen(true);
  }

  function submit() {
    const amt = Number(amount.replace(/[$,\s]/g, ""));
    if (!desc.trim() || !date || Number.isNaN(amt) || amt === 0) return;
    setError("");
    start(async () => {
      const res = await createTransaction(
        null,
        {
          txnDate: date,
          description: desc.trim(),
          amount: amt,
          direction,
          accountNumber: acct || null,
          category: cat || null,
          notes: notes.trim() || null,
          pending: isPending,
          adjustBalance: adjustBalance && !!acct,
          offsets: offsetting
            ? active
                .filter((x) => x.amount > 0)
                .map((x) => ({ withdrawalId: x.w!.id, amount: x.amount }))
            : null,
        },
        path,
      );
      // The transaction saved either way; only the offset can fail (the withdrawal filled up
      // in another tab). Keep the form open with the reason rather than losing it silently.
      if (res?.offset && !res.offset.ok) {
        setError(res.offset.error);
        router.refresh();
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  // Preview which way the balance moves: cash accounts add on Credit / subtract
  // on Debit; liabilities (owed balance) invert. Mirrors the server logic.
  const selectedAcct = accounts.find((a) => a.accountNumber === acct);
  const isLiability = LIABILITY_ACCOUNT_TYPES.includes(selectedAcct?.accountType ?? "");
  const addsToBalance = direction === "Credit" ? !isLiability : isLiability;

  // ---- Cash offset -------------------------------------------------------------------
  // Spending from the wallet is cash that already left the bank as a withdrawal, so offer to
  // tie the two together. Only Debits out of a wallet account qualify.
  const isWallet = WALLET_ACCOUNT_TYPES.includes(selectedAcct?.accountType ?? "");
  const amt = Number(amount.replace(/[$,\s]/g, ""));
  const spendAmount = Number.isFinite(amt) ? Math.abs(amt) : 0;
  const showOffset = isWallet && direction === "Debit" && openWithdrawals.length > 0;
  // Only withdrawals that could plausibly have funded this purchase — dated before it (bank
  // rows post late, so a few days of slack) and recent enough to still be in your pocket.
  const candidates = showOffset
    ? openWithdrawals.filter((w) => canFund(w, { txnDate: date }))
    : [];

  // Until the user takes over, follow a live plan: one withdrawal when any covers the whole
  // price, splitting across several when none does — a $470 purchase against a $300 + $200
  // withdrawal drains one and takes the rest from the other.
  const plan = offsetTouched
    ? []
    : defaultOffsetsFor({ txnDate: date, amount: spendAmount }, candidates);
  const rows = offsetTouched
    ? offsetRows
    : plan.length
      ? plan.map((p) => ({ wid: String(p.withdrawalId), amt: "" }))
      : [{ wid: "", amt: "" }];

  const toCents = (n: number) => Math.round(n * 100);
  // Resolve each row to a number, filling autos against what earlier rows already claimed so
  // they never double-spend the purchase.
  const resolved: { r: (typeof rows)[number]; w: OpenWithdrawal | null; amount: number; shown: string }[] =
    [];
  for (let claimed = 0; resolved.length < rows.length; ) {
    const r = rows[resolved.length];
    const w = candidates.find((c) => String(c.id) === r.wid) ?? null;
    if (!w) {
      resolved.push({ r, w, amount: 0, shown: "" });
      continue;
    }
    let shown = r.amt;
    if (!shown) {
      const needLeft =
        spendAmount > 0 ? Math.max(toCents(spendAmount) - claimed, 0) : toCents(w.remaining);
      shown = (Math.min(toCents(w.remaining), needLeft) / 100).toFixed(2);
    }
    const amount = Number(shown.replace(/[$,\s]/g, "")) || 0;
    claimed += toCents(amount);
    resolved.push({ r, w, amount, shown });
  }
  const active = resolved.filter((x) => x.w);
  const offsetting = active.length > 0;
  const totalOffset = active.reduce((s, x) => s + toCents(x.amount), 0) / 100;
  const shortfall =
    offsetting && spendAmount > 0
      ? Math.max(0, toCents(spendAmount) - toCents(totalOffset)) / 100
      : 0;
  const chosen = new Set(active.map((x) => String(x.w!.id)));
  const addable = candidates.filter((w) => !chosen.has(String(w.id)));
  const canAddRow = offsetting && shortfall > 0 && addable.length > 0 && rows.every((r) => r.wid);
  // What the chosen withdrawals keep after this purchase — the "drops to" figure.
  const keptAfter =
    Math.max(0, active.reduce((s, x) => s + toCents(x.w!.remaining), 0) - toCents(totalOffset)) /
    100;

  // Any edit takes over from the auto-plan: whatever is currently shown becomes the state,
  // then the change lands on top of it.
  function editRows(
    mutate: (next: { wid: string; amt: string }[]) => { wid: string; amt: string }[],
  ) {
    const next = mutate(rows.map((x) => ({ ...x })));
    setOffsetTouched(true);
    setOffsetRows(next.length ? next : [{ wid: "", amt: "" }]);
  }

  function addOffsetRow() {
    const pick = defaultWithdrawalFor({ txnDate: date, amount: shortfall }, addable);
    if (!pick) return;
    editRows((next) => [...next, { wid: String(pick.id), amt: "" }]);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium"
      >
        {open ? "Close" : "+ Add transaction"}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add transaction"
        anchorRef={btnRef}
        desktop="anchored"
        width={320}
      >
        <div className="space-y-2">
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
              placeholder="description"
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
                className={inputCls + " w-full"}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Direction</span>
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
              onChange={(e) => {
                setAcct(e.target.value);
                if (!e.target.value) setAdjustBalance(false);
              }}
              className={inputCls}
            >
              <option value="">— none —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.accountNumber}>
                  {a.label ? `${a.label} (${a.accountNumber})` : a.accountNumber}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Category</span>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
              <option value="">— category —</option>
              {categoryOptions.filter((c) => c.active).map((c) => (
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
              rows={2}
              placeholder="What was this actually for?"
              className={inputCls + " w-full resize-y"}
            />
          </div>
          {showOffset && (
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 space-y-2">
              <div className="text-xs font-medium text-amber-900 dark:text-amber-200">
                💵 Offset cash withdrawals
              </div>
              {resolved.map((x, i) => (
                <div key={x.w ? x.w.id : `pick-${i}`} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <select
                      value={x.r.wid}
                      onChange={(e) => {
                        const v = e.target.value;
                        editRows((next) => {
                          next[i] = { wid: v, amt: "" };
                          // Row 0 going back to "don't offset" clears the whole split.
                          return i === 0 && !v ? [{ wid: "", amt: "" }] : next;
                        });
                      }}
                      className={inputCls + " flex-1 min-w-0"}
                    >
                      {i === 0 && (
                        <option value="">— don&apos;t offset (cash from elsewhere) —</option>
                      )}
                      {candidates
                        .filter((w) => String(w.id) === x.r.wid || !chosen.has(String(w.id)))
                        .map((w) => (
                          <option key={w.id} value={String(w.id)}>
                            {formatDate(w.txnDate)} · {w.description.slice(0, 34)} ·{" "}
                            {formatMoney(w.remaining)} left
                          </option>
                        ))}
                    </select>
                    {i > 0 && (
                      <button
                        onClick={() => editRows((next) => next.filter((_, j) => j !== i))}
                        className="shrink-0 px-1.5 py-1 text-xs text-red-600 hover:underline"
                        title="Stop drawing from this withdrawal"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {x.w && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-600 dark:text-neutral-300">
                        Draw from it
                      </span>
                      <input
                        value={x.r.amt || x.shown}
                        onChange={(e) =>
                          editRows((next) => {
                            next[i] = { ...next[i], amt: e.target.value };
                            return next;
                          })
                        }
                        inputMode="decimal"
                        className={inputCls + " w-24 text-right"}
                      />
                    </div>
                  )}
                </div>
              ))}
              {canAddRow && (
                <button
                  onClick={addOffsetRow}
                  className="text-xs font-medium text-amber-800 dark:text-amber-300 hover:underline"
                >
                  + Draw the other {formatMoney(shortfall)} from another withdrawal
                </button>
              )}
              {offsetting ? (
                <p className="text-[11px] leading-snug text-amber-900/80 dark:text-amber-200/80">
                  {shortfall > 0 ? (
                    <>
                      Offsetting {formatMoney(totalOffset)} — the other {formatMoney(shortfall)}{" "}
                      counts as cash from somewhere else
                      {canAddRow ? ", unless you draw it from another withdrawal" : ""}.
                    </>
                  ) : active.length > 1 ? (
                    <>
                      This purchase stops being counted twice: together the withdrawals drop to{" "}
                      {formatMoney(keptAfter)} of unaccounted cash.
                    </>
                  ) : (
                    <>
                      This purchase stops being counted twice: the withdrawal drops to{" "}
                      {formatMoney(keptAfter)} of unaccounted cash.
                    </>
                  )}
                </p>
              ) : (
                <p className="text-[11px] leading-snug text-amber-900/80 dark:text-amber-200/80">
                  Left un-offset, this is spending on top of the withdrawals — right only if the
                  cash came from somewhere the app doesn&apos;t know about.
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isPending}
              onChange={(e) => setIsPending(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-600"
            />
            <span className="text-xs text-neutral-600 dark:text-neutral-300">
              Pending — not posted by the bank yet
              <span className="block text-neutral-400">
                When the statement row is imported, it&apos;s matched to this one (amount can
                differ, e.g. a tip) so you can merge instead of duplicating.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={adjustBalance}
              disabled={!acct}
              onChange={(e) => setAdjustBalance(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <span className="text-xs text-neutral-600 dark:text-neutral-300">
              Apply to account balance
              <span className="block text-neutral-400">
                {acct
                  ? `Records a ledger entry — ${
                      addsToBalance ? "adds to" : "subtracts from"
                    } the ${isLiability ? "balance owed" : "account balance"}.`
                  : "Select an account to enable."}
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-sm text-neutral-500 hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

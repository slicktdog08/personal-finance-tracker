"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { monthlyInterest, annualInterest, payoffProgress } from "@/server/lib/debt";
import { ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES } from "@/constants/enums";
import { addAccountBalance, deleteAccountBalance, updateAccount } from "@/server/actions/accounts";

export interface DebtLedgerRow {
  id: number;
  balance: string;
  creditLimit: string | null;
  apr: string | null;
  minPayment: string | null;
  asOf: string;
  note: string | null;
}
// A liability account (Credit or Loan) shown through the debt lens.
export interface DebtInfo {
  id: number; // account id
  accountNumber: string;
  label: string | null;
  institution: string | null;
  accountType: string;
  billId: number | null;
  originalPrincipal: string | null;
  openedOn: string | null;
  notes: string | null;
  balance: string | null;
  creditLimit: string | null;
  apr: string | null;
  minPayment: string | null;
  asOf: string | null;
}

const inputCls =
  "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";
const num = (s: string) => {
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return Number.isNaN(n) ? null : n;
};

export function DebtCard({
  debt,
  ledger,
  payments,
  txnCount,
  lastTxn,
}: {
  debt: DebtInfo;
  ledger: DebtLedgerRow[];
  payments: { count: number; total: number } | null;
  txnCount: number;
  lastTxn: string | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const refresh = () => router.refresh();

  const [type, setType] = useState(debt.accountType);
  const isCredit = CREDIT_ACCOUNT_TYPES.includes(type);

  const [bal, setBal] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  // Pre-fill APR / min / limit from the last known values so a balance update doesn't require
  // re-typing values that rarely change (freshest non-null wins).
  const lastApr = ledger.find((r) => r.apr != null)?.apr ?? "";
  const lastMin = ledger.find((r) => r.minPayment != null)?.minPayment ?? "";
  const lastLimit = ledger.find((r) => r.creditLimit != null)?.creditLimit ?? "";
  const [apr, setApr] = useState(lastApr);
  const [minPay, setMinPay] = useState(lastMin);
  const [lim, setLim] = useState(lastLimit);

  const curBalance = toNum(debt.balance);
  const curApr = toNum(debt.apr);
  const curLimit = toNum(debt.creditLimit);
  const original = toNum(debt.originalPrincipal);
  const curMin = toNum(debt.minPayment);
  const mInt = monthlyInterest(curBalance, curApr);
  const yInt = annualInterest(curBalance, curApr);
  const progress = payoffProgress(original, curBalance);
  const available = isCredit && curBalance != null && curLimit != null ? curLimit - curBalance : null;
  const utilization =
    isCredit && curBalance != null && curLimit != null && curLimit > 0
      ? (curBalance / curLimit) * 100
      : null;
  const paidOff = curBalance != null && curBalance <= 0;

  function record() {
    const n = num(bal);
    if (n == null || !asOf) return;
    start(async () => {
      await addAccountBalance(
        debt.id,
        n,
        asOf,
        note || null,
        isCredit ? num(lim) : null,
        num(apr),
        num(minPay),
      );
      setBal("");
      setNote("");
      refresh();
    });
  }

  function saveStatic(patch: Parameters<typeof updateAccount>[1]) {
    start(async () => {
      await updateAccount(debt.id, patch);
      refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
      {/* Header — full account management (this is the card/loan's only home now) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800">
          ••{debt.accountNumber}
        </span>
        <input
          defaultValue={debt.label ?? ""}
          placeholder="label (e.g. Example Card)"
          onBlur={(e) => e.target.value !== (debt.label ?? "") && saveStatic({ label: e.target.value })}
          className={inputCls + " flex-1 min-w-40 font-semibold"}
        />
        <input
          defaultValue={debt.institution ?? ""}
          placeholder="institution"
          onBlur={(e) =>
            e.target.value !== (debt.institution ?? "") && saveStatic({ institution: e.target.value })
          }
          className={inputCls + " w-32"}
        />
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            saveStatic({ accountType: e.target.value });
          }}
          className={inputCls}
          title="Change type. Switch to Checking/Savings to move this to Accounts."
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {paidOff && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            🎉 Paid off
          </span>
        )}
        <span className="text-xs text-neutral-500">
          {txnCount} txns{" · "}
          {lastTxn ? `last ${formatDate(lastTxn)}` : "no transactions"}
        </span>
        {payments && payments.count > 0 && (
          <span className="text-xs text-neutral-500" title="Transactions linked to this account's bill">
            · {formatMoney(payments.total)} paid
          </span>
        )}
      </div>

      {/* Headline: balance owed + payoff progress */}
      <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Balance owed</div>
            <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-400">
              {curBalance != null ? formatMoney(curBalance) : "—"}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {isCredit && curLimit != null && <>of {formatMoney(curLimit)} limit</>}
              {!isCredit && original != null && <>of {formatMoney(original)} original</>}
              {progress && <> · {progress.pct.toFixed(0)}% paid off</>}
              {utilization != null && <> · {utilization.toFixed(0)}% utilized</>}
              {debt.asOf && <> · as of {formatDate(debt.asOf)}</>}
            </div>
          </div>

          {/* Interest cost — the motivational bit */}
          {mInt != null && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-1.5 text-right">
              <div className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {formatMoney(mInt)}
                <span className="text-xs font-normal text-neutral-500"> / mo interest</span>
              </div>
              <div className="text-[11px] text-neutral-500">
                {yInt != null && <>{formatMoney(yInt)}/yr</>}
                {curApr != null && <> · {curApr}% APR</>}
              </div>
            </div>
          )}
        </div>

        {/* Progress bar: utilization for cards (fills red as you use more), payoff for loans */}
        {isCredit && utilization != null ? (
          <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-full ${
                utilization >= 80 ? "bg-red-500" : utilization >= 50 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(2, utilization))}%` }}
            />
          </div>
        ) : progress ? (
          <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${Math.min(100, Math.max(2, progress.pct))}%` }}
            />
          </div>
        ) : null}

        {(curMin != null || available != null || debt.openedOn) && (
          <div className="text-xs text-neutral-500 flex flex-wrap gap-x-4">
            {curMin != null && <span>Min payment {formatMoney(curMin)}/mo</span>}
            {available != null && <span>{formatMoney(available)} available</span>}
            {debt.openedOn && <span>Opened {formatDate(debt.openedOn)}</span>}
          </div>
        )}
      </div>

      {/* Static facts: original principal + opened date */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-neutral-500">
            {isCredit ? "Starting balance" : "Original principal"}
          </label>
          <input
            defaultValue={debt.originalPrincipal ?? ""}
            placeholder="e.g. 12000"
            inputMode="decimal"
            onBlur={(e) => {
              const v = e.target.value.trim();
              const next = v === "" ? null : num(v);
              if ((debt.originalPrincipal ?? "") !== v) saveStatic({ originalPrincipal: next });
            }}
            className={inputCls + " w-32"}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Opened</label>
          <input
            type="date"
            defaultValue={debt.openedOn ?? ""}
            onBlur={(e) => {
              if ((debt.openedOn ?? "") !== e.target.value)
                saveStatic({ openedOn: e.target.value || null });
            }}
            className={inputCls}
          />
        </div>
      </div>

      {/* Record a new balance snapshot */}
      <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-neutral-500">Update balance</div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] text-neutral-500">Balance</label>
            <input
              value={bal}
              onChange={(e) => setBal(e.target.value)}
              placeholder="balance"
              inputMode="decimal"
              className={inputCls + " w-28"}
            />
          </div>
          {isCredit && (
            <div>
              <label className="block text-[10px] text-neutral-500">Limit</label>
              <input
                value={lim}
                onChange={(e) => setLim(e.target.value)}
                placeholder="limit"
                inputMode="decimal"
                className={inputCls + " w-24"}
              />
            </div>
          )}
          <div>
            <label className="block text-[10px] text-neutral-500">APR %</label>
            <input
              value={apr}
              onChange={(e) => setApr(e.target.value)}
              placeholder="APR"
              inputMode="decimal"
              className={inputCls + " w-20"}
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500">Min pay</label>
            <input
              value={minPay}
              onChange={(e) => setMinPay(e.target.value)}
              placeholder="min"
              inputMode="decimal"
              className={inputCls + " w-20"}
            />
          </div>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputCls}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (optional)"
            className={inputCls + " flex-1 min-w-32"}
          />
          <button
            onClick={record}
            disabled={pending || !bal.trim()}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Record
          </button>
        </div>
      </div>

      {/* History */}
      {ledger.length > 0 && (
        <div className="max-h-56 overflow-y-auto overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500 text-left">
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium text-right">Balance</th>
                {isCredit && <th className="py-1 font-medium text-right pl-3">Limit</th>}
                <th className="py-1 font-medium text-right pl-3">APR</th>
                <th className="py-1 font-medium text-right pl-3">Min</th>
                <th className="py-1 font-medium pl-3">Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1 tabular-nums">{formatDate(r.asOf)}</td>
                  <td className="py-1 text-right tabular-nums font-medium">{formatMoney(r.balance)}</td>
                  {isCredit && (
                    <td className="py-1 text-right tabular-nums pl-3 text-neutral-500">
                      {r.creditLimit != null ? formatMoney(r.creditLimit) : "—"}
                    </td>
                  )}
                  <td className="py-1 text-right tabular-nums pl-3 text-neutral-500">
                    {r.apr != null ? `${r.apr}%` : "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums pl-3 text-neutral-500">
                    {r.minPayment != null ? formatMoney(r.minPayment) : "—"}
                  </td>
                  <td className="py-1 pl-3 text-neutral-500 truncate max-w-40">{r.note ?? ""}</td>
                  <td className="py-1 text-right">
                    <button
                      onClick={() =>
                        start(async () => {
                          await deleteAccountBalance(r.id);
                          refresh();
                        })
                      }
                      className="text-xs text-red-600 hover:underline"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

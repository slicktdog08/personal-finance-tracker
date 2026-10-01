"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sourceLabel } from "@/constants/sync";
import { relativeTime } from "@/lib/sync-format";
import { formatMoney, toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { monthlyInterest, payoffProgress } from "@/server/lib/debt";
import { ACCOUNT_TYPES, CASH_ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import { updateAccount, addAccountBalance, deleteAccountBalance } from "@/server/actions/accounts";

export interface BalanceRow {
  id: number;
  balance: string;
  creditLimit: string | null;
  apr: string | null;
  minPayment: string | null;
  asOf: string;
  note: string | null;
}
export interface AccountInfo {
  id: number;
  accountNumber: string;
  label: string | null;
  institution: string | null;
  accountType: string | null;
  originalPrincipal: string | null;
  openedOn: string | null;
}

export function AccountCard({
  account,
  balances,
  txnCount,
  lastTxn,
  sync = null,
}: {
  account: AccountInfo;
  balances: BalanceRow[];
  txnCount: number;
  lastTxn: string | null;
  /** Present when a bank-sync account feeds this one (settings → Bank Sync). */
  sync?: { provider: string; enabled: boolean; lastSyncedAt: string | null; enrollmentStatus: string } | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [type, setType] = useState(account.accountType ?? "");
  const [bal, setBal] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const isCash = CASH_ACCOUNT_TYPES.includes(type);
  const isCredit = CREDIT_ACCOUNT_TYPES.includes(type);
  const isLiability = LIABILITY_ACCOUNT_TYPES.includes(type);
  const latest = balances[0];
  // These change rarely; pre-fill from the most recent known value so recording a new balance
  // doesn't require re-typing them (freshest non-null wins).
  const lastKnownLimit = balances.find((b) => b.creditLimit != null)?.creditLimit ?? "";
  const lastKnownApr = balances.find((b) => b.apr != null)?.apr ?? "";
  const lastKnownMin = balances.find((b) => b.minPayment != null)?.minPayment ?? "";
  const [lim, setLim] = useState(lastKnownLimit);
  const [apr, setApr] = useState(lastKnownApr);
  const [minPay, setMinPay] = useState(lastKnownMin);

  const refresh = () => router.refresh();
  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";
  const num = (s: string) => {
    const n = Number(s.replace(/[$,%\s]/g, ""));
    return Number.isNaN(n) ? null : n;
  };

  function save(patch: Parameters<typeof updateAccount>[1]) {
    start(async () => {
      await updateAccount(account.id, patch);
      refresh();
    });
  }

  function addBalance() {
    const n = Number(bal.replace(/[$,\s]/g, ""));
    if (Number.isNaN(n) || !asOf) return;
    // Credit captures a limit; both liability types capture APR + min payment. Blank → carry
    // nothing for this snapshot (the query carries the last known value forward).
    const creditLimit = isCredit ? num(lim) : null;
    const aprN = isLiability ? num(apr) : null;
    const minN = isLiability ? num(minPay) : null;
    start(async () => {
      await addAccountBalance(account.id, n, asOf, note || null, creditLimit, aprN, minN);
      setBal("");
      setNote("");
      refresh();
    });
  }

  // Current liability standing from the latest snapshot (limit/APR fall back to last known).
  const curBalance = toNum(latest?.balance ?? null);
  const curLimit = toNum(latest?.creditLimit ?? lastKnownLimit ?? null);
  const curApr = toNum(latest?.apr ?? lastKnownApr ?? null);
  const curMin = toNum(latest?.minPayment ?? lastKnownMin ?? null);
  const original = toNum(account.originalPrincipal);
  const available = isCredit && curBalance != null && curLimit != null ? curLimit - curBalance : null;
  const utilization =
    isCredit && curBalance != null && curLimit != null && curLimit > 0
      ? (curBalance / curLimit) * 100
      : null;
  const mInt = monthlyInterest(curBalance, curApr);
  const progress = !isCredit ? payoffProgress(original, curBalance) : null;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800">
          ••{account.accountNumber}
        </span>
        <input
          defaultValue={account.label ?? ""}
          placeholder="label (e.g. BOA Checking)"
          onBlur={(e) => e.target.value !== (account.label ?? "") && save({ label: e.target.value })}
          className={inputCls + " flex-1 min-w-40"}
        />
        <input
          defaultValue={account.institution ?? ""}
          placeholder="institution"
          onBlur={(e) =>
            e.target.value !== (account.institution ?? "") && save({ institution: e.target.value })
          }
          className={inputCls + " w-36"}
        />
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            save({ accountType: e.target.value });
          }}
          className={inputCls}
        >
          <option value="">type…</option>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">
          {txnCount} txns{" · "}
          {lastTxn ? `last ${formatDate(lastTxn)}` : "no transactions"}
          {sync && (
            <>
              {" · "}
              <Link href="/settings/sync" className="hover:underline" title={sourceLabel(sync.provider)}>
                {sync.enrollmentStatus === "disconnected"
                  ? "sync disconnected"
                  : !sync.enabled
                    ? "sync off"
                    : `synced ${relativeTime(sync.lastSyncedAt)}`}
              </Link>
            </>
          )}
        </span>
      </div>

      {isCash && (
        <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">Cash on hand</div>
            <div className="text-xl font-semibold tabular-nums">
              {latest ? formatMoney(latest.balance) : "—"}
              {latest && (
                <span className="ml-2 text-xs font-normal text-neutral-500">as of {formatDate(latest.asOf)}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <input
              value={bal}
              onChange={(e) => setBal(e.target.value)}
              placeholder="balance"
              inputMode="decimal"
              className={inputCls + " w-28"}
            />
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="note (optional)"
              className={inputCls + " flex-1 min-w-32"}
            />
            <button
              onClick={addBalance}
              disabled={pending || !bal.trim()}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Record
            </button>
          </div>

          {balances.length > 0 && (
            <History count={balances.length}>
              <table className="w-full text-sm">
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.id} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1 tabular-nums">{formatDate(b.asOf)}</td>
                      <td className="py-1 text-right tabular-nums font-medium">{formatMoney(b.balance)}</td>
                      <td className="py-1 pl-3 text-neutral-500 truncate max-w-48">{b.note ?? ""}</td>
                      <td className="py-1 text-right">
                        <DeleteBtn id={b.id} start={start} refresh={refresh} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </History>
          )}
        </div>
      )}

      {isLiability && (
        <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-sm font-medium">{isCredit ? "Credit standing" : "Loan standing"}</div>
            <div className="text-right">
              <div className="text-xl font-semibold tabular-nums">
                {curBalance != null ? formatMoney(curBalance) : "—"}
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  owed
                  {isCredit && curLimit != null ? ` of ${formatMoney(curLimit)} limit` : ""}
                  {!isCredit && original != null ? ` of ${formatMoney(original)} original` : ""}
                  {latest && ` · as of ${formatDate(latest.asOf)}`}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-neutral-500 flex flex-wrap justify-end gap-x-3">
                {available != null && <span>{formatMoney(available)} available</span>}
                {utilization != null && <span>{utilization.toFixed(0)}% utilized</span>}
                {progress && <span>{progress.pct.toFixed(0)}% paid off</span>}
                {curMin != null && <span>Min {formatMoney(curMin)}/mo</span>}
                {mInt != null && mInt > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">{formatMoney(mInt)}/mo interest</span>
                )}
              </div>
            </div>
          </div>

          {/* Utilization (cards) / payoff (loans) bar */}
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
              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(2, progress.pct))}%` }} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Balance owed</label>
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
                <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Credit limit</label>
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
              <label className="block text-[10px] uppercase tracking-wide text-neutral-500">APR %</label>
              <input
                value={apr}
                onChange={(e) => setApr(e.target.value)}
                placeholder="APR"
                inputMode="decimal"
                className={inputCls + " w-20"}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Min pay</label>
              <input
                value={minPay}
                onChange={(e) => setMinPay(e.target.value)}
                placeholder="min"
                inputMode="decimal"
                className={inputCls + " w-20"}
              />
            </div>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="note (optional)"
              className={inputCls + " flex-1 min-w-32"}
            />
            <button
              onClick={addBalance}
              disabled={pending || !bal.trim()}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Record
            </button>
          </div>

          {/* Loan-only static fact: original principal drives payoff progress */}
          {!isCredit && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Original principal</label>
                <input
                  defaultValue={account.originalPrincipal ?? ""}
                  placeholder="e.g. 12000"
                  inputMode="decimal"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if ((account.originalPrincipal ?? "") !== v)
                      save({ originalPrincipal: v === "" ? null : num(v) });
                  }}
                  className={inputCls + " w-32"}
                />
              </div>
            </div>
          )}

          {balances.length > 0 && (
            <History count={balances.length}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-neutral-500 text-left">
                    <th className="py-1 font-medium">Date</th>
                    <th className="py-1 font-medium text-right">Owed</th>
                    {isCredit && <th className="py-1 font-medium text-right pl-3">Limit</th>}
                    <th className="py-1 font-medium text-right pl-3">APR</th>
                    <th className="py-1 font-medium text-right pl-3">Min</th>
                    <th className="py-1 font-medium pl-3">Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.id} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1 tabular-nums">{formatDate(b.asOf)}</td>
                      <td className="py-1 text-right tabular-nums font-medium">{formatMoney(b.balance)}</td>
                      {isCredit && (
                        <td className="py-1 text-right tabular-nums pl-3 text-neutral-500">
                          {b.creditLimit != null ? formatMoney(b.creditLimit) : "—"}
                        </td>
                      )}
                      <td className="py-1 text-right tabular-nums pl-3 text-neutral-500">
                        {b.apr != null ? `${b.apr}%` : "—"}
                      </td>
                      <td className="py-1 text-right tabular-nums pl-3 text-neutral-500">
                        {b.minPayment != null ? formatMoney(b.minPayment) : "—"}
                      </td>
                      <td className="py-1 pl-3 text-neutral-500 truncate max-w-40">{b.note ?? ""}</td>
                      <td className="py-1 text-right">
                        <DeleteBtn id={b.id} start={start} refresh={refresh} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </History>
          )}
        </div>
      )}
    </div>
  );
}

// The recorded-balance ledger, collapsed by default: the current balance and the "Record" form
// stay in view; the list only takes room when you ask for it.
function History({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center gap-1">
        <span className="inline-block transition-transform group-open:rotate-90">▶</span>
        History ({count} recorded)
      </summary>
      <div className="mt-2 max-h-48 overflow-y-auto overflow-x-auto">{children}</div>
    </details>
  );
}

function DeleteBtn({
  id,
  start,
  refresh,
}: {
  id: number;
  start: (cb: () => Promise<void>) => void;
  refresh: () => void;
}) {
  return (
    <button
      onClick={() =>
        start(async () => {
          await deleteAccountBalance(id);
          refresh();
        })
      }
      className="text-xs text-red-600 hover:underline"
    >
      ✕
    </button>
  );
}

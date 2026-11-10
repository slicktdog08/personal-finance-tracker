"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sourceLabel } from "@/constants/sync";
import { relativeTime } from "@/lib/sync-format";
import { formatMoney, toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { monthlyInterest, payoffProgress } from "@/server/lib/debt";
import { ACCOUNT_TYPES, CASH_ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, LIABILITY_ACCOUNT_TYPES, RETIREMENT_ACCOUNT_TYPES } from "@/constants/enums";
import { updateAccount, addAccountBalance, deleteAccountBalance } from "@/server/actions/accounts";
import { Field, Glyph, Icon, IconButton, Input, Money, ProgressBar, Select, Button, cx } from "@/components/ds";
import { accountGlyph, accountMaskLine } from "./account-glyph";

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
  // Collapsed it's the kit's ListRow; expanded it carries the editor, the record-balance form
  // and the history — everything the old always-open card had.
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(account.accountType ?? "");
  const [bal, setBal] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const isCash = CASH_ACCOUNT_TYPES.includes(type);
  const isCredit = CREDIT_ACCOUNT_TYPES.includes(type);
  const isLiability = LIABILITY_ACCOUNT_TYPES.includes(type);
  // A 401(k)/IRA records a balance exactly like cash does — it's just not spendable.
  const isRetirement = RETIREMENT_ACCOUNT_TYPES.includes(type);
  const latest = balances[0];
  // These change rarely; pre-fill from the most recent known value so recording a new balance
  // doesn't require re-typing them (freshest non-null wins).
  const lastKnownLimit = balances.find((b) => b.creditLimit != null)?.creditLimit ?? "";
  const lastKnownApr = balances.find((b) => b.apr != null)?.apr ?? "";
  const lastKnownMin = balances.find((b) => b.minPayment != null)?.minPayment ?? "";
  const [lim, setLim] = useState(lastKnownLimit);
  const [apr, setApr] = useState(lastKnownApr);
  const [minPay, setMinPay] = useState(lastKnownMin);

  const num = (s: string) => {
    const n = Number(s.replace(/[$,%\s]/g, ""));
    return Number.isNaN(n) ? null : n;
  };

  function save(patch: Parameters<typeof updateAccount>[1]) {
    start(async () => {
      await updateAccount(account.id, patch);
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

  const glyph = accountGlyph(type);
  const name = account.label || account.institution || `••${account.accountNumber}`;
  const syncText = sync
    ? sync.enrollmentStatus === "disconnected"
      ? "sync disconnected"
      : !sync.enabled
        ? "sync off"
        : `synced ${relativeTime(sync.lastSyncedAt)}`
    : null;
  const endSub = isLiability
    ? isCredit && curLimit != null
      ? `of ${formatMoney(curLimit)} limit`
      : curApr != null
        ? `${curApr}% APR`
        : null
    : latest
      ? `as of ${formatDate(latest.asOf)}`
      : "no balance yet";
  const id = `acct-${account.id}`;
  const recordBtn = (
    <Button onClick={addBalance} disabled={pending || !bal.trim()} icon="plus">
      Record balance
    </Button>
  );

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="mp-listrow mp-listrow--button !border-b-0"
      >
        <Glyph icon={glyph.icon} color={glyph.color} />
        <span className="mp-listrow__main">
          <span className="mp-listrow__title">{name}</span>
          <span className="mp-listrow__sub truncate">
            {accountMaskLine({ ...account, accountType: type || null })}
            {syncText && ` · ${syncText}`}
          </span>
        </span>
        <span className="mp-listrow__end">
          {isLiability ? (
            curBalance != null ? <Money value={curBalance} kind="owed" /> : <span className="text-fg-3">—</span>
          ) : latest ? (
            <Money value={latest.balance} kind="neutral" />
          ) : (
            <span className="text-fg-3">—</span>
          )}
          {endSub && <span className="mp-listrow__sub">{endSub}</span>}
        </span>
        <Icon name="chevron-down" size={16} className={cx("shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div id={id} className="mb-3 space-y-4 rounded-panel bg-sunken p-3.5">
          {/* Identity: last four is the key, the rest edits in place (saves on blur / change). */}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,10rem)]">
            <Field label="Label" htmlFor={`${id}-label`}>
              <Input
                id={`${id}-label`}
                defaultValue={account.label ?? ""}
                placeholder="e.g. BOA Checking"
                onBlur={(e) => e.target.value !== (account.label ?? "") && save({ label: e.target.value })}
              />
            </Field>
            <Field label="Institution" htmlFor={`${id}-inst`}>
              <Input
                id={`${id}-inst`}
                defaultValue={account.institution ?? ""}
                placeholder="e.g. Chase"
                onBlur={(e) => e.target.value !== (account.institution ?? "") && save({ institution: e.target.value })}
              />
            </Field>
            <Field label="Type" htmlFor={`${id}-type`} hint={isLiability ? "Credit and Loan accounts live on Debts" : undefined}>
              <Select
                id={`${id}-type`}
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  save({ accountType: e.target.value });
                }}
                options={[{ value: "", label: "Not set" }, ...ACCOUNT_TYPES.map((t) => t as string)]}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
            <span className="font-mono">••{account.accountNumber}</span>
            <span>·</span>
            <span>
              {txnCount} txns · {lastTxn ? `last ${formatDate(lastTxn)}` : "no transactions"}
            </span>
            {sync && syncText && (
              <>
                <span>·</span>
                <Link href="/settings/sync" className="hover:text-accent-text hover:underline" title={sourceLabel(sync.provider)}>
                  {syncText}
                </Link>
              </>
            )}
          </div>

          {(isCash || isRetirement) && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-medium">
                  {isRetirement ? "Balance" : "Cash on hand"}
                  {isRetirement && <span className="ml-2 text-xs font-normal text-fg-3">counts toward net worth, not cash on hand</span>}
                </div>
                <div className="text-right">
                  <span className="text-lg font-semibold">{latest ? <Money value={latest.balance} kind="neutral" /> : "—"}</span>
                  {latest && <span className="ml-2 text-xs text-fg-3">as of {formatDate(latest.asOf)}</span>}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end">
                <Field label="Balance" htmlFor={`${id}-bal`}>
                  <Input id={`${id}-bal`} money value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="As of" htmlFor={`${id}-asof`}>
                  <Input id={`${id}-asof`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                </Field>
                <Field label="Note" htmlFor={`${id}-note`}>
                  <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </Field>
                {recordBtn}
              </div>

              {balances.length > 0 && (
                <History count={balances.length}>
                  <table className="w-full text-sm">
                    <tbody>
                      {balances.map((b) => (
                        <tr key={b.id} className="border-t border-line">
                          <td className="py-1.5 tabular-nums">{formatDate(b.asOf)}</td>
                          <td className="py-1.5 text-right font-medium">
                            <Money value={b.balance} kind="neutral" />
                          </td>
                          <td className="max-w-48 truncate py-1.5 pl-3 text-fg-3">{b.note ?? ""}</td>
                          <td className="py-1 text-right">
                            <DeleteBtn id={b.id} start={start} />
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
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="text-sm font-medium">{isCredit ? "Credit standing" : "Loan standing"}</div>
                <div className="text-right">
                  <div className="text-lg font-semibold">
                    {curBalance != null ? <Money value={curBalance} kind="owed" /> : "—"}
                    <span className="ml-2 text-xs font-normal text-fg-3">
                      owed
                      {isCredit && curLimit != null ? ` of ${formatMoney(curLimit)} limit` : ""}
                      {!isCredit && original != null ? ` of ${formatMoney(original)} original` : ""}
                      {latest && ` · as of ${formatDate(latest.asOf)}`}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap justify-end gap-x-3 text-xs text-fg-3">
                    {available != null && <span>{formatMoney(available)} available</span>}
                    {utilization != null && <span>{utilization.toFixed(0)}% utilized</span>}
                    {progress && <span>{progress.pct.toFixed(0)}% paid off</span>}
                    {curMin != null && <span>Min {formatMoney(curMin)}/mo</span>}
                    {mInt != null && mInt > 0 && <span className="text-warn">{formatMoney(mInt)}/mo interest</span>}
                  </div>
                </div>
              </div>

              {/* Utilization (cards) / payoff (loans) bar */}
              {isCredit && utilization != null ? (
                <ProgressBar
                  value={Math.max(2, utilization)}
                  max={100}
                  label="Credit utilization"
                  color={utilization >= 80 ? "var(--mp-danger)" : utilization >= 50 ? "var(--mp-warn)" : "var(--mp-money-income)"}
                />
              ) : progress ? (
                <ProgressBar value={Math.max(2, progress.pct)} max={100} label="Paid off" color="var(--mp-money-income)" />
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Balance owed" htmlFor={`${id}-bal`}>
                  <Input id={`${id}-bal`} money value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0.00" />
                </Field>
                {isCredit && (
                  <Field label="Credit limit" htmlFor={`${id}-lim`}>
                    <Input id={`${id}-lim`} money value={lim} onChange={(e) => setLim(e.target.value)} placeholder="Limit" />
                  </Field>
                )}
                <Field label="APR %" htmlFor={`${id}-apr`}>
                  <Input id={`${id}-apr`} inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="APR" />
                </Field>
                <Field label="Min payment" htmlFor={`${id}-min`}>
                  <Input id={`${id}-min`} money value={minPay} onChange={(e) => setMinPay(e.target.value)} placeholder="Min" />
                </Field>
                <Field label="As of" htmlFor={`${id}-asof`}>
                  <Input id={`${id}-asof`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                </Field>
                <Field label="Note" htmlFor={`${id}-note`} className="col-span-2 sm:col-span-2">
                  <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </Field>
                <div className="col-span-2 flex items-end sm:col-span-1">{recordBtn}</div>
              </div>

              {/* Loan-only static fact: original principal drives payoff progress */}
              {!isCredit && (
                <Field label="Original principal" htmlFor={`${id}-orig`} className="max-w-48">
                  <Input
                    id={`${id}-orig`}
                    money
                    defaultValue={account.originalPrincipal ?? ""}
                    placeholder="e.g. 12000"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if ((account.originalPrincipal ?? "") !== v) save({ originalPrincipal: v === "" ? null : num(v) });
                    }}
                  />
                </Field>
              )}

              {balances.length > 0 && (
                <History count={balances.length}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-fg-3">
                        <th className="py-1 font-medium">Date</th>
                        <th className="py-1 text-right font-medium">Owed</th>
                        {isCredit && <th className="py-1 pl-3 text-right font-medium">Limit</th>}
                        <th className="py-1 pl-3 text-right font-medium">APR</th>
                        <th className="py-1 pl-3 text-right font-medium">Min</th>
                        <th className="py-1 pl-3 font-medium">Note</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {balances.map((b) => (
                        <tr key={b.id} className="border-t border-line">
                          <td className="py-1.5 tabular-nums">{formatDate(b.asOf)}</td>
                          <td className="py-1.5 text-right font-medium">
                            <Money value={b.balance} kind="owed" />
                          </td>
                          {isCredit && (
                            <td className="py-1.5 pl-3 text-right tabular-nums text-fg-3">
                              {b.creditLimit != null ? formatMoney(b.creditLimit) : "—"}
                            </td>
                          )}
                          <td className="py-1.5 pl-3 text-right tabular-nums text-fg-3">{b.apr != null ? `${b.apr}%` : "—"}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums text-fg-3">
                            {b.minPayment != null ? formatMoney(b.minPayment) : "—"}
                          </td>
                          <td className="max-w-40 truncate py-1.5 pl-3 text-fg-3">{b.note ?? ""}</td>
                          <td className="py-1 text-right">
                            <DeleteBtn id={b.id} start={start} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </History>
              )}
            </div>
          )}

          {!isCash && !isLiability && !isRetirement && (
            <p className="text-xs text-fg-3">
              Set the type to Checking, Savings, Cash or Retirement to track its balance here, or Credit or Loan to move it to Debts.
            </p>
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
      <summary className="flex cursor-pointer select-none items-center gap-1 text-xs text-fg-3 hover:text-fg">
        <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
        History ({count} recorded)
      </summary>
      <div className="mt-2 max-h-48 overflow-x-auto overflow-y-auto">{children}</div>
    </details>
  );
}

function DeleteBtn({
  id,
  start,
}: {
  id: number;
  start: (cb: () => Promise<void>) => void;
}) {
  return (
    <IconButton
      icon="trash-2"
      size="sm"
      label="Delete this balance"
      onClick={() =>
        start(async () => {
          await deleteAccountBalance(id);
        })
      }
    />
  );
}

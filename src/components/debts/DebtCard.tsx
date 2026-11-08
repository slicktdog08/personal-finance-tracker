"use client";

import { useState, useTransition } from "react";
import { toNum } from "@/server/lib/money";
import { formatDate, shortMonthLabel } from "@/server/lib/period";
import { monthlyInterest, annualInterest, payoffProgress } from "@/server/lib/debt";
import { ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, SNOWBALL_MIN_APR } from "@/constants/enums";
import { addAccountBalance, deleteAccountBalance, updateAccount } from "@/server/actions/accounts";
import { Badge, Button, Card, DataTable, Field, Icon, IconButton, Input, Money, ProgressBar, Select, StatTile, cx } from "@/components/ds";
import { Sheet } from "@/components/ui/Sheet";

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

/** Where this debt sits in the payoff order (computed on the server from the chosen strategy). */
export interface DebtRank {
  /** 1-based position among the high-interest debts; null = parked at its minimum (or paid off). */
  rank: number | null;
  /** The debt the extra lands on (this month's budget target, else rank 1). */
  isTarget: boolean;
  /** YYYY-MM the projection pays it off, if it does. */
  paidOffOn: string | null;
}

const num = (s: string) => {
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};
const todayLocal = () => new Date().toISOString().slice(0, 10);

export function DebtCard({
  debt,
  ledger,
  payments,
  txnCount,
  lastTxn,
  order = { rank: null, isTarget: false, paidOffOn: null },
}: {
  debt: DebtInfo;
  ledger: DebtLedgerRow[];
  payments: { count: number; total: number } | null;
  txnCount: number;
  lastTxn: string | null;
  order?: DebtRank;
}) {
  const [pending, start] = useTransition();
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isCredit = CREDIT_ACCOUNT_TYPES.includes(debt.accountType);
  const curBalance = toNum(debt.balance);
  const curApr = toNum(debt.apr);
  const curLimit = toNum(debt.creditLimit);
  const original = toNum(debt.originalPrincipal);
  const curMin = toNum(debt.minPayment);
  const mInt = monthlyInterest(curBalance, curApr);
  const yInt = annualInterest(curBalance, curApr);
  const progress = payoffProgress(original, curBalance);
  const available = isCredit && curBalance != null && curLimit != null ? curLimit - curBalance : null;
  const utilization = isCredit && curBalance != null && curLimit != null && curLimit > 0 ? (curBalance / curLimit) * 100 : null;
  const paidOff = curBalance != null && curBalance <= 0;
  const parked = !paidOff && curBalance != null && order.rank == null;
  const name = debt.label || `••${debt.accountNumber}`;

  // History rows with the change from the snapshot before each one (ledger is newest first).
  const rows = ledger.map((r, i) => {
    const prev = ledger[i + 1];
    const change = prev ? Number(r.balance) - Number(prev.balance) : null;
    return { ...r, change };
  });

  const sub = [debt.institution, debt.accountType].filter(Boolean).join(" · ");
  const status = paidOff ? null : parked ? `stays on minimum (under ${SNOWBALL_MIN_APR}% APR)` : order.isTarget ? "getting the extra" : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cx(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
              order.isTarget ? "bg-accent text-accent-ink" : paidOff ? "bg-accent-soft text-accent-text" : "bg-sunken text-fg-2",
            )}
            aria-label={paidOff ? "Paid off" : order.rank != null ? `Payoff order ${order.rank}` : "Not in payoff order"}
          >
            {paidOff ? <Icon name="check" size={14} /> : (order.rank ?? "–")}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{name}</span>
              {paidOff && <Badge label="Paid off" color="var(--mp-money-income)" icon="check" size="sm" />}
            </div>
            <div className="text-xs text-fg-3">
              {sub}
              {sub && " · "}
              <span className="font-mono">··{debt.accountNumber}</span>
              {status && ` · ${status}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" icon="pencil-line" onClick={() => setRecording(true)}>
            Record balance
          </Button>
          <IconButton size="sm" icon="settings" label="Edit details" onClick={() => setEditing(true)} />
          <IconButton size="sm" icon={expanded ? "chevron-up" : "chevron-down"} label={expanded ? "Hide history" : "Show history"} aria-expanded={expanded} onClick={() => setExpanded((x) => !x)} />
        </div>
      </div>

      <div className="mp-grid mp-grid--keep2 mt-4" style={{ "--cols": 4, gap: 14 } as React.CSSProperties}>
        <StatTile label="Owed" value={curBalance != null ? curBalance : "—"} kind="owed" sub={debt.asOf ? `as of ${formatDate(debt.asOf)}` : "no balance recorded"} />
        <StatTile size="sm" label="APR" value={curApr != null ? `${curApr.toFixed(2)}%` : "—"} />
        <StatTile size="sm" label="Interest / mo" value={mInt != null ? mInt : "—"} sub={yInt != null ? <><Money value={yInt} kind="neutral" /> / yr</> : undefined} />
        <StatTile size="sm" label="Min payment" value={curMin != null ? curMin : "—"} sub={order.paidOffOn ? `Paid off ${shortMonthLabel(order.paidOffOn)}` : undefined} />
      </div>

      {/* Utilization for cards (fills toward rose as you use more), payoff for loans. */}
      {isCredit && utilization != null && curLimit != null ? (
        <ProgressBar
          className="mt-3.5"
          value={Math.max(0, curBalance ?? 0)}
          max={curLimit}
          color={utilization > 90 ? "var(--mp-money-over)" : "var(--mp-money-owed)"}
          label="Credit limit used"
          legendLeft={
            <>
              {Math.round(utilization)}% of <Money value={curLimit} kind="neutral" whole /> limit used
            </>
          }
          legendRight={
            available != null && (
              <>
                <Money value={available} kind="neutral" /> available
              </>
            )
          }
        />
      ) : progress && original != null ? (
        <ProgressBar
          className="mt-3.5"
          value={Math.max(0, original - (curBalance ?? original))}
          max={original}
          color="var(--mp-money-income)"
          label="Paid off"
          legendLeft={`${progress.pct.toFixed(0)}% paid off`}
          legendRight={
            <>
              of <Money value={original} kind="neutral" whole /> {isCredit ? "starting balance" : "original"}
            </>
          }
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-3">
        <span>
          {txnCount} transaction{txnCount === 1 ? "" : "s"} · {lastTxn ? `last ${formatDate(lastTxn)}` : "no transactions"}
        </span>
        {payments && payments.count > 0 && (
          <span title="Transactions linked to this account's bill">
            <Money value={payments.total} kind="neutral" /> paid
          </span>
        )}
        {isCredit && progress && original != null && (
          <span>
            {progress.pct.toFixed(0)}% paid off of <Money value={original} kind="neutral" whole /> starting balance
          </span>
        )}
        {debt.openedOn && <span>Opened {formatDate(debt.openedOn)}</span>}
      </div>

      {expanded && (
        <div className="mt-3.5 border-t border-line pt-1">
          <DataTable
            dense
            rows={rows}
            empty={<p className="px-1 py-3 text-sm text-fg-3">No balances recorded yet. Record one to start the history.</p>}
            columns={[
              { key: "asOf", header: "Date", render: (r) => formatDate(r.asOf) },
              { key: "balance", header: "Balance", num: true, render: (r) => <Money value={r.balance} kind="owed" /> },
              {
                key: "change",
                header: "Change",
                num: true,
                render: (r) => (r.change ? <Money value={r.change} kind={r.change < 0 ? "income" : "over"} sign="always" /> : <span className="text-fg-3">—</span>),
              },
              ...(isCredit ? [{ key: "creditLimit", header: "Limit", num: true, render: (r: (typeof rows)[number]) => (r.creditLimit != null ? <Money value={r.creditLimit} kind="neutral" /> : "—") }] : []),
              { key: "apr", header: "APR", num: true, render: (r) => (r.apr != null ? `${r.apr}%` : "—") },
              { key: "minPayment", header: "Min", num: true, render: (r) => (r.minPayment != null ? <Money value={r.minPayment} kind="neutral" /> : "—") },
              { key: "note", header: "Note", render: (r) => <span className="text-fg-3">{r.note || "—"}</span> },
              {
                key: "del",
                header: "",
                shrink: true,
                render: (r) => <IconButton size="sm" icon="trash-2" label="Delete this balance" disabled={pending} onClick={() => start(async () => { await deleteAccountBalance(r.id); })} />,
              },
            ]}
            mobile={{
              title: (r) => formatDate(r.asOf),
              sub: (r) => [r.apr != null ? `${r.apr}% APR` : null, r.note].filter(Boolean).join(" · ") || null,
              amount: (r) => <Money value={r.balance} kind="owed" />,
              meta: (r) => (
                <span className="inline-flex items-center gap-1">
                  {r.change ? <Money value={r.change} kind={r.change < 0 ? "income" : "over"} sign="always" /> : null}
                  <IconButton size="sm" icon="trash-2" label="Delete this balance" disabled={pending} onClick={() => start(async () => { await deleteAccountBalance(r.id); })} />
                </span>
              ),
            }}
          />
        </div>
      )}

      {recording && <RecordSheet debt={debt} ledger={ledger} isCredit={isCredit} onClose={() => setRecording(false)} />}
      {editing && <EditSheet debt={debt} onClose={() => setEditing(false)} />}
    </Card>
  );
}

/** Record a new balance snapshot. APR / min / limit pre-fill from the freshest known values. */
function RecordSheet({ debt, ledger, isCredit, onClose }: { debt: DebtInfo; ledger: DebtLedgerRow[]; isCredit: boolean; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [bal, setBal] = useState("");
  const [asOf, setAsOf] = useState(todayLocal);
  const [note, setNote] = useState("");
  const [apr, setApr] = useState(ledger.find((r) => r.apr != null)?.apr ?? "");
  const [minPay, setMinPay] = useState(ledger.find((r) => r.minPayment != null)?.minPayment ?? "");
  const [lim, setLim] = useState(ledger.find((r) => r.creditLimit != null)?.creditLimit ?? "");
  const n = num(bal);
  const save = () => {
    if (n == null || !asOf) return;
    start(async () => {
      await addAccountBalance(debt.id, n, asOf, note || null, isCredit ? num(lim) : null, num(apr), num(minPay));
      onClose();
    });
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Record balance"
      footer={
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending} disabled={n == null || !asOf}>
            Save balance
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-fg-3">
        {debt.label || "Account"} <span className="font-mono">··{debt.accountNumber}</span>
      </p>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Balance owed">
          <Input money autoFocus value={bal} onChange={(e) => setBal(e.target.value)} placeholder={debt.balance ?? "0.00"} />
        </Field>
        <Field label="As of">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        {isCredit && (
          <Field label="Credit limit">
            <Input money value={lim} onChange={(e) => setLim(e.target.value)} placeholder="Limit" />
          </Field>
        )}
        <Field label="APR %">
          <Input money value={apr} onChange={(e) => setApr(e.target.value)} placeholder="APR" />
        </Field>
        <Field label="Min payment">
          <Input money value={minPay} onChange={(e) => setMinPay(e.target.value)} placeholder="Min" />
        </Field>
        <Field label="Note" className="col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** The card/loan's identity and static facts — this is the account's only edit surface. */
function EditSheet({ debt, onClose }: { debt: DebtInfo; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(debt.label ?? "");
  const [institution, setInstitution] = useState(debt.institution ?? "");
  const [type, setType] = useState(debt.accountType);
  const [principal, setPrincipal] = useState(debt.originalPrincipal ?? "");
  const [opened, setOpened] = useState(debt.openedOn ?? "");
  const credit = CREDIT_ACCOUNT_TYPES.includes(type);
  const save = () =>
    start(async () => {
      const patch: Parameters<typeof updateAccount>[1] = {};
      if (label !== (debt.label ?? "")) patch.label = label;
      if (institution !== (debt.institution ?? "")) patch.institution = institution;
      if (type !== debt.accountType) patch.accountType = type;
      if (principal.trim() !== (debt.originalPrincipal ?? "")) patch.originalPrincipal = principal.trim() === "" ? null : num(principal);
      if (opened !== (debt.openedOn ?? "")) patch.openedOn = opened || null;
      if (Object.keys(patch).length) await updateAccount(debt.id, patch);
      onClose();
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit debt"
      footer={
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            Save changes
          </Button>
        </div>
      }
    >
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" className="col-span-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Example Card" />
        </Field>
        <Field label="Institution">
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Chase" />
        </Field>
        <Field label="Type" hint={type !== "Credit" && type !== "Loan" ? "Moves this to Accounts." : undefined}>
          <Select value={type} onChange={(e) => setType(e.target.value)} options={[...ACCOUNT_TYPES]} />
        </Field>
        <Field label={credit ? "Starting balance" : "Original principal"}>
          <Input money value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="12000" />
        </Field>
        <Field label="Opened">
          <Input type="date" value={opened} onChange={(e) => setOpened(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

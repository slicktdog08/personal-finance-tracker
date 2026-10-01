"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseMoney, formatMoney, toNum } from "@/server/lib/money";
import { ColorSelect } from "@/components/ColorSelect";
import { Sheet } from "@/components/ui/Sheet";
import { badgeStyle } from "@/lib/colors";
import type { InstancePatch } from "@/server/lib/bill-types";
import {
  updateInstance,
  deleteInstance,
  applyDueDayForward,
  addInstanceNamed,
  bulkSetStatus,
} from "@/server/actions/bills";
import { updateStatusColor, updatePaymentTypeColor } from "@/server/actions/config";

export interface SheetRow {
  id: number;
  billId: number | null;
  name: string;
  amount: string | null;
  status: string;
  dueDay: number | null;
  paymentType: string | null;
  isDebt: boolean;
  isCancel: boolean;
}
interface ColorItem {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
}
type SortKey = "order" | "name" | "amount" | "due" | "status";

export function BillSheet({
  periodId,
  path,
  rows,
  statuses,
  payments,
  billNames,
}: {
  periodId: number;
  path: string;
  rows: SheetRow[];
  statuses: { id: number; name: string; color: string; emoji: string | null; isSettled: boolean }[];
  payments: ColorItem[];
  billNames: { id: number; name: string }[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const [fStatus, setFStatus] = useState("");
  const [fPayment, setFPayment] = useState("");
  const [fDebt, setFDebt] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [newName, setNewName] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  // Mobile cards: id of the bill whose editor sheet is open.
  const [editing, setEditing] = useState<number | null>(null);

  const statusOrder = useMemo(() => new Map(statuses.map((s, i) => [s.name, i])), [statuses]);

  const save = (id: number, patch: InstancePatch) =>
    start(async () => {
      await updateInstance(id, patch, path);
      router.refresh();
    });

  const changeStatusColor = (id: number, color: string) =>
    start(async () => {
      await updateStatusColor(id, color);
      router.refresh();
    });
  const changePaymentColor = (id: number, color: string) =>
    start(async () => {
      await updatePaymentTypeColor(id, color);
      router.refresh();
    });

  const visible = useMemo(() => {
    let list = rows.filter((r) => {
      if (fStatus && r.status !== fStatus) return false;
      if (fPayment && (r.paymentType ?? "") !== fPayment) return false;
      if (fDebt === "debt" && !r.isDebt) return false;
      if (fDebt === "nondebt" && r.isDebt) return false;
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "amount":
          return ((toNum(a.amount) ?? 0) - (toNum(b.amount) ?? 0)) * dir;
        case "due":
          return ((a.dueDay ?? 99) - (b.dueDay ?? 99)) * dir;
        case "status":
          return ((statusOrder.get(a.status) ?? 99) - (statusOrder.get(b.status) ?? 99)) * dir;
        default:
          return (a.id - b.id) * dir;
      }
    });
    return list;
  }, [rows, fStatus, fPayment, fDebt, q, sortKey, sortDir, statusOrder]);

  const total = visible.reduce((s, r) => s + (toNum(r.amount) ?? 0), 0);
  const debtTotal = visible.reduce((s, r) => s + (r.isDebt ? toNum(r.amount) ?? 0 : 0), 0);

  function addBill() {
    const name = newName.trim();
    if (!name) return;
    start(async () => {
      await addInstanceNamed(periodId, name, path);
      setNewName("");
      router.refresh();
    });
  }

  // Selection is over the currently-visible (filtered) rows.
  const allSelected = visible.length > 0 && visible.every((r) => sel.has(r.id));
  const toggleAll = () =>
    setSel(allSelected ? new Set() : new Set(visible.map((r) => r.id)));
  const toggle = (id: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function applyBulkStatus() {
    if (!sel.size || !bulkStatus) return;
    const ids = [...sel];
    start(async () => {
      await bulkSetStatus(ids, bulkStatus, path);
      setSel(new Set());
      setBulkStatus("");
      router.refresh();
    });
  }

  const selectCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";
  const fieldCls =
    "w-full border rounded px-2 py-1.5 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  const editRow = editing != null ? (rows.find((r) => r.id === editing) ?? null) : null;
  // Latch the last-open row so the editor Sheet keeps its content while the
  // exit animation plays after editing is cleared.
  const [shownRow, setShownRow] = useState(editRow);
  if (editRow && editRow !== shownRow) setShownRow(editRow);

  return (
    <div className="space-y-3">
      {/* Filter / sort bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.name} value={s.name}>
              {s.emoji ? `${s.emoji} ` : ""}
              {s.name}
            </option>
          ))}
        </select>
        <select value={fPayment} onChange={(e) => setFPayment(e.target.value)} className={selectCls}>
          <option value="">All payments</option>
          {payments.map((p) => (
            <option key={p.name} value={p.name}>
              {p.emoji ? `${p.emoji} ` : ""}
              {p.name}
            </option>
          ))}
        </select>
        <select value={fDebt} onChange={(e) => setFDebt(e.target.value)} className={selectCls}>
          <option value="">All</option>
          <option value="debt">Debt only</option>
          <option value="nondebt">Non-debt</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search name…"
          className={selectCls}
        />
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className={selectCls}
          >
            <option value="order">Sort: default</option>
            <option value="name">Sort: name</option>
            <option value="amount">Sort: amount</option>
            <option value="due">Sort: due day</option>
            <option value="status">Sort: status</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-sm"
            title="Toggle sort direction"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      <div className="text-sm text-neutral-500">
        {visible.length} of {rows.length} bills · total{" "}
        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
          {formatMoney(total)}
        </span>{" "}
        · debt {formatMoney(debtTotal)}
      </div>

      {/* Bulk status bar — appears when one or more bills are selected */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-2">
          <span className="text-sm font-medium">{sel.size} selected</span>
          <span className="text-sm text-neutral-500">Set status:</span>
          <ColorSelect
            value={bulkStatus}
            options={statuses}
            placeholder="— status —"
            onSelect={setBulkStatus}
          />
          <button
            onClick={applyBulkStatus}
            disabled={pending || !bulkStatus}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Apply to {sel.size}
          </button>
          <button
            onClick={() => setSel(new Set())}
            className="text-sm text-neutral-500 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="hidden md:block overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium text-center">Debt</th>
              <th className="px-3 py-2 font-medium text-center">Cancel</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-neutral-200 dark:border-neutral-800 ${
                  sel.has(r.id) ? "bg-blue-50 dark:bg-blue-950/20" : ""
                }`}
              >
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={sel.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.name}`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      defaultValue={r.name}
                      onBlur={(e) =>
                        e.target.value !== r.name && save(r.id, { name: e.target.value })
                      }
                      className="w-40 bg-transparent border border-transparent hover:border-neutral-300 focus:border-blue-400 rounded px-1.5 py-0.5"
                    />
                    {r.billId ? (
                      <Link
                        href={`/settings/bills/${r.billId}`}
                        title="Bill history & stats"
                        className="text-neutral-400 hover:text-blue-600 text-sm"
                      >
                        ⓘ
                      </Link>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    defaultValue={r.amount ?? ""}
                    inputMode="decimal"
                    onBlur={(e) => {
                      const v = parseMoney(e.target.value);
                      if (v !== toNum(r.amount)) save(r.id, { amount: v });
                    }}
                    className="w-24 text-right bg-transparent border border-transparent hover:border-neutral-300 focus:border-blue-400 rounded px-1.5 py-0.5 tabular-nums"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <ColorSelect
                    value={r.status}
                    options={statuses}
                    onSelect={(name) => save(r.id, { status: name })}
                    onColorChange={changeStatusColor}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={r.dueDay ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== r.dueDay) save(r.id, { dueDay: v });
                    }}
                    className="w-14 bg-transparent border border-transparent hover:border-neutral-300 focus:border-blue-400 rounded px-1.5 py-0.5"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <ColorSelect
                    value={r.paymentType ?? ""}
                    options={payments}
                    allowEmpty
                    onSelect={(name) => save(r.id, { paymentType: name || null })}
                    onColorChange={changePaymentColor}
                  />
                </td>
                <td className="px-3 py-1.5 text-center">
                  <input
                    type="checkbox"
                    defaultChecked={r.isDebt}
                    onChange={(e) => save(r.id, { isDebt: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-1.5 text-center">
                  <input
                    type="checkbox"
                    defaultChecked={r.isCancel}
                    onChange={(e) => save(r.id, { isCancel: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-right">
                  <button
                    title="Apply this due day to all later months"
                    onClick={() =>
                      start(async () => {
                        const n = await applyDueDayForward(r.id, path);
                        router.refresh();
                        alert(`Applied due day to ${n} later month(s).`);
                      })
                    }
                    disabled={r.dueDay == null || pending}
                    className="text-xs text-blue-600 hover:underline disabled:text-neutral-400 disabled:no-underline mr-3"
                  >
                    Apply fwd
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${r.name}"?`))
                        start(async () => {
                          await deleteInstance(r.id, path);
                          router.refresh();
                        });
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">
                  No bills match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: card per bill — status is one tap on the face, everything else
          edits in a bottom sheet. Same state and save handlers as the table. */}
      <ul className="md:hidden rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
        {visible.map((r) => {
          const payment = payments.find((p) => p.name === (r.paymentType ?? ""));
          return (
            <li
              key={r.id}
              className={`flex items-start gap-2.5 p-3 ${
                sel.has(r.id) ? "bg-blue-50 dark:bg-blue-950/20" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={sel.has(r.id)}
                onChange={() => toggle(r.id)}
                aria-label={`Select ${r.name}`}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-1.5">
                <button
                  type="button"
                  onClick={() => setEditing(r.id)}
                  title="Edit this bill"
                  className="w-full text-left flex items-baseline gap-2"
                >
                  <span className="flex-1 min-w-0 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {r.amount != null ? formatMoney(r.amount) : "—"}
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                  <ColorSelect
                    value={r.status}
                    options={statuses}
                    onSelect={(name) => save(r.id, { status: name })}
                    onColorChange={changeStatusColor}
                  />
                  {payment && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
                      style={badgeStyle(payment.color)}
                    >
                      {payment.emoji && <span aria-hidden>{payment.emoji}</span>}
                      {payment.name}
                    </span>
                  )}
                  <span>Due {r.dueDay ?? "—"}</span>
                  {r.isDebt && <span>debt</span>}
                  {r.isCancel && <span className="text-red-500">cancel</span>}
                </div>
              </div>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-6 text-center text-neutral-500">No bills match.</li>
        )}
      </ul>

      {shownRow && (
        <Sheet open={editRow != null} onClose={() => setEditing(null)} title={shownRow.name}>
          <div key={shownRow.id} className="space-y-3 text-left">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Name</span>
              <input
                defaultValue={shownRow.name}
                onBlur={(e) =>
                  e.target.value !== shownRow.name && save(shownRow.id, { name: e.target.value })
                }
                className={fieldCls}
              />
            </label>
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-xs text-neutral-500">Amount</span>
                <input
                  defaultValue={shownRow.amount ?? ""}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const v = parseMoney(e.target.value);
                    if (v !== toNum(shownRow.amount)) save(shownRow.id, { amount: v });
                  }}
                  className={fieldCls + " text-right tabular-nums"}
                />
              </label>
              <label className="flex flex-col gap-1 w-24">
                <span className="text-xs text-neutral-500">Due day</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={shownRow.dueDay ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    if (v !== shownRow.dueDay) save(shownRow.id, { dueDay: v });
                  }}
                  className={fieldCls}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Status</span>
              <ColorSelect
                value={shownRow.status}
                options={statuses}
                onSelect={(name) => save(shownRow.id, { status: name })}
                onColorChange={changeStatusColor}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Payment</span>
              <ColorSelect
                value={shownRow.paymentType ?? ""}
                options={payments}
                allowEmpty
                onSelect={(name) => save(shownRow.id, { paymentType: name || null })}
                onColorChange={changePaymentColor}
              />
            </div>
            <div className="flex items-center gap-5 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  defaultChecked={shownRow.isDebt}
                  onChange={(e) => save(shownRow.id, { isDebt: e.target.checked })}
                  className="h-4 w-4"
                />
                Debt
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  defaultChecked={shownRow.isCancel}
                  onChange={(e) => save(shownRow.id, { isCancel: e.target.checked })}
                  className="h-4 w-4"
                />
                Cancel
              </label>
              {shownRow.billId ? (
                <Link
                  href={`/settings/bills/${shownRow.billId}`}
                  className="ml-auto text-sm text-blue-600 hover:underline"
                >
                  History →
                </Link>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <button
                title="Apply this due day to all later months"
                onClick={() =>
                  start(async () => {
                    const n = await applyDueDayForward(shownRow.id, path);
                    router.refresh();
                    alert(`Applied due day to ${n} later month(s).`);
                  })
                }
                disabled={shownRow.dueDay == null || pending}
                className="px-2 py-2 text-sm text-blue-600 hover:underline disabled:text-neutral-400 disabled:no-underline"
              >
                Apply due day fwd
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${shownRow.name}"?`))
                    start(async () => {
                      await deleteInstance(shownRow.id, path);
                      setEditing(null);
                      router.refresh();
                    });
                }}
                className="px-2 py-2 text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
            {pending && <span className="text-xs text-neutral-400">Saving…</span>}
          </div>
        </Sheet>
      )}

      {/* Smart add: reuses an existing bill definition when the name matches */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          list="bill-names"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addBill()}
          placeholder="Add bill (type to reuse an existing one)…"
          className={selectCls + " w-full sm:w-72"}
        />
        <datalist id="bill-names">
          {billNames.map((b) => (
            <option key={b.id} value={b.name} />
          ))}
        </datalist>
        <button
          onClick={addBill}
          disabled={pending || !newName.trim()}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          + Add bill
        </button>
        {pending && <span className="text-xs text-neutral-400">Saving…</span>}
      </div>
    </div>
  );
}

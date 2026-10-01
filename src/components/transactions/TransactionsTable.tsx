"use client";

import { Fragment, useState, useTransition, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CategoryCell } from "@/components/transactions/CategoryCell";
import { ConvertToBill, type BillOption } from "@/components/transactions/ConvertToBill";
import {
  EditTransaction,
  type EditAccountOption,
} from "@/components/transactions/EditTransaction";
import { NoteCell } from "@/components/transactions/NoteCell";
import { ColorSelect } from "@/components/ColorSelect";
import { CashOffsetDetail } from "@/components/transactions/CashOffsetDetail";
import { SplitTransaction, SplitSummary } from "@/components/transactions/SplitTransaction";
import { TrashIcon } from "@/components/icons";
import { CASH_SOURCE_CATEGORY, WALLET_ACCOUNT_TYPES } from "@/constants/enums";
import { formatMoney } from "@/server/lib/money";
import { cashPortionOf } from "@/server/lib/cash";
import { formatDate } from "@/server/lib/period";
import { bulkSetCategory } from "@/server/actions/categorize";
import { deleteTransaction } from "@/server/actions/transactions";
import type { CategoryOption, SplitPiece } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";
import { MarkPostedButton, SourceGlyph } from "./StatusBadge";

export interface TxRow {
  id: number;
  txnDate: string;
  description: string;
  notes: string | null;
  category: string | null;
  /** The saved rule that set `category`, when it was auto-categorized. */
  categoryRuleId?: number | null;
  amount: string | null;
  direction: string;
  accountNumber: string | null;
  accountLabel: string | null;
  billId: number | null;
  accountType?: string | null;
  /** Cash bookkeeping: how much of this withdrawal has been tied to purchases. */
  allocated?: string | null;
  /** Cash bookkeeping: how much of this wallet purchase has been funded by a withdrawal. */
  covered?: string | null;
  /** Entered by hand before the bank posted it. */
  pending?: boolean;
  /** Parts filed under other categories; `category` keeps the rest. */
  splits?: SplitPiece[];
  /** Where the row came from: import | pdf | manual | <provider id>. */
  source?: string | null;
}

// Marks a row entered before the bank posted it; the pending tray above the table offers to
// merge it with the statement row once that arrives.
function PendingBadge() {
  return (
    <span
      title="Pending — entered before the bank posted it. Merge it with the posted row from the pending tray once it's imported."
      className="shrink-0 inline-flex px-1.5 py-px rounded-full border text-[10px] font-medium uppercase tracking-wide bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
    >
      Pending
    </span>
  );
}

// The cash in a row: all of an ATM withdrawal, or the part split off as Cash (cash back).
const cashIn = (t: TxRow) =>
  cashPortionOf(
    { category: t.category, amount: num(t.amount) },
    (t.splits ?? []).map((p) => ({ category: p.category, amount: num(p.amount) })),
    CASH_SOURCE_CATEGORY,
  );

// Cash pulled out of the bank: expandable, because what it bought is recorded separately and
// only the part that was never explained counts as spending. Cash back split off a purchase
// counts too — it's the same kind of money.
const isCashSource = (t: TxRow) =>
  t.direction === "Debit" &&
  !WALLET_ACCOUNT_TYPES.includes(t.accountType ?? "") &&
  cashIn(t) > 0;

// Money spent out of the wallet — the other side of the same coin.
const num = (v: string | null | undefined) => (v == null ? 0 : Number(v) || 0);

const isWalletSpend = (t: TxRow) =>
  t.direction === "Debit" && WALLET_ACCOUNT_TYPES.includes(t.accountType ?? "");



const PAGE_SIZES = [25, 50, 100, 200, 500];

export function TransactionsTable({
  rows,
  categoryOptions,
  accounts,
  bills,
  rules = [],
  page,
  pages,
  pageSize,
  sort,
  dir,
}: {
  rows: TxRow[];
  categoryOptions: CategoryOption[];
  accounts: EditAccountOption[];
  bills: BillOption[];
  /** Saved categorization rules, for the "set by rule" chip on each row. */
  rules?: CategoryRule[];
  page: number;
  pages: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<number>>(new Set());
  // Withdrawal rows whose cash detail is open. Ids, not indexes — the list re-sorts.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState("");

  const nav = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`/transactions?${next.toString()}`);
  };

  const sortBy = (col: string) => {
    const nextDir = sort === col && dir === "asc" ? "desc" : "asc";
    nav({ sort: col, dir: nextDir, page: "1" });
  };

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () =>
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function applyBulk() {
    if (!sel.size) return;
    const ids = [...sel];
    start(async () => {
      await bulkSetCategory(ids, bulkCat || null);
      setSel(new Set());
      setBulkCat("");
      router.refresh();
    });
  }

  function del(t: TxRow) {
    if (!confirm(`Delete this transaction?\n\n${formatDate(t.txnDate)} · ${t.description}`)) return;
    start(async () => {
      await deleteTransaction(t.id, "/transactions");
      setSel((prev) => {
        if (!prev.has(t.id)) return prev;
        const n = new Set(prev);
        n.delete(t.id);
        return n;
      });
      router.refresh();
    });
  }

  const arrow = (col: string) => (sort === col ? (dir === "asc" ? " ▲" : " ▼") : "");
  const th = "px-3 py-2 font-medium cursor-pointer select-none hover:text-blue-600";

  const selectCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  const deleteBtn =
    "inline-flex items-center justify-center rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950/40";

  const sizeSelect = useMemo(
    () => (
      <select
        value={pageSize}
        onChange={(e) => nav({ size: e.target.value, page: "1" })}
        className={selectCls}
      >
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}/page
          </option>
        ))}
      </select>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageSize, params],
  );

  return (
    <div className="space-y-3">
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-2">
          <span className="text-sm font-medium">{sel.size} selected</span>
          <span className="text-sm text-neutral-500">Set category:</span>
          <ColorSelect
            value={bulkCat}
            options={categoryOptions}
            placeholder="— set category —"
            onSelect={setBulkCat}
          />
          <button
            onClick={applyBulk}
            disabled={pending || !bulkCat}
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
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className={th} onClick={() => sortBy("date")}>
                Date{arrow("date")}
              </th>
              <th className={th} onClick={() => sortBy("description")}>
                Description{arrow("description")}
              </th>
              <th className={th} onClick={() => sortBy("account")}>
                Account{arrow("account")}
              </th>
              <th className={th} onClick={() => sortBy("category")}>
                Category{arrow("category")}
              </th>
              <th className={th + " text-right"} onClick={() => sortBy("amount")}>
                Amount{arrow("amount")}
              </th>
              <th className={th} onClick={() => sortBy("direction")}>
                Type{arrow("direction")}
              </th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const cashSource = isCashSource(t);
              const walletSpend = isWalletSpend(t);
              const allocated = num(t.allocated);
              const covered = num(t.covered);
              const amount = num(t.amount);
              // A withdrawal's real cost is what was never accounted for; a wallet purchase
              // funded by one is already inside that withdrawal's amount, so it isn't
              // additional money out.
              // Cash back on a purchase only has its cash part to account for, not the whole row.
              const cash = cashSource ? cashIn(t) : amount;
              const unaccounted = Math.round((cash - allocated) * 100) / 100;
              const cashBack = cashSource && cash + 0.004 < amount;
              const open = expanded.has(t.id);
              return (
              <Fragment key={t.id}>
              <tr
                className={`border-t border-neutral-200 dark:border-neutral-800 ${
                  sel.has(t.id) ? "bg-blue-50 dark:bg-blue-950/20" : ""
                } ${t.pending ? "text-neutral-500 dark:text-neutral-400" : ""}`}
              >
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatDate(t.txnDate)}</td>
                <td className="px-3 py-1.5 max-w-md xl:max-w-xl align-top">
                  <div className="flex items-center gap-1.5">
                    {cashSource && (
                      <button
                        onClick={() => toggleExpanded(t.id)}
                        title={
                          allocated > 0
                            ? `${formatMoney(allocated)} of this cash is accounted for`
                            : "See what this cash paid for"
                        }
                        aria-expanded={open}
                        className="shrink-0 w-4 text-xs text-amber-600 hover:text-amber-700"
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    )}
                    <span className="truncate" title={t.description}>
                      {t.description}
                    </span>
                    {t.pending && <PendingBadge />}
                    <MarkPostedButton id={t.id} pending={t.pending} source={t.source} path="/transactions" />
                    <SourceGlyph source={t.source} />
                  </div>
                  <NoteCell id={t.id} value={t.notes} path="/transactions" />
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {t.accountLabel ?? t.accountNumber ?? "—"}
                </td>
                <td className="px-3 py-1.5">
                  <CategoryCell
                    id={t.id}
                    value={t.category}
                    options={categoryOptions}
                    path="/transactions"
                    description={t.description}
                    rules={rules}
                    categoryRuleId={t.categoryRuleId ?? null}
                  />
                  <SplitSummary
                    amount={t.amount}
                    splits={t.splits ?? []}
                    categoryOptions={categoryOptions}
                  />
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    t.direction === "Credit" ? "text-green-600 dark:text-green-400" : ""
                  }`}
                >
                  {t.direction === "Credit" ? "+" : "−"}
                  {formatMoney(t.amount)}
                  {cashSource && (allocated > 0 || cashBack) && (
                    <span
                      className="block text-[11px] font-normal text-neutral-500"
                      title="Cash still unaccounted for — it counts as spending until purchases are logged against it"
                    >
                      {formatMoney(unaccounted)} {cashBack ? "cash " : ""}unaccounted
                    </span>
                  )}
                  {walletSpend && covered > 0 && (
                    <span
                      className="block text-[11px] font-normal text-emerald-700 dark:text-emerald-400"
                      title="Paid from cash already withdrawn — counted here, not twice"
                    >
                      {covered + 0.004 >= amount
                        ? "from cash withdrawn"
                        : `${formatMoney(covered)} from cash withdrawn`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">{t.direction}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    <EditTransaction
                      txn={t}
                      accounts={accounts}
                      categoryOptions={categoryOptions}
                      path="/transactions"
                    />
                    <SplitTransaction
                      txn={t}
                      categoryOptions={categoryOptions}
                      path="/transactions"
                    />
                    <ConvertToBill
                      transactionId={t.id}
                      description={t.description}
                      billId={t.billId}
                      bills={bills}
                      path="/transactions"
                    />
                    <button
                      onClick={() => del(t)}
                      disabled={pending}
                      title="Delete transaction"
                      aria-label="Delete transaction"
                      className={deleteBtn}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
              {open && (
                <tr className="border-t border-amber-200 dark:border-amber-900">
                  <td />
                  <td colSpan={7} className="p-0">
                    <CashOffsetDetail withdrawalId={t.id} />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-500">
                  No transactions match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards instead of the 8-column table. Same state, second render. */}
      <div className="md:hidden space-y-2">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" />
            All
          </label>
          <select
            value={sort}
            onChange={(e) => nav({ sort: e.target.value, page: "1" })}
            className={selectCls + " ml-auto"}
            aria-label="Sort by"
          >
            <option value="date">Date</option>
            <option value="description">Description</option>
            <option value="account">Account</option>
            <option value="category">Category</option>
            <option value="amount">Amount</option>
            <option value="direction">Type</option>
          </select>
          <button
            onClick={() => nav({ dir: dir === "asc" ? "desc" : "asc", page: "1" })}
            aria-label={dir === "asc" ? "Sorted ascending" : "Sorted descending"}
            className="px-2.5 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm"
          >
            {dir === "asc" ? "▲" : "▼"}
          </button>
        </div>
        <ul className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((t) => {
            const cashSource = isCashSource(t);
            const walletSpend = isWalletSpend(t);
            const allocated = num(t.allocated);
            const covered = num(t.covered);
            const amount = num(t.amount);
            const cash = cashSource ? cashIn(t) : amount;
            const unaccounted = Math.round((cash - allocated) * 100) / 100;
            const cashBack = cashSource && cash + 0.004 < amount;
            const open = expanded.has(t.id);
            return (
              <li
                key={t.id}
                className={`p-3 space-y-1.5 ${sel.has(t.id) ? "bg-blue-50 dark:bg-blue-950/20" : ""} ${
                  t.pending ? "text-neutral-500 dark:text-neutral-400" : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={sel.has(t.id)}
                    onChange={() => toggle(t.id)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {cashSource && (
                        <button
                          onClick={() => toggleExpanded(t.id)}
                          title={
                            allocated > 0
                              ? `${formatMoney(allocated)} of this cash is accounted for`
                              : "See what this cash paid for"
                          }
                          aria-expanded={open}
                          className="shrink-0 w-5 py-0.5 text-xs text-amber-600 hover:text-amber-700"
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      )}
                      <span className="truncate font-medium" title={t.description}>
                        {t.description}
                      </span>
                      {t.pending && <PendingBadge />}
                      <MarkPostedButton id={t.id} pending={t.pending} source={t.source} path="/transactions" />
                      <SourceGlyph source={t.source} />
                    </div>
                    <div className="text-xs text-neutral-500 tabular-nums">
                      {formatDate(t.txnDate)} · {t.accountLabel ?? t.accountNumber ?? "no account"} ·{" "}
                      {t.direction}
                    </div>
                  </div>
                  <div
                    className={`shrink-0 text-right tabular-nums ${
                      t.direction === "Credit" ? "text-green-600 dark:text-green-400" : ""
                    }`}
                  >
                    {t.direction === "Credit" ? "+" : "−"}
                    {formatMoney(t.amount)}
                    {cashSource && (allocated > 0 || cashBack) && (
                      <span className="block text-[11px] font-normal text-neutral-500">
                        {formatMoney(unaccounted)} {cashBack ? "cash " : ""}unaccounted
                      </span>
                    )}
                    {walletSpend && covered > 0 && (
                      <span className="block text-[11px] font-normal text-emerald-700 dark:text-emerald-400">
                        {covered + 0.004 >= amount
                          ? "from cash withdrawn"
                          : `${formatMoney(covered)} from cash withdrawn`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="pl-7">
                  <NoteCell id={t.id} value={t.notes} path="/transactions" />
                </div>
                <div className="pl-7 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CategoryCell
                      id={t.id}
                      value={t.category}
                      options={categoryOptions}
                      path="/transactions"
                      description={t.description}
                      rules={rules}
                      categoryRuleId={t.categoryRuleId ?? null}
                    />
                    <SplitSummary
                      amount={t.amount}
                      splits={t.splits ?? []}
                      categoryOptions={categoryOptions}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <EditTransaction
                      txn={t}
                      accounts={accounts}
                      categoryOptions={categoryOptions}
                      path="/transactions"
                    />
                    <SplitTransaction
                      txn={t}
                      categoryOptions={categoryOptions}
                      path="/transactions"
                    />
                    <ConvertToBill
                      transactionId={t.id}
                      description={t.description}
                      billId={t.billId}
                      bills={bills}
                      path="/transactions"
                    />
                    <button
                      onClick={() => del(t)}
                      disabled={pending}
                      title="Delete transaction"
                      aria-label="Delete transaction"
                      className={deleteBtn}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="-mx-3 border-t border-amber-200 dark:border-amber-900">
                    <CashOffsetDetail withdrawalId={t.id} />
                  </div>
                )}
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-neutral-500">No transactions match.</li>
          )}
        </ul>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">{sizeSelect}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => nav({ page: "1" })}
            disabled={page <= 1}
            className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-40"
          >
            « First
          </button>
          <button
            onClick={() => nav({ page: String(page - 1) })}
            disabled={page <= 1}
            className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span className="text-sm text-neutral-500">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => nav({ page: String(page + 1) })}
            disabled={page >= pages}
            className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-40"
          >
            Next ›
          </button>
          <button
            onClick={() => nav({ page: String(pages) })}
            disabled={page >= pages}
            className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-40"
          >
            Last »
          </button>
        </div>
      </div>
    </div>
  );
}

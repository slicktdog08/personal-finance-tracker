"use client";

import { memo, useCallback, useRef, useState, useTransition } from "react";
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
import { Sheet } from "@/components/ui/Sheet";
import { memoDeep, useStable } from "@/components/ui/useStable";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Glyph,
  Icon,
  IconButton,
  Money,
  Select,
  buttonClass,
  cx,
} from "@/components/ds";
import { CASH_SOURCE_CATEGORY, WALLET_ACCOUNT_TYPES } from "@/constants/enums";
import { formatMoney } from "@/server/lib/money";
import { cashPortionOf } from "@/server/lib/cash";
import { formatDate } from "@/server/lib/period";
import { bulkSetCategory } from "@/server/actions/categorize";
import { deleteTransaction, setTransactionBill } from "@/server/actions/transactions";
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
  /** The saved rule that linked `billId`, when it was linked automatically. */
  billRuleId?: number | null;
  accountId?: number | null;
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

/** The whole filtered set's size and totals (not just this page), for the summary line. */
export interface TxSummary {
  total: number;
  from: number;
  to: number;
  sumDebit: number;
  sumCredit: number;
  sumNet: number;
}

// The kit's dashed "Pending" badge. The pending tray (Notice) above the table offers to merge a
// hand-entered row with its posted twin once that arrives.
function PendingBadge() {
  return (
    <span title="Pending — not posted by the bank yet. Hand-entered ones can be merged with the posted row from the pending notice above.">
      <Badge label="Pending" variant="pending" size="sm" />
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

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v) || 0);

// Money spent out of the wallet — the other side of the same coin.
const isWalletSpend = (t: TxRow) =>
  t.direction === "Debit" && WALLET_ACCOUNT_TYPES.includes(t.accountType ?? "");

// Signed for <Money>: amount is always the positive magnitude, direction carries the sign.
const signed = (t: TxRow) => (t.direction === "Credit" ? 1 : -1) * num(t.amount);

const PAGE_SIZES = [25, 50, 100, 200, 500];

const SORTS = [
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "account", label: "Account" },
  { value: "category", label: "Category" },
  { value: "amount", label: "Amount" },
  { value: "direction", label: "In / out" },
];

/** Per-row cash bookkeeping, shared by the table and card renders. */
function cashFacts(t: TxRow) {
  const cashSource = isCashSource(t);
  const walletSpend = isWalletSpend(t);
  const allocated = num(t.allocated);
  const covered = num(t.covered);
  const amount = num(t.amount);
  // A withdrawal's real cost is what was never accounted for; a wallet purchase funded by one
  // is already inside that withdrawal's amount, so it isn't additional money out. Cash back on
  // a purchase only has its cash part to account for, not the whole row.
  const cash = cashSource ? cashIn(t) : amount;
  const unaccounted = Math.round((cash - allocated) * 100) / 100;
  const cashBack = cashSource && cash + 0.004 < amount;
  return { cashSource, walletSpend, allocated, covered, amount, unaccounted, cashBack };
}

/** The small lines under an amount: unaccounted cash, or "from cash withdrawn". */
function CashNotes({ t }: { t: TxRow }) {
  const f = cashFacts(t);
  return (
    <>
      {f.cashSource && (f.allocated > 0 || f.cashBack) && (
        <span
          className="block text-[11px] font-normal text-fg-3"
          title="Cash still unaccounted for — it counts as spending until purchases are logged against it"
        >
          {formatMoney(f.unaccounted)} {f.cashBack ? "cash " : ""}unaccounted
        </span>
      )}
      {f.walletSpend && f.covered > 0 && (
        <span
          className="block text-[11px] font-normal text-income"
          title="Paid from cash already withdrawn — counted here, not twice"
        >
          {f.covered + 0.004 >= f.amount
            ? "from cash withdrawn"
            : `${formatMoney(f.covered)} from cash withdrawn`}
        </span>
      )}
    </>
  );
}

export interface TransactionsTableProps {
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
  /** Count + totals over the whole filtered set, shown above the table. */
  summary?: TxSummary;
  /** The page hosting the table: sort/paging links stay on it and edits revalidate it. Activity
   *  (default) and each month's Bills page render the very same rows. */
  basePath?: string;
}

const NO_RULES: CategoryRule[] = [];

const flip = (prev: Set<number>, id: number) => {
  const n = new Set(prev);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};

/**
 * What one transaction's row needs, in either layout. Everything here keeps its identity across
 * renders that don't concern the row — the row object and the shared lists come through useStable,
 * the handlers are stable callbacks, the rest are primitives — so the memoised rows below skip
 * every render but their own.
 */
interface TxRowProps {
  t: TxRow;
  selected: boolean;
  /** The cash detail under a withdrawal is open. */
  expanded: boolean;
  /** This row's delete is on its way to the server. */
  deleting: boolean;
  /** Listed in date order under date bands, so the row doesn't repeat its date. */
  grouped: boolean;
  basePath: string;
  categoryOptions: CategoryOption[];
  accounts: EditAccountOption[];
  bills: BillOption[];
  rules: CategoryRule[];
  onToggle: (id: number) => void;
  onToggleExpanded: (id: number) => void;
  onDelete: (t: TxRow) => void;
}

function RowActions({ t, accounts, categoryOptions, bills, basePath, deleting, onDelete }: Pick<TxRowProps, "t" | "accounts" | "categoryOptions" | "bills" | "basePath" | "deleting" | "onDelete">) {
  return (
    <>
      <EditTransaction txn={t} accounts={accounts} categoryOptions={categoryOptions} path={basePath} />
      <SplitTransaction txn={t} categoryOptions={categoryOptions} path={basePath} />
      {/* Linked rows show their bill badge (with Unlink) beside the description instead; this
          copy stays mounted (rendering nothing once linked) so a rule editor opened on link
          survives the row turning linked. */}
      <ConvertToBill
        actionOnly
        transactionId={t.id}
        description={t.description}
        billId={t.billId}
        billRuleId={t.billRuleId ?? null}
        txn={{ accountId: t.accountId ?? null, amount: t.amount, direction: t.direction }}
        categoryOptions={categoryOptions}
        bills={bills}
        path={basePath}
      />
      <IconButton
        icon="trash-2"
        label="Delete transaction"
        size="sm"
        onClick={() => onDelete(t)}
        disabled={deleting}
        className="hover:!text-over"
      />
    </>
  );
}

function ExpandButton({ id, allocated, open, onToggle }: { id: number; allocated: number; open: boolean; onToggle: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      title={
        allocated > 0
          ? `${formatMoney(allocated)} of this cash is accounted for`
          : "See what this cash paid for"
      }
      aria-expanded={open}
      aria-label="Show what this cash paid for"
      className="inline-flex shrink-0 text-fg-3 hover:text-accent-text"
    >
      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
    </button>
  );
}

function TitleBits({ t, bills, basePath, categoryOptions }: Pick<TxRowProps, "t" | "bills" | "basePath" | "categoryOptions">) {
  return (
    <>
      {t.pending && <PendingBadge />}
      <MarkPostedButton id={t.id} pending={t.pending} source={t.source} path={basePath} />
      <SourceGlyph source={t.source} />
      {t.billId != null && (
        <ConvertToBill
          transactionId={t.id}
          description={t.description}
          billId={t.billId}
          billRuleId={t.billRuleId ?? null}
          txn={{ accountId: t.accountId ?? null, amount: t.amount, direction: t.direction }}
          categoryOptions={categoryOptions}
          bills={bills}
          path={basePath}
        />
      )}
    </>
  );
}

/** Wide layout: the transaction's table row, plus the cash detail row under it when open. */
const TxTableRow = memo(function TxTableRow({
  t,
  selected,
  expanded,
  deleting,
  grouped,
  colCount,
  basePath,
  categoryOptions,
  accounts,
  bills,
  rules,
  onToggle,
  onToggleExpanded,
  onDelete,
}: TxRowProps & { colCount: number }) {
  const f = cashFacts(t);
  return (
    <>
      <tr aria-selected={selected} data-pending={t.pending || undefined}>
        <td className="is-shrink">
          <Checkbox checked={selected} onChange={() => onToggle(t.id)} aria-label={`Select ${t.description}`} />
        </td>
        {!grouped && <td className="is-shrink tabular-nums text-fg-2">{formatDate(t.txnDate)}</td>}
        <td className="min-w-0 max-w-md xl:max-w-xl">
          <div className="flex min-w-0 items-center gap-1.5">
            {f.cashSource && <ExpandButton id={t.id} allocated={f.allocated} open={expanded} onToggle={onToggleExpanded} />}
            <span className={cx("truncate font-medium", t.pending && "text-fg-2")} title={t.description}>
              {t.description}
            </span>
            <TitleBits t={t} bills={bills} basePath={basePath} categoryOptions={categoryOptions} />
          </div>
          <NoteCell id={t.id} value={t.notes} path={basePath} />
        </td>
        <td className="whitespace-nowrap text-fg-2">{t.accountLabel ?? t.accountNumber ?? "—"}</td>
        <td>
          <CategoryCell
            id={t.id}
            value={t.category}
            options={categoryOptions}
            path={basePath}
            description={t.description}
            rules={rules}
            categoryRuleId={t.categoryRuleId ?? null}
          />
          <SplitSummary amount={t.amount} splits={t.splits ?? []} categoryOptions={categoryOptions} />
        </td>
        <td className="is-num">
          <Money
            value={signed(t)}
            kind={t.pending ? "pending" : "auto"}
            sign={t.pending ? "always" : "auto"}
            className="font-medium"
          />
          <CashNotes t={t} />
        </td>
        <td className="is-shrink">
          <div className="flex items-center justify-end gap-0.5">
            <RowActions t={t} accounts={accounts} categoryOptions={categoryOptions} bills={bills} basePath={basePath} deleting={deleting} onDelete={onDelete} />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={colCount} className="!p-0">
            <CashOffsetDetail withdrawalId={t.id} />
          </td>
        </tr>
      )}
    </>
  );
});

/** Narrow layout: the kit's card row — glyph, title + category picker, amount. */
const TxCardRow = memo(function TxCardRow({
  t,
  selected,
  expanded,
  deleting,
  grouped,
  trayOpen,
  meta,
  basePath,
  categoryOptions,
  accounts,
  bills,
  rules,
  onToggle,
  onToggleExpanded,
  onToggleTray,
  onDelete,
}: TxRowProps & {
  /** The action tray (edit, split, link, delete) is open. */
  trayOpen: boolean;
  /** The row's category, for its glyph. */
  meta: CategoryOption | undefined;
  onToggleTray: (id: number) => void;
}) {
  const f = cashFacts(t);
  return (
    <div className={cx("border-b border-line px-3.5 py-2.5 last:border-b-0", selected && "bg-accent-soft")}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={selected}
          onChange={() => onToggle(t.id)}
          aria-label={`Select ${t.description}`}
          className="mt-2 shrink-0"
        />
        {meta?.emoji ? (
          <Glyph color={meta.color} className="shrink-0">
            <span aria-hidden>{meta.emoji}</span>
          </Glyph>
        ) : (
          <Glyph icon={t.category ? "tag" : "circle-help"} color={meta?.color} className="shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {f.cashSource && <ExpandButton id={t.id} allocated={f.allocated} open={expanded} onToggle={onToggleExpanded} />}
              <span className="truncate text-sm font-medium" title={t.description}>
                {t.description}
              </span>
            </div>
            <div className="shrink-0 text-right text-sm font-semibold">
              <Money value={signed(t)} kind={t.pending ? "pending" : "auto"} sign={t.pending ? "always" : "auto"} />
            </div>
          </div>
          <div className="mt-1 flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <TitleBits t={t} bills={bills} basePath={basePath} categoryOptions={categoryOptions} />
              <CategoryCell
                id={t.id}
                value={t.category}
                options={categoryOptions}
                path={basePath}
                description={t.description}
                rules={rules}
                categoryRuleId={t.categoryRuleId ?? null}
              />
            </div>
            <div className="shrink-0 text-right text-xs text-fg-3">
              {/* Card meta: the account, plus the date when not grouped by it. */}
              <div className="max-w-[7rem] truncate">{t.accountLabel ?? t.accountNumber ?? "—"}</div>
              {!grouped && <div className="tabular-nums">{formatDate(t.txnDate)}</div>}
              <CashNotes t={t} />
            </div>
          </div>
          <SplitSummary amount={t.amount} splits={t.splits ?? []} categoryOptions={categoryOptions} />
          {/* An existing note stays visible; adding one lives in the tray. */}
          {(t.notes || trayOpen) && <NoteCell id={t.id} value={t.notes} path={basePath} />}
          <div className="mt-1 flex items-center justify-end gap-0.5">
            {trayOpen && (
              <RowActions t={t} accounts={accounts} categoryOptions={categoryOptions} bills={bills} basePath={basePath} deleting={deleting} onDelete={onDelete} />
            )}
            <IconButton
              icon="ellipsis"
              label={trayOpen ? "Hide actions" : "More actions"}
              size="sm"
              aria-expanded={trayOpen}
              onClick={() => onToggleTray(t.id)}
            />
          </div>
        </div>
      </div>
      {expanded && (
        <div className="-mx-3.5 mt-2 border-t border-line">
          <CashOffsetDetail withdrawalId={t.id} />
        </div>
      )}
    </div>
  );
});

/**
 * Memoised on the content of its props (all plain data from the page): every server action on
 * the screen refreshes the whole route, and without this a save that touched no transaction —
 * marking a bill paid on the month page, say — still re-rendered every row here. The exported
 * component stays a plain function; it only forwards to the memoised table.
 */
const MemoTable = memoDeep(TransactionsTableImpl);
export function TransactionsTable(props: TransactionsTableProps) {
  return <MemoTable {...props} />;
}

function TransactionsTableImpl({
  rows: rowsProp,
  categoryOptions: categoryOptionsProp,
  accounts: accountsProp,
  bills: billsProp,
  rules: rulesProp = NO_RULES,
  page,
  pages,
  pageSize,
  sort,
  dir,
  summary,
  basePath = "/transactions",
}: TransactionsTableProps) {
  // A refresh that changed one transaction hands back every other row, and the lists the rows
  // share, as the objects they already were — which is what lets the memoised rows sit it out.
  const rows = useStable(rowsProp);
  const categoryOptions = useStable(categoryOptionsProp);
  const accounts = useStable(accountsProp);
  const bills = useStable(billsProp);
  const rules = useStable(rulesProp);

  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<number>>(new Set());
  // Withdrawal rows whose cash detail is open. Ids, not indexes — the list re-sorts.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Card rows (narrow layout) whose action tray is open.
  const [tray, setTray] = useState<Set<number>>(new Set());
  // The row being deleted: only its own delete button waits, so only it re-renders.
  const [deleting, setDeleting] = useState<number | null>(null);
  const [bulkCat, setBulkCat] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkBill, setLinkBill] = useState("");
  const [bulkError, setBulkError] = useState("");
  const linkBtnRef = useRef<HTMLButtonElement>(null);

  const nav = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${basePath}?${next.toString()}`);
  };

  const sortBy = (col: string) => {
    const nextDir = sort === col && dir === "asc" ? "desc" : "asc";
    nav({ sort: col, dir: nextDir, page: "1" });
  };

  const toggleExpanded = useCallback((id: number) => setExpanded((prev) => flip(prev, id)), []);
  const toggleTray = useCallback((id: number) => setTray((prev) => flip(prev, id)), []);
  const toggle = useCallback((id: number) => setSel((prev) => flip(prev, id)), []);

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  function applyBulk() {
    if (!sel.size || !bulkCat) return;
    const ids = [...sel];
    start(async () => {
      await bulkSetCategory(ids, bulkCat || null);
      setSel(new Set());
      setBulkCat("");
    });
  }

  // Link every selected row to one bill. One call per row: setTransactionBill also re-points
  // each row's bill instance to the bill's instance in that row's own month.
  function applyLink() {
    const billId = Number(linkBill);
    if (!sel.size || !billId) return;
    const ids = [...sel];
    setBulkError("");
    start(async () => {
      const errors: string[] = [];
      for (const id of ids) {
        const res = await setTransactionBill(id, billId, basePath);
        if (!res.ok) errors.push(res.error);
      }
      if (errors.length) setBulkError([...new Set(errors)].join(" "));
      setLinkOpen(false);
      setLinkBill("");
      setSel(new Set());
      // Every link that went through refreshed the page itself; only an all-failed batch didn't.
      if (errors.length) router.refresh();
    });
  }

  const del = useCallback(
    (t: TxRow) => {
      if (!confirm(`Delete this transaction?\n\n${formatDate(t.txnDate)} · ${t.description}`)) return;
      // Set outside the transition so the button is disabled now, not when the delete lands.
      setDeleting(t.id);
      start(async () => {
        try {
          await deleteTransaction(t.id, basePath);
          setSel((prev) => {
            if (!prev.has(t.id)) return prev;
            const n = new Set(prev);
            n.delete(t.id);
            return n;
          });
        } finally {
          setDeleting((cur) => (cur === t.id ? null : cur));
        }
      });
    },
    [basePath],
  );

  const catMeta = new Map(categoryOptions.map((c) => [c.name, c]));
  // Date group rows (the kit's "Oct 8, 2026" bands) only make sense when the list is in date
  // order; any other sort shows the date as its own column instead.
  const grouped = sort === "date";
  // One flat, keyed list of date bands and rows. A band is keyed by the first row under it, so a
  // band appearing or going away never shifts the keys after it (which would remount those rows).
  const items: ({ band: string; key: string } | { row: TxRow })[] = [];
  let lastDate: string | null = null;
  for (const t of rows) {
    if (grouped && t.txnDate !== lastDate) items.push({ band: t.txnDate, key: `band:${t.id}` });
    lastDate = t.txnDate;
    items.push({ row: t });
  }

  const sortHead = (col: string, label: string, right = false) => (
    <button
      type="button"
      onClick={() => sortBy(col)}
      className={cx(
        "inline-flex items-center gap-1 hover:text-fg",
        sort === col && "text-fg",
        right && "flex-row-reverse",
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon
        name={sort === col ? (dir === "asc" ? "chevron-up" : "chevron-down") : "chevron-down"}
        size={12}
        className={sort === col ? undefined : "opacity-0"}
      />
    </button>
  );

  const colCount = grouped ? 6 : 7;
  const uncatFilter = params.get("uncat") === "1";
  const rowProps = (t: TxRow) => ({
    t,
    selected: sel.has(t.id),
    expanded: expanded.has(t.id),
    deleting: deleting === t.id,
    grouped,
    basePath,
    categoryOptions,
    accounts,
    bills,
    rules,
    onToggle: toggle,
    onToggleExpanded: toggleExpanded,
    onDelete: del,
  });

  return (
    <div className="space-y-3">
      {/* Summary line: count (or the bulk bar while rows are selected) and the filtered totals. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px]">
        {sel.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-semibold">{sel.size} selected</b>
            <ColorSelect
              value={bulkCat}
              options={categoryOptions.filter((c) => c.active)}
              placeholder="Pick a category"
              onSelect={setBulkCat}
            />
            <Button
              size="sm"
              variant="secondary"
              icon="tags"
              onClick={applyBulk}
              disabled={pending || !bulkCat}
              title={bulkCat ? undefined : "Pick a category first"}
            >
              Categorize {sel.size}
            </Button>
            {/* A plain button (not <Button>) so the anchored Sheet can hold a ref to it. */}
            <button
              ref={linkBtnRef}
              type="button"
              className={buttonClass({ variant: "secondary", size: "sm" })}
              onClick={() => setLinkOpen((o) => !o)}
              disabled={pending || bills.length === 0}
            >
              <Icon name="link" size={15} />
              Link to bill
            </button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
              Clear
            </Button>
          </div>
        ) : (
          <span className="text-fg-3">
            {summary
              ? summary.total === 0
                ? "Nothing matches"
                : `Showing ${summary.from.toLocaleString()}–${summary.to.toLocaleString()} of ${summary.total.toLocaleString()}`
              : `Page ${page} of ${pages}`}
          </span>
        )}
        {summary && summary.total > 0 && (
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="text-fg-3">
              In <Money value={summary.sumCredit} kind="income" sign="always" />
            </span>
            <span className="text-fg-3">
              Out <Money value={-summary.sumDebit} />
            </span>
            <span className="text-fg-3">
              Net <Money value={summary.sumNet} className="font-semibold" />
            </span>
          </span>
        )}
      </div>
      {bulkError && <p className="text-xs text-over">{bulkError}</p>}

      <Sheet
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={`Link ${sel.size} to a bill`}
        anchorRef={linkBtnRef}
        desktop="anchored"
        width={300}
      >
        <div className="space-y-3">
          <Field label="Bill" hint="Each one is attached to that bill's entry in its own month, when there is one.">
            <Select
              value={linkBill}
              onChange={(e) => setLinkBill(e.target.value)}
              options={[{ value: "", label: "Choose a bill" }, ...bills.map((b) => ({ value: String(b.id), label: b.name }))]}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" icon="link" onClick={applyLink} disabled={pending || !linkBill}>
              Link {sel.size}
            </Button>
          </div>
        </div>
      </Sheet>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          uncatFilter ? (
            <EmptyState icon="tags" title="All categorized" body="Every transaction here has a home. Listo." />
          ) : (
            <EmptyState icon="search" title="No transactions match" body="Try a different search, month or account." />
          )
        ) : (
          <div className="@container">
            {/* Wide layout: the table, scrolling sideways inside the card if it has to. */}
            <div className="hidden @min-[640px]:block overflow-x-auto">
              <table className="mp-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="is-shrink">
                      <Checkbox
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all on this page"
                      />
                    </th>
                    {!grouped && <th className="is-shrink">{sortHead("date", "Date")}</th>}
                    <th>{sortHead("description", "Description")}</th>
                    <th>{sortHead("account", "Account")}</th>
                    <th>{sortHead("category", "Category")}</th>
                    <th className="is-right">{sortHead("amount", "Amount", true)}</th>
                    <th className="is-shrink">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) =>
                    "band" in it ? (
                      <tr key={it.key}>
                        <td colSpan={colCount} className="mp-table__groupcell">
                          {formatDate(it.band)}
                        </td>
                      </tr>
                    ) : (
                      <TxTableRow key={it.row.id} {...rowProps(it.row)} colCount={colCount} />
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {/* Narrow layout: the kit's card rows — glyph, title + category picker, amount. */}
            <div className="@min-[640px]:hidden">
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
                <Checkbox
                  checked={allSelected}
                  onChange={toggleAll}
                  label={<span className="text-xs text-fg-2">Select all</span>}
                />
              </div>
              {items.map((it) =>
                "band" in it ? (
                  <div key={it.key} className="mp-cardrow__groupcell">
                    {formatDate(it.band)}
                  </div>
                ) : (
                  <TxCardRow
                    key={it.row.id}
                    {...rowProps(it.row)}
                    trayOpen={tray.has(it.row.id)}
                    meta={it.row.category ? catMeta.get(it.row.category) : undefined}
                    onToggleTray={toggleTray}
                  />
                ),
              )}
            </div>
          </div>
        )}

        {/* Footer: page size, sort (covers every sort, including the narrow layout), paging. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Rows per page"
              value={String(pageSize)}
              onChange={(e) => nav({ size: e.target.value, page: "1" })}
              options={PAGE_SIZES.map((s) => ({ value: String(s), label: `${s} per page` }))}
              className="!h-8 !w-auto !text-sm"
            />
            <Select
              aria-label="Sort by"
              value={sort}
              onChange={(e) => nav({ sort: e.target.value, page: "1" })}
              options={SORTS}
              className="!h-8 !w-auto !text-sm"
            />
            <IconButton
              icon={dir === "asc" ? "arrow-up" : "arrow-down"}
              label={dir === "asc" ? "Sorted ascending" : "Sorted descending"}
              size="sm"
              variant="secondary"
              onClick={() => nav({ dir: dir === "asc" ? "desc" : "asc", page: "1" })}
            />
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => nav({ page: "1" })} disabled={page <= 1}>
              First
            </Button>
            <IconButton icon="chevron-left" label="Previous page" size="sm" onClick={() => nav({ page: String(page - 1) })} disabled={page <= 1} />
            <span className="px-1 text-xs text-fg-3 tabular-nums">
              Page {page} of {pages}
            </span>
            <IconButton icon="chevron-right" label="Next page" size="sm" onClick={() => nav({ page: String(page + 1) })} disabled={page >= pages} />
            <Button size="sm" variant="ghost" onClick={() => nav({ page: String(pages) })} disabled={page >= pages}>
              Last
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

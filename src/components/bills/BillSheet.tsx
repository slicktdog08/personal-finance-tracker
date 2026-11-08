"use client";

import { memo, useCallback, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { parseMoney, toNum } from "@/server/lib/money";
import { ColorSelect } from "@/components/ColorSelect";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  DataTable,
  EmptyState,
  FilterBar,
  Glyph,
  Icon,
  IconButton,
  Money,
  Notice,
  ProgressBar,
  Segmented,
  StatTile,
  type DataTableColumn,
  type DataTableMobile,
  type FilterChip,
  type VarStyle,
} from "@/components/ds";
import { useStable } from "@/components/ui/useStable";
import type { InstancePatch } from "@/server/lib/bill-types";
import { updateInstance, deleteInstance, bulkSetStatus } from "@/server/actions/bills";
import { updateStatusColor, updatePaymentTypeColor } from "@/server/actions/config";
import { InlineEdit } from "./InlineEdit";
import { BillEditSheet, type BillEditHandle } from "./BillEditSheet";
import { billIcon, paymentIcon } from "./billGlyph";
import {
  GROUP_RANK,
  PAST_DUE_STATUS,
  amt,
  applyRowEdit,
  makeBillFacts,
  rowPatch,
  type BillFacts,
  type ColorItem,
  type SheetRow,
  type StatusItem,
} from "./billFacts";

export type { SheetRow } from "./billFacts";

type SortKey = "due" | "amount" | "name" | "status" | "order";
// Chip ids that aren't status names. Past due is computed (see isPastDue), not just the status.
const PAST_DUE = "__pastdue";
const DEBT = "__debt";
const NON_DEBT = "__nondebt";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const glyph = (facts: BillFacts, r: SheetRow, size?: "sm") => <Glyph icon={billIcon(r.name, r.isDebt)} color={facts.statusInfo.get(r.status)?.color} size={size} />;
const flags = (r: SheetRow) => (
  <>
    {r.isDebt && <Badge label="Debt" variant="outline" size="sm" dot={false} />}
    {r.isCancel && <Badge label="Cancel" variant="outline" size="sm" color="#e11d48" icon="scissors" title="Marked to cancel" />}
  </>
);
const money = (facts: BillFacts, r: SheetRow, v: string | null) =>
  v == null || v === "" ? <span className="text-fg-3">—</span> : <Money value={v} kind={facts.isPastDue(r) ? "over" : "neutral"} />;

/**
 * A month's bills: summary, filters, the table and the edit sheet.
 *
 * Re-render budget. A save used to re-render every cell of the table three times (the pending
 * flag, the action's own refresh, then an explicit router.refresh() fetching it all again). Now:
 *  - server props go through useStable, so a refresh that changed one bill hands every other row
 *    the same object as before;
 *  - edits are shown optimistically (useOptimistic) and the action's revalidatePath is the only
 *    refresh — Next already returns the fresh tree with the action's response;
 *  - columns and handlers are memoised and DataTable's rows are memo'd, so only the edited row
 *    renders;
 *  - the edit sheet keeps its own open state (BillEditSheet), so opening or closing it doesn't
 *    render this component at all.
 */
export function BillSheet({
  path,
  rows: rowsProp,
  statuses: statusesProp,
  payments: paymentsProp,
  year,
  month,
  today,
  dashboardHref,
}: {
  path: string;
  rows: SheetRow[];
  statuses: StatusItem[];
  payments: ColorItem[];
  year: number;
  /** 1-based. */
  month: number;
  /** YYYY-MM-DD; decides past due / this week. Passed from the server so SSR and client agree. */
  today: string;
  dashboardHref?: string;
}) {
  const statuses = useStable(statusesProp);
  const payments = useStable(paymentsProp);
  const [rows, editRows] = useOptimistic(useStable(rowsProp), applyRowEdit);
  const [pending, start] = useTransition();

  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [fPayment, setFPayment] = useState("");
  const [fDebt, setFDebt] = useState<"" | "debt" | "nondebt">("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  // The edit sheet (row tap on mobile, row click / "More" on desktop) holds its own state.
  const editor = useRef<BillEditHandle>(null);
  const openEdit = useCallback((r: SheetRow) => editor.current?.open(r.id), []);

  const facts = useMemo(() => makeBillFacts({ statuses, year, month, today }), [statuses, year, month, today]);
  const { statusInfo, mon, lastDay, isPastDue, groupOf, paidStatus } = facts;

  // Each action revalidates the month's path itself, which refreshes this page as part of the
  // action's response — no router.refresh() on top.
  const save = useCallback(
    (id: number, patch: InstancePatch) =>
      start(async () => {
        editRows({ ids: [id], patch: rowPatch(patch) });
        await updateInstance(id, patch, path);
      }),
    [path, editRows],
  );
  const remove = useCallback(
    (id: number) =>
      start(async () => {
        editRows({ remove: id });
        await deleteInstance(id, path);
      }),
    [path, editRows],
  );
  const changeStatusColor = useCallback((id: number, color: string) => start(() => updateStatusColor(id, color)), []);
  const changePaymentColor = useCallback((id: number, color: string) => start(() => updatePaymentTypeColor(id, color)), []);

  // ---- Month summary (always over every bill, not the filtered view) ----
  const pastDueRows = rows.filter(isPastDue);
  const biggestPastDue = pastDueRows.reduce<SheetRow | null>((b, r) => (!b || amt(r) > amt(b) ? r : b), null);
  const countBy = (name: string) => rows.filter((r) => r.status === name).length;

  // ---- Filter + sort ----
  // Memoised for identity, not speed: the table's handlers and columns hang off `visible`, and
  // they must not change when only the selection or the saving flag does.
  const visible = useMemo(() => {
    const list = rows.filter((r) => {
      if (statusSel.length) {
        const hit = statusSel.includes(r.status) || (statusSel.includes(PAST_DUE) && isPastDue(r));
        if (!hit) return false;
      }
      if (fPayment && (r.paymentType ?? "") !== fPayment) return false;
      if (fDebt === "debt" && !r.isDebt) return false;
      if (fDebt === "nondebt" && r.isDebt) return false;
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "amount":
          // Amount defaults to biggest first — that's the question it answers.
          return (amt(b) - amt(a)) * dir;
        case "due":
          // Grouped (Overdue / This week / …), so the group order is fixed and direction applies within.
          return GROUP_RANK[groupOf(a)] - GROUP_RANK[groupOf(b)] || ((a.dueDay ?? 99) - (b.dueDay ?? 99)) * dir;
        case "status":
          return ((statusInfo.get(a.status)?.order ?? 99) - (statusInfo.get(b.status)?.order ?? 99)) * dir;
        default:
          return (a.id - b.id) * dir;
      }
    });
  }, [rows, statusSel, fPayment, fDebt, q, sortKey, sortDir, isPastDue, groupOf, statusInfo]);

  const total = visible.reduce((s, r) => s + amt(r), 0);
  const debtTotal = visible.reduce((s, r) => s + (r.isDebt ? amt(r) : 0), 0);
  const filtered = statusSel.length > 0 || !!fPayment || !!fDebt || !!q;
  const clearFilters = () => {
    setStatusSel([]);
    setFPayment("");
    setFDebt("");
    setQ("");
  };

  const chips: FilterChip[] = [
    ...(pastDueRows.length || statusSel.includes(PAST_DUE) ? [{ id: PAST_DUE, label: "Past due", count: pastDueRows.length }] : []),
    ...statuses
      .filter((s) => s.name !== PAST_DUE_STATUS && (countBy(s.name) > 0 || statusSel.includes(s.name)))
      .map((s) => ({ id: s.name, label: s.name, count: countBy(s.name) })),
    { id: DEBT, label: "Debt", count: rows.filter((r) => r.isDebt).length },
    { id: NON_DEBT, label: "Not debt", count: rows.filter((r) => !r.isDebt).length },
  ];
  const activeChips = [...statusSel, ...(fDebt === "debt" ? [DEBT] : fDebt === "nondebt" ? [NON_DEBT] : [])];
  const toggleChip = (id: string) => {
    if (id === DEBT) return setFDebt((d) => (d === "debt" ? "" : "debt"));
    if (id === NON_DEBT) return setFDebt((d) => (d === "nondebt" ? "" : "nondebt"));
    setStatusSel((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  };

  // ---- Selection (over the currently visible rows) ----
  const allSelected = visible.length > 0 && visible.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(visible.map((r) => r.id)));
  const toggle = useCallback(
    (id: number) =>
      setSel((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const isSelected = useCallback((r: SheetRow) => sel.has(r.id), [sel]);
  function applyBulk(status: string) {
    if (!sel.size || !status) return;
    const ids = [...sel];
    start(async () => {
      editRows({ ids, patch: { status } });
      await bulkSetStatus(ids, status, path);
      setSel(new Set());
      setBulkStatus("");
    });
  }

  // ---- Cells ----
  // Everything a cell reads is either the row, the per-row state DataTable passes in, or one of
  // the stable values in the deps below — so the renderers keep their identity across saves and
  // selection changes, and DataTable's memoised rows can skip.
  const cells = useMemo<DataTableColumn<SheetRow>[]>(() => {
    const statusPicker = (r: SheetRow) => (
      // The menu portals to <body> but React events still bubble through the tree — stop them here so
      // picking a status doesn't also count as a row click.
      <span onClick={stop} className="inline-flex">
        <ColorSelect value={r.status} options={statuses} onSelect={(name) => save(r.id, { status: name })} onColorChange={changeStatusColor} />
      </span>
    );
    const paymentPicker = (r: SheetRow) => (
      <span onClick={stop} className="inline-flex">
        <ColorSelect
          value={r.paymentType ?? ""}
          options={payments}
          allowEmpty
          placeholder="Payment"
          onSelect={(name) => save(r.id, { paymentType: name || null })}
          onColorChange={changePaymentColor}
        />
      </span>
    );
    return [
      {
        key: "sel",
        shrink: true,
        header: null,
        render: (r, { selected }) => (
          <span onClick={stop} className="inline-flex">
            <Checkbox checked={selected} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
          </span>
        ),
      },
      {
        key: "name",
        header: "Bill",
        render: (r) => (
          <span className="flex min-w-0 items-center gap-2.5">
            {glyph(facts, r, "sm")}
            <InlineEdit
              label="name"
              value={r.name}
              render={(v) => <span className="font-medium">{v}</span>}
              onCommit={(v) => v.trim() && save(r.id, { name: v.trim() })}
              inputClassName="w-48"
            />
            {flags(r)}
            {r.billId ? (
              <Link
                href={`/settings/bills/${r.billId}`}
                onClick={stop}
                title="Bill history and stats"
                aria-label={`${r.name} history`}
                className="ml-auto shrink-0 rounded-full p-1 text-fg-3 hover:bg-hover hover:text-accent-text"
              >
                <Icon name="history" size={15} />
              </Link>
            ) : null}
          </span>
        ),
      },
      {
        key: "due",
        header: "Due",
        shrink: true,
        render: (r) => (
          <InlineEdit
            label="due day"
            type="number"
            min={1}
            max={31}
            value={r.dueDay == null ? "" : String(r.dueDay)}
            render={(v) => <span className="tnum text-fg-2">{v ? `${facts.mon} ${v}` : "—"}</span>}
            onCommit={(v) => {
              const n = v === "" ? null : Number(v);
              if (n !== r.dueDay) save(r.id, { dueDay: n });
            }}
            inputClassName="w-16"
          />
        ),
      },
      { key: "status", header: "Status", render: statusPicker },
      { key: "payment", header: "Payment", render: paymentPicker },
      {
        key: "amount",
        header: "Amount",
        num: true,
        render: (r) => (
          <InlineEdit
            label="amount"
            inputMode="decimal"
            value={r.amount ?? ""}
            render={(v) => money(facts, r, v)}
            onCommit={(v) => {
              const n = parseMoney(v);
              if (n !== toNum(r.amount)) save(r.id, { amount: n });
            }}
            className="tnum"
            inputClassName="w-28 text-right tnum"
          />
        ),
      },
      {
        key: "act",
        header: <span className="sr-only">Actions</span>,
        shrink: true,
        render: (r) =>
          // No "disabled while saving": the status flips optimistically, so a paid bill has
          // already swapped this button for the menu — and a saving flag here would re-render
          // every row on every save.
          !facts.isSettled(r) && facts.paidStatus ? (
            <Button
              size="sm"
              variant="secondary"
              icon="check"
              title={`Mark ${r.name} as ${facts.paidStatus}`}
              onClick={(e) => {
                e.stopPropagation();
                if (facts.paidStatus) save(r.id, { status: facts.paidStatus });
              }}
            >
              Paid
            </Button>
          ) : (
            <IconButton
              icon="ellipsis"
              label={`Edit ${r.name}`}
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(r);
              }}
            />
          ),
      },
    ];
  }, [facts, statuses, payments, save, changeStatusColor, changePaymentColor, toggle, openEdit]);
  // The select-all box follows the selection and the filters. Rows only look at the renderers
  // (DataTable ignores `header` when deciding whether a row changed), so it lives outside the memo.
  const columns = cells.map((c) => (c.key === "sel" ? { ...c, header: <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" /> } : c));

  const mobile = useMemo<DataTableMobile<SheetRow>>(
    () => ({
      lead: (r, { selected }) => (
        <span className="flex items-center gap-2.5">
          <span onClick={stop} className="inline-flex">
            <Checkbox checked={selected} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
          </span>
          {glyph(facts, r)}
        </span>
      ),
      title: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{r.name}</span>
          {flags(r)}
        </span>
      ),
      sub: (r) => (
        <>
          <span onClick={stop} className="inline-flex">
            <ColorSelect value={r.status} options={statuses} onSelect={(name) => save(r.id, { status: name })} onColorChange={changeStatusColor} />
          </span>
          <span className="tnum">{r.dueDay != null ? `${facts.mon} ${r.dueDay}` : "No due day"}</span>
        </>
      ),
      amount: (r) => money(facts, r, r.amount),
      meta: (r) => r.paymentType ?? "",
    }),
    [facts, statuses, save, changeStatusColor, toggle],
  );

  return (
    <div className="space-y-5">
      <BillSummary rows={rows} statuses={statuses} facts={facts} dashboardHref={dashboardHref} />

      {biggestPastDue && (
        <Notice
          tone="danger"
          title={`${pastDueRows.length} bill${pastDueRows.length === 1 ? " is" : "s are"} past due`}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearFilters();
                setStatusSel([PAST_DUE]);
                setSortKey("due");
              }}
            >
              {pastDueRows.length === 1 ? "Show it" : "Show them"}
            </Button>
          }
        >
          {biggestPastDue.name} {pastDueRows.length === 1 ? "for" : "is the big one at"}{" "}
          <Money value={biggestPastDue.amount} kind="neutral" />
          {biggestPastDue.dueDay != null
            ? `${pastDueRows.length === 1 ? " was due" : " — it was due"} ${mon} ${Math.min(biggestPastDue.dueDay, lastDay)}.`
            : pastDueRows.length === 1
              ? " is still unpaid."
              : "."}
        </Notice>
      )}

      <FilterBar search={q} onSearch={setQ} placeholder="Search bills" chips={chips} active={activeChips} onToggle={toggleChip}>
        <ColorPicker
          options={payments.map((p) => ({ value: p.name, label: p.name, color: p.color, icon: paymentIcon(p.name) }))}
          value={fPayment || null}
          onChange={(v) => setFPayment(v ?? "")}
          placeholder="Payment type"
          title="Payment type"
          noneLabel="Any payment type"
          size="lg"
        />
        <div className="flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          <Segmented<SortKey>
            label="Sort"
            value={sortKey}
            onChange={setSortKey}
            options={[
              { value: "due", label: "Due date" },
              { value: "amount", label: "Amount" },
              { value: "name", label: "Name" },
              { value: "status", label: "Status" },
              { value: "order", label: "Added" },
            ]}
          />
          <IconButton
            icon={sortDir === "asc" ? "arrow-up" : "arrow-down"}
            label={sortDir === "asc" ? "Reverse order" : "Restore order"}
            size="sm"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          />
        </div>
      </FilterBar>

      {/* Bulk status — appears once anything is selected */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border border-accent/40 bg-accent-soft px-3 py-2">
          <Checkbox checked={allSelected} onChange={toggleAll} label={<span className="font-medium">{sel.size} selected</span>} aria-label="Select all visible" />
          <span className="text-sm text-fg-2">Set status</span>
          <ColorSelect value={bulkStatus} options={statuses} placeholder="Choose" onSelect={setBulkStatus} />
          <Button size="sm" onClick={() => applyBulk(bulkStatus)} disabled={pending || !bulkStatus}>
            Apply to {sel.size}
          </Button>
          {paidStatus && (
            <Button size="sm" variant="secondary" icon="check" onClick={() => applyBulk(paidStatus)} disabled={pending}>
              Mark {sel.size} paid
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-fg-2">
        <span className="tnum">
          {visible.length} of {rows.length} bills · <Money value={total} kind="neutral" /> total · <Money value={debtTotal} kind="neutral" /> debt
        </span>
        <span className="flex items-center gap-2">
          {pending && <span className="text-xs text-fg-3">Saving…</span>}
          {filtered && (
            <Button size="sm" variant="ghost" icon="x" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </span>
      </div>

      <Card padded={false} className="overflow-hidden">
        <DataTable
          rows={visible}
          columns={columns}
          onRowClick={openEdit}
          isSelected={isSelected}
          groupBy={sortKey === "due" ? groupOf : undefined}
          mobile={mobile}
          empty={
            rows.length === 0 ? (
              <EmptyState icon="receipt" title="No bills this month" body="Add one with Add bill — a name you've used before brings its history along." />
            ) : (
              <EmptyState
                compact
                icon="search"
                title="No bills match"
                body="Try a different search or clear the filters."
                action={
                  <Button size="sm" variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            )
          }
        />
      </Card>

      <BillEditSheet
        ref={editor}
        path={path}
        rows={rows}
        statuses={statuses}
        payments={payments}
        facts={facts}
        pending={pending}
        onSave={save}
        onDelete={remove}
        onStatusColor={changeStatusColor}
        onPaymentColor={changePaymentColor}
      />
    </div>
  );
}

/** The month at a glance. Memoised: it only depends on the bills, not on filters or selection. */
const BillSummary = memo(function BillSummary({ rows, statuses, facts, dashboardHref }: { rows: SheetRow[]; statuses: StatusItem[]; facts: BillFacts; dashboardHref?: string }) {
  const { isSettled, isPastDue } = facts;
  const billed = rows.reduce((s, r) => s + amt(r), 0);
  const settledRows = rows.filter(isSettled);
  const paid = settledRows.reduce((s, r) => s + amt(r), 0);
  const debtTotalAll = rows.reduce((s, r) => s + (r.isDebt ? amt(r) : 0), 0);
  const anyPastDue = rows.some(isPastDue);
  const countBy = (name: string) => rows.filter((r) => r.status === name).length;
  // Settled first so the bar fills from the left as the month gets paid; Past Due always last.
  const statusesForBar = [
    ...statuses.filter((s) => s.isSettled),
    ...statuses.filter((s) => !s.isSettled && s.name !== PAST_DUE_STATUS),
    ...statuses.filter((s) => s.name === PAST_DUE_STATUS),
  ].filter((s) => countBy(s.name) > 0);
  const left = rows.length - settledRows.length;

  return (
    <Card>
      <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as VarStyle}>
        <StatTile label="Still due" value={billed - paid} kind={anyPastDue ? "over" : "neutral"} sub={`${left} bill${left === 1 ? "" : "s"} left`} />
        <StatTile label="Paid" value={paid} sub={`${settledRows.length} of ${rows.length} settled`} />
        <StatTile label="Billed this month" value={billed} />
        <StatTile label="Debt payments" value={debtTotalAll} kind="owed" />
      </div>
      {billed > 0 && (
        <ProgressBar
          className="mt-4"
          max={billed}
          label="Bills by status"
          segments={statusesForBar.map((s) => ({
            value: rows.filter((r) => r.status === s.name).reduce((t, r) => t + amt(r), 0),
            color: s.color,
          }))}
        />
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-fg-2">
        {statusesForBar.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="mp-badge__dot" style={{ "--c": s.color } as VarStyle} />
            {s.name} <span className="tnum text-fg-3">{countBy(s.name)}</span>
          </span>
        ))}
        {dashboardHref && (
          <Link href={dashboardHref} className="ml-auto inline-flex items-center gap-1 font-medium text-accent-text hover:underline">
            Dashboard for this month <Icon name="arrow-right" size={13} />
          </Link>
        )}
      </div>
    </Card>
  );
});

"use client";

import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { PreviewRow } from "@/server/lib/import-types";
import type { CategoryOption } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";
import { ImportCategoryCell } from "@/components/import/ImportCategoryCell";
import { ImportNoteCell } from "@/components/import/ImportNoteCell";
import type { RuleSavedEvent } from "@/components/transactions/RuleEditor";
import { Badge, Money, cx } from "@/components/ds";

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "#22c55e" },
  duplicate: { label: "Looks like a duplicate", color: "#eab308" },
  // The posted version of a pending row entered by hand: settles it instead of duplicating.
  finalizes: { label: "Settles", color: "#0ea5e9" },
  error: { label: "Error", color: "#ef4444" },
};

// Rows that will be written on commit (and can still be edited in the preview).
const editable = (status: string) => status === "new" || status === "finalizes";

interface Props {
  /** The rows to show and edit, in order. Indexes are what the callbacks report. */
  rows: PreviewRow[];
  /**
   * Every row under review, when that is a superset of `rows` (the PDF wizard
   * reviews several statements at once). Used for rule match counts.
   */
  allRows?: PreviewRow[];
  categoryOptions: CategoryOption[];
  rules: CategoryRule[];
  /** The CSV wizard maps an account per row; the PDF wizard picks one per statement. */
  showAccount?: boolean;
  onCategoryChange: (index: number, category: string | null) => void;
  onNotesChange: (index: number, notes: string | null) => void;
  /** Tick/untick folding a matched hand-entered (pending) transaction into this row. */
  onMergeChange: (index: number, mergeWith: number | null) => void;
  onRuleSaved: (e: RuleSavedEvent) => void;
  onRuleDeleted: (ruleId: number, cleared: number) => void;
  /**
   * Height cap for the table's scroll area, from `md` up — phones scroll the page
   * instead of a box inside it. Pass the prefix too, e.g. "md:max-h-[40vh]".
   */
  maxHeightClass?: string;
}

function StatusBadge({ row }: { row: PreviewRow }) {
  const title =
    row.status === "finalizes"
      ? `Settles pending #${row.pendingMatchId}: ${row.pendingMatchDescription ?? ""} — keeps its category, notes and bill link (your description moves to notes); amount, date and title come from this statement`
      : row.error;
  const b = STATUS_BADGE[row.status] ?? { label: row.status, color: "#64748b" };
  return (
    <Badge
      size="sm"
      title={title}
      color={b.color}
      label={row.status === "finalizes" ? `Settles #${row.pendingMatchId}` : b.label}
    />
  );
}

// Money in is income (+, emerald); money out is spend (true minus, ink) — never red.
function Amount({ row }: { row: PreviewRow }) {
  // An error row may have no parseable amount — a dash, not a fake $0.00.
  if (row.amount == null || Number.isNaN(Number(row.amount))) return <span className="text-fg-3">—</span>;
  const n = Math.abs(Number(row.amount));
  return <Money value={row.direction === "Credit" ? n : -n} />;
}

// A hand-entered (usually pending) transaction this row looks like the posted version of.
// Ticked = on import, the two become one: this row's title, amount and date, with the pending
// entry's category and notes (its description moves to notes), instead of a duplicate.
function PendingMatchBox({
  row,
  onChange,
}: {
  row: PreviewRow;
  onChange: (mergeWith: number | null) => void;
}) {
  const m = row.pendingMatch;
  if (!m || row.status !== "new") return null;
  const checked = row.mergeWith === m.id;
  const diff = Math.round(((row.amount ?? 0) - m.amount) * 100) / 100;
  return (
    <label
      className={cx(
        "mt-1 flex cursor-pointer select-none items-start gap-1.5 rounded-control border px-2 py-1.5 text-xs",
        checked ? "border-warn bg-warn-soft text-fg" : "border-line text-fg-3",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? m.id : null)}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--mp-warn)]"
      />
      <span className="min-w-0">
        {checked ? "Settles your " : "Looks like your "}
        {m.pending ? "pending" : "hand-entered"} entry{" "}
        <span className="font-medium break-words">&ldquo;{m.description}&rdquo;</span>
        <span className="tabular-nums">
          {" "}
          · {formatDate(m.txnDate)} · {formatMoney(m.amount)}
          {diff !== 0 && (
            <>
              {" "}
              ({diff > 0 ? "+" : "−"}
              {formatMoney(Math.abs(diff))})
            </>
          )}
        </span>
        {checked ? (
          <span> — keeps its {m.category ? `category (${m.category}) and ` : ""}notes, your name for it moves to notes; title, amount and date from here</span>
        ) : (
          <span> — tick to merge instead of adding a duplicate</span>
        )}
      </span>
    </label>
  );
}

/**
 * The review grid shared by the CSV and PDF import wizards: a table on wide screens
 * and stacked cards on phones, where seven columns can't fit without a sideways
 * scroll that hides the category picker. Both renderings drive the same state and
 * carry the same affordances — status, note, category, rule chips and rule saving.
 */
export function ImportPreviewTable({
  rows,
  allRows,
  categoryOptions,
  rules,
  showAccount = false,
  onCategoryChange,
  onNotesChange,
  onMergeChange,
  onRuleSaved,
  onRuleDeleted,
  maxHeightClass = "md:max-h-[60vh]",
}: Props) {
  const matchRows = allRows ?? rows;

  const categoryCell = (r: PreviewRow, i: number) => (
    <ImportCategoryCell
      row={r}
      rows={matchRows}
      categoryOptions={categoryOptions}
      rules={rules}
      disabled={!editable(r.status)}
      onChange={(c) => onCategoryChange(i, c)}
      onRuleSaved={onRuleSaved}
      onRuleDeleted={onRuleDeleted}
    />
  );

  const noteCell = (r: PreviewRow, i: number) => (
    <ImportNoteCell
      value={r.notes}
      disabled={!editable(r.status)}
      onChange={(n) => onNotesChange(i, n)}
    />
  );

  const matchBox = (r: PreviewRow, i: number) => (
    <PendingMatchBox row={r} onChange={(id) => onMergeChange(i, id)} />
  );

  return (
    <div
      className={`border-t border-line md:overflow-x-auto md:overflow-y-auto md:overscroll-contain ${maxHeightClass}`}
    >
      {/* Wide screens: the full table. */}
      <table className="hidden w-full text-sm md:table">
        <thead className="sticky top-0 z-[1] bg-surface text-left text-xs text-fg-3 shadow-[inset_0_-1px_0_var(--mp-border-1)]">
          <tr>
            <th className="py-2.5 pl-5 pr-3 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Description &amp; note</th>
            {showAccount && <th className="px-3 py-2 font-medium">Acct</th>}
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="py-2.5 pl-3 pr-5 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={cx("border-t border-line first:border-t-0", !editable(r.status) && "text-fg-2 opacity-70")}
            >
              <td className="py-2 pl-5 pr-3 align-top">
                <StatusBadge row={r} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">
                {r.txnDate ? formatDate(r.txnDate) : "—"}
              </td>
              <td className="max-w-xs px-3 py-2 align-top">
                <div className="truncate" title={r.description}>
                  {r.description}
                </div>
                {noteCell(r, i)}
                {matchBox(r, i)}
              </td>
              {showAccount && <td className="px-3 py-2 align-top font-mono text-xs text-fg-2">{r.accountNumber || "—"}</td>}
              <td className="px-3 py-2 align-top">{categoryCell(r, i)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                <Amount row={r} />
              </td>
              <td className="py-2 pl-3 pr-5 align-top text-fg-3">{r.direction}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Phones: one card per row. Same state, second rendering — nothing dropped. */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r, i) => (
          <li key={i} className={cx("space-y-1.5 px-3.5 py-3", !editable(r.status) && "opacity-70")}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium break-words" title={r.description}>
                  {r.description}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums text-fg-3">
                  <StatusBadge row={r} />
                  <span>{r.txnDate ? formatDate(r.txnDate) : "no date"}</span>
                  {showAccount && <span>· {r.accountNumber || "no account"}</span>}
                  <span>· {r.direction}</span>
                </div>
              </div>
              <div className="shrink-0 text-right font-medium">
                <Amount row={r} />
              </div>
            </div>
            {/* An error row can't be imported, so say why rather than leaving a bare badge. */}
            {r.error && <div className="text-xs text-over">{r.error}</div>}
            {matchBox(r, i)}
            {noteCell(r, i)}
            {categoryCell(r, i)}
          </li>
        ))}
      </ul>
    </div>
  );
}

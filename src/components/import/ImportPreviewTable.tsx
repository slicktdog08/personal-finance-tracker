"use client";

import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { PreviewRow } from "@/server/lib/import-types";
import type { CategoryOption } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";
import { ImportCategoryCell } from "@/components/import/ImportCategoryCell";
import { ImportNoteCell } from "@/components/import/ImportNoteCell";
import type { RuleSavedEvent } from "@/components/transactions/RuleEditor";

const STATUS_BADGE: Record<string, string> = {
  new: "bg-green-100 text-green-800 border-green-200",
  duplicate: "bg-yellow-100 text-yellow-800 border-yellow-200",
  // The posted version of a pending row entered by hand: settles it instead of duplicating.
  finalizes: "bg-blue-100 text-blue-800 border-blue-200",
  error: "bg-red-100 text-red-800 border-red-200",
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
  return (
    <span
      title={title}
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[row.status]}`}
    >
      {row.status === "finalizes" ? `settles #${row.pendingMatchId}` : row.status}
    </span>
  );
}

function Amount({ row }: { row: PreviewRow }) {
  return (
    <>
      {row.direction === "Credit" ? "+" : "−"}
      {formatMoney(row.amount)}
    </>
  );
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
      className={`mt-1 flex items-start gap-1.5 rounded border px-1.5 py-1 text-xs cursor-pointer select-none ${
        checked
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-neutral-200 text-neutral-500 dark:border-neutral-800"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? m.id : null)}
        className="mt-0.5 h-3.5 w-3.5 accent-amber-600"
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

const amountCls = (row: PreviewRow) =>
  `tabular-nums ${row.direction === "Credit" ? "text-green-600 dark:text-green-400" : ""}`;

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
      className={`rounded-lg border border-neutral-200 dark:border-neutral-800 md:overflow-x-auto md:overflow-y-auto md:overscroll-contain ${maxHeightClass}`}
    >
      {/* Wide screens: the full table. */}
      <table className="hidden md:table w-full text-sm">
        <thead className="bg-neutral-100 dark:bg-neutral-900 text-left sticky top-0">
          <tr>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Description &amp; note</th>
            {showAccount && <th className="px-3 py-2 font-medium">Acct</th>}
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={`border-t border-neutral-200 dark:border-neutral-800 ${
                !editable(r.status) ? "opacity-60" : ""
              }`}
            >
              <td className="px-3 py-1.5">
                <StatusBadge row={r} />
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                {r.txnDate ? formatDate(r.txnDate) : "—"}
              </td>
              <td className="px-3 py-1.5 max-w-xs align-top">
                <div className="truncate" title={r.description}>
                  {r.description}
                </div>
                {noteCell(r, i)}
                {matchBox(r, i)}
              </td>
              {showAccount && <td className="px-3 py-1.5">{r.accountNumber || "—"}</td>}
              <td className="px-3 py-1.5">{categoryCell(r, i)}</td>
              <td className={`px-3 py-1.5 text-right ${amountCls(r)}`}>
                <Amount row={r} />
              </td>
              <td className="px-3 py-1.5">{r.direction}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Phones: one card per row. Same state, second rendering — nothing dropped. */}
      <ul className="md:hidden divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows.map((r, i) => (
          <li key={i} className={`p-3 space-y-1.5 ${!editable(r.status) ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium break-words" title={r.description}>
                  {r.description}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-500 tabular-nums">
                  <StatusBadge row={r} />
                  <span>{r.txnDate ? formatDate(r.txnDate) : "no date"}</span>
                  {showAccount && <span>· {r.accountNumber || "no account"}</span>}
                  <span>· {r.direction}</span>
                </div>
              </div>
              <div className={`shrink-0 text-right font-medium ${amountCls(r)}`}>
                <Amount row={r} />
              </div>
            </div>
            {/* An error row can't be imported, so say why rather than leaving a bare badge. */}
            {r.error && <div className="text-xs text-red-600 dark:text-red-400">{r.error}</div>}
            {matchBox(r, i)}
            {noteCell(r, i)}
            {categoryCell(r, i)}
          </li>
        ))}
      </ul>
    </div>
  );
}

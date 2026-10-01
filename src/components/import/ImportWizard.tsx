"use client";

import { useState, useTransition } from "react";
import { FileDropzone } from "@/components/import/FileDropzone";
import { inspectCsv, analyzeWithMapping, commitImport } from "@/server/actions/import";
import { resyncTransactionPeriods } from "@/server/actions/transactions";
import type {
  ColumnMapping,
  InspectResult,
  PreviewResult,
  PreviewRow,
  BalanceSnapshot,
  CommitResult,
} from "@/server/lib/import-types";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { CategoryOption } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";
import { ImportPreviewTable } from "@/components/import/ImportPreviewTable";
import type { RuleSavedEvent } from "@/components/transactions/RuleEditor";
import {
  applyRuleToRows,
  reconcileRuleInRows,
  clearRuleFromRows,
  upsertRuleInList,
} from "@/components/import/rule-helpers";

interface Account {
  id: number;
  accountNumber: string;
  label: string | null;
}

export function ImportWizard({
  accounts,
  categoryOptions,
  rules: initialRules,
}: {
  accounts: Account[];
  categoryOptions: CategoryOption[];
  rules: CategoryRule[];
}) {
  const [phase, setPhase] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [filename, setFilename] = useState("");
  const [csvText, setCsvText] = useState("");
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [balances, setBalances] = useState<BalanceSnapshot[]>([]);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Saved rules, kept current as rules are created/edited from the review table so
  // the "set by rule" chips and local re-application stay accurate without a reload.
  const [rules, setRules] = useState<CategoryRule[]>(initialRules);
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);

  function onRuleSaved(e: RuleSavedEvent) {
    const known = rules.some((r) => r.id === e.rule.id);
    setRules((l) => upsertRuleInList(l, e.rule));
    setRows((prev) => (known ? reconcileRuleInRows(prev, e.rule) : applyRuleToRows(prev, e.rule)));
    setRuleMsg(e.message);
  }
  function onRuleDeleted(id: number, cleared: number) {
    setRules((l) => l.filter((r) => r.id !== id));
    setRows((prev) => clearRuleFromRows(prev, id));
    setRuleMsg(
      cleared
        ? `Rule removed; ${cleared} transaction${cleared === 1 ? "" : "s"} it had categorized are uncategorized again.`
        : "Rule removed.",
    );
  }

  const set = (patch: Partial<ColumnMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setFilename(file.name);
    const text = await file.text();
    setCsvText(text);
    start(async () => {
      try {
        const ins = await inspectCsv(text);
        setInspect(ins);
        setMapping(ins.suggestion);
        setPhase("map");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function canAnalyze(m: ColumnMapping) {
    if (!m.date || !m.description) return false;
    if (m.amountMode === "split") {
      if (!m.debitColumn || !m.creditColumn) return false;
    } else {
      if (!m.amount) return false;
      if (m.directionMode === "column" && !m.directionColumn) return false;
    }
    if (m.accountMode === "fixed" && !(m.fixedAccountNumber ?? "").trim()) return false;
    if (m.accountMode === "column" && !m.accountColumn) return false;
    return true;
  }

  function analyze() {
    if (!mapping || !canAnalyze(mapping)) return;
    start(async () => {
      try {
        const res = await analyzeWithMapping(csvText, filename, mapping);
        setPreview(res);
        setRows(res.rows);
        setBalances(res.balances);
        setPhase("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function commit() {
    start(async () => {
      try {
        const res = await commitImport(filename, rows, balances);
        setResult(res);
        setPreview(null);
        setRows([]);
        setBalances([]);
        setPhase("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reset() {
    setPhase("upload");
    setInspect(null);
    setMapping(null);
    setPreview(null);
    setRows([]);
    setBalances([]);
    setFilename("");
    setCsvText("");
    setError(null);
  }

  const headerOptions = (inspect?.headers ?? []).map((h) => (
    <option key={h} value={h}>
      {h}
    </option>
  ));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Import transactions</h1>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() =>
              start(async () => {
                const n = await resyncTransactionPeriods();
                setResyncMsg(`Linked ${n} transaction${n === 1 ? "" : "s"} to their month.`);
              })
            }
            disabled={pending}
            className="px-3 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            Re-sync transactions ↔ months
          </button>
          {resyncMsg && <span className="text-neutral-500">{resyncMsg}</span>}
        </div>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {(["upload", "map", "preview", "done"] as const).map((p, i) => (
          <span key={p} className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-full ${
                phase === p ? "bg-blue-600 text-white" : "bg-neutral-200 dark:bg-neutral-800"
              }`}
            >
              {i + 1}. {p}
            </span>
            {i < 3 && <span>→</span>}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {ruleMsg && (
        <div className="rounded border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 text-sm text-green-700 dark:text-green-300 flex items-start justify-between gap-2">
          <span>{ruleMsg}</span>
          <button onClick={() => setRuleMsg(null)} className="text-xs hover:underline">
            dismiss
          </button>
        </div>
      )}

      {/* Step 1: upload */}
      {phase === "upload" && (
        <FileDropzone
          accept=".csv,text/csv"
          disabled={pending}
          pending={pending}
          pendingLabel="Reading…"
          title="Drag &amp; drop a bank CSV, or"
          hint="You'll map its columns next — works even with no account column or an odd “Type” field."
          onFiles={(files) => onFile(files[0])}
        />
      )}

      {/* Step 2: map columns */}
      {phase === "map" && inspect && mapping && (
        <div className="space-y-5">
          <div className="text-sm text-neutral-500">
            <strong>{filename}</strong> · {inspect.rowCount} rows · {inspect.headers.length} columns
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <MapField label="Date column *">
              <select value={mapping.date} onChange={(e) => set({ date: e.target.value })} className={inputCls}>
                {headerOptions}
              </select>
            </MapField>
            <MapField label="Description column *">
              <select
                value={mapping.description}
                onChange={(e) => set({ description: e.target.value })}
                className={inputCls}
              >
                {headerOptions}
              </select>
            </MapField>
            <MapField label="Net amount (optional)">
              <select
                value={mapping.netAmount ?? ""}
                onChange={(e) => set({ netAmount: e.target.value || undefined })}
                className={inputCls}
              >
                <option value="">— none —</option>
                {headerOptions}
              </select>
            </MapField>
            <MapField label="Source category (optional)">
              <select
                value={mapping.category ?? ""}
                onChange={(e) => set({ category: e.target.value || undefined })}
                className={inputCls}
              >
                <option value="">— none —</option>
                {headerOptions}
              </select>
            </MapField>
            <MapField label="Available balance (optional)">
              <select
                value={mapping.balanceColumn ?? ""}
                onChange={(e) => set({ balanceColumn: e.target.value || undefined })}
                className={inputCls}
              >
                <option value="">— none —</option>
                {headerOptions}
              </select>
              <span className="text-xs text-neutral-500">
                Records the available balance into each account&apos;s balance ledger (one snapshot
                per account per day).
              </span>
            </MapField>
          </div>

          {/* Account */}
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 space-y-2">
            <div className="font-medium text-sm">Account</div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={mapping.accountMode === "fixed"}
                  onChange={() => set({ accountMode: "fixed" })}
                />
                Same account for all rows
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={mapping.accountMode === "column"}
                  onChange={() => set({ accountMode: "column" })}
                />
                From a column
              </label>
            </div>
            {mapping.accountMode === "fixed" ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={mapping.fixedAccountNumber ?? ""}
                  onChange={(e) => set({ fixedAccountNumber: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— pick account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.accountNumber}>
                      {a.label ? `${a.label} (${a.accountNumber})` : `••${a.accountNumber}`}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-neutral-500">or type a new last-4:</span>
                <input
                  value={
                    accounts.some((a) => a.accountNumber === mapping.fixedAccountNumber)
                      ? ""
                      : mapping.fixedAccountNumber ?? ""
                  }
                  onChange={(e) => set({ fixedAccountNumber: e.target.value })}
                  placeholder="e.g. 1234"
                  className={inputCls + " w-24"}
                />
              </div>
            ) : (
              <select
                value={mapping.accountColumn ?? ""}
                onChange={(e) => set({ accountColumn: e.target.value || undefined })}
                className={inputCls}
              >
                <option value="">— pick column —</option>
                {headerOptions}
              </select>
            )}
          </div>

          {/* Amount & direction */}
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 space-y-2">
            <div className="font-medium text-sm">Amount &amp; direction (money in vs out)</div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={mapping.amountMode !== "split" && mapping.directionMode === "sign"}
                  onChange={() => set({ amountMode: "single", directionMode: "sign" })}
                />
                One amount column, +/− sign
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={mapping.amountMode !== "split" && mapping.directionMode === "column"}
                  onChange={() => set({ amountMode: "single", directionMode: "column" })}
                />
                Amount + a Debit/Credit label column
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={mapping.amountMode === "split"}
                  onChange={() => set({ amountMode: "split" })}
                />
                Separate Debit &amp; Credit columns
              </label>
            </div>
            {mapping.amountMode === "split" ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <MapField label="Debit column (money out) *">
                  <select
                    value={mapping.debitColumn ?? ""}
                    onChange={(e) => set({ debitColumn: e.target.value || undefined })}
                    className={inputCls}
                  >
                    <option value="">— pick column —</option>
                    {headerOptions}
                  </select>
                </MapField>
                <MapField label="Credit column (money in) *">
                  <select
                    value={mapping.creditColumn ?? ""}
                    onChange={(e) => set({ creditColumn: e.target.value || undefined })}
                    className={inputCls}
                  >
                    <option value="">— pick column —</option>
                    {headerOptions}
                  </select>
                </MapField>
              </div>
            ) : (
              <div className="space-y-2">
                <MapField label="Amount column *">
                  <select
                    value={mapping.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">— pick column —</option>
                    {headerOptions}
                  </select>
                </MapField>
                {mapping.directionMode === "sign" ? (
                  <label className="text-sm flex items-center gap-2">
                    A negative amount means
                    <select
                      value={mapping.negativeIs}
                      onChange={(e) => set({ negativeIs: e.target.value as "Debit" | "Credit" })}
                      className={inputCls}
                    >
                      <option value="Debit">Debit (money out / charge)</option>
                      <option value="Credit">Credit (money in)</option>
                    </select>
                  </label>
                ) : (
                  <select
                    value={mapping.directionColumn ?? ""}
                    onChange={(e) => set({ directionColumn: e.target.value || undefined })}
                    className={inputCls}
                  >
                    <option value="">— pick Debit/Credit column —</option>
                    {headerOptions}
                  </select>
                )}
              </div>
            )}
            <p className="text-xs text-neutral-500">
              Tip: many bank exports use one signed amount (keep the first option, negative =
              Debit). Capital One and similar put the amount in a separate <strong>Debit</strong> or{" "}
              <strong>Credit</strong> column — use the third option. A taxonomy column like
              Chase&apos;s &ldquo;Type&rdquo; (Sale/Payment/Fee) is not a direction — leave it
              unmapped.
            </p>
          </div>

          {/* Sample preview */}
          {inspect.sample.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100 dark:bg-neutral-900 text-left">
                  <tr>
                    {inspect.headers.map((h) => (
                      <th key={h} className="px-2 py-1 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspect.sample.map((r, i) => (
                    <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
                      {inspect.headers.map((h) => (
                        <td key={h} className="px-2 py-1 whitespace-nowrap max-w-48 truncate">
                          {r[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-sm text-neutral-500 hover:underline">
              ← Start over
            </button>
            <button
              onClick={analyze}
              disabled={pending || !canAnalyze(mapping)}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Analyzing…" : "Analyze →"}
            </button>
            {!canAnalyze(mapping) && (
              <span className="text-xs text-amber-600">
                Map date, description, the amount (or Debit/Credit columns), and pick an account.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Step 3: preview */}
      {phase === "preview" && preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm">
              <strong>{filename}</strong> — {preview.total} rows ·{" "}
              <span className="text-green-700">{preview.newCount} new</span> ·{" "}
              <span className="text-yellow-700">{preview.duplicateCount} duplicates</span> ·{" "}
              {preview.finalizeCount ? (
                <>
                  <span className="text-blue-700">{preview.finalizeCount} settle pending</span> ·{" "}
                </>
              ) : null}
              <span className="text-red-700">{preview.errorCount} errors</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPhase("map")} className="px-3 py-1.5 text-sm text-neutral-500 hover:underline">
                ← Back to mapping
              </button>
              <button
                onClick={commit}
                // Settling pending rows and recording balances are work too — a file of only
                // duplicates and pending settles must still be importable.
                disabled={pending || (preview.newCount === 0 && !preview.finalizeCount && balances.length === 0)}
                className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {pending ? "Importing…" : importLabel(preview.newCount, preview.finalizeCount ?? 0, balances.length)}
              </button>
            </div>
          </div>

          <p className="text-xs text-neutral-500">
            Tip: set a category, and use <span className="text-neutral-400">+ note</span> under a
            description to add a comment — both save with the transaction when you import.
          </p>

          {balances.length > 0 && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm">
              <div className="font-medium text-blue-800 dark:text-blue-200">
                {balances.length} balance snapshot{balances.length === 1 ? "" : "s"} to record
              </div>
              <div className="text-blue-700 dark:text-blue-300 mt-1 text-xs">
                End-of-day balance per account per day, written to the account balance ledger. Ones
                already recorded for that account &amp; date are skipped.
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                {balances.slice(0, 12).map((b) => (
                  <span key={`${b.accountNumber}-${b.asOf}`} className="text-blue-700 dark:text-blue-300">
                    {b.accountNumber || "—"} · {formatDate(b.asOf)} ·{" "}
                    <span className="font-medium">{formatMoney(b.balance)}</span>
                  </span>
                ))}
                {balances.length > 12 && (
                  <span className="text-blue-600">+{balances.length - 12} more</span>
                )}
              </div>
            </div>
          )}

          <ImportPreviewTable
            rows={rows}
            categoryOptions={categoryOptions}
            rules={rules}
            showAccount
            onCategoryChange={(i, c) =>
              setRows((prev) =>
                prev.map((x, idx) => (idx === i ? { ...x, category: c, categoryRuleId: null, categoryPicked: true } : x)),
              )
            }
            onNotesChange={(i, n) =>
              setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, notes: n } : x)))
            }
            onMergeChange={(i, id) =>
              setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, mergeWith: id } : x)))
            }
            onRuleSaved={onRuleSaved}
            onRuleDeleted={onRuleDeleted}
          />
        </div>
      )}

      {/* Step 4: done */}
      {phase === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-4">
            <div className="font-semibold text-green-800 dark:text-green-200">Import complete</div>
            <div className="text-sm text-green-700 dark:text-green-300 mt-1">
              Inserted {result.inserted}
              {result.finalized ? ` · settled ${result.finalized} pending` : ""} · skipped {result.duplicates} duplicates ·{" "}
              {result.errors} errors
              {result.merged ? ` · merged ${result.merged} into pending transaction${result.merged === 1 ? "" : "s"}` : ""}
              {result.balancesRecorded ? ` · recorded ${result.balancesRecorded} balance snapshot${result.balancesRecorded === 1 ? "" : "s"}` : ""}
              {result.batchId ? ` · batch #${result.batchId}` : ""}.
            </div>
            <div className="flex gap-3 mt-2 text-sm">
              <a href="/transactions" className="text-blue-600 hover:underline">
                View transactions →
              </a>
              <a href="/transactions/categorize" className="text-blue-600 hover:underline">
                Mass categorize →
              </a>
            </div>
          </div>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function MapField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function importLabel(newCount: number, settles: number, balances: number): string {
  const parts = [`Import ${newCount} new`];
  if (settles) parts.push(`settle ${settles} pending`);
  if (balances) parts.push(`${balances} balance${balances === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

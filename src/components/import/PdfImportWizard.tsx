"use client";

import { useState, useTransition } from "react";
import { FileDropzone } from "@/components/import/FileDropzone";
import {
  parsePdfStatements,
  analyzeStatement,
  commitPdfStatements,
} from "@/server/actions/pdf-import";
import type { ParsedStatement, CommitStatementInput, PdfCommitResult } from "@/server/lib/pdf/types";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { CategoryOption } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";
import type { PreviewRow } from "@/server/lib/import-types";
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

// Chunked base64 so large PDFs don't overflow String.fromCharCode's argument limit.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function PdfImportWizard({
  accounts,
  categoryOptions,
  rules: initialRules,
}: {
  accounts: Account[];
  categoryOptions: CategoryOption[];
  rules: CategoryRule[];
}) {
  const [phase, setPhase] = useState<"upload" | "review" | "done">("upload");
  const [stmts, setStmts] = useState<ParsedStatement[]>([]);
  // Per statement, per balance suggestion (opening/closing): whether to record it.
  const [recordBal, setRecordBal] = useState<boolean[][]>([]);
  const [result, setResult] = useState<PdfCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Saved rules, kept current as rules are created/edited from the review tables. A
  // rule is global, so a save from one statement re-applies across every statement.
  const [rules, setRules] = useState<CategoryRule[]>(initialRules);
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);
  const allRows = stmts.flatMap((s) => s.rows);

  function patchAllRows(fn: (rows: PreviewRow[]) => PreviewRow[]) {
    setStmts((prev) => prev.map((s) => ({ ...s, rows: fn(s.rows) })));
  }
  function onRuleSaved(e: RuleSavedEvent) {
    const known = rules.some((r) => r.id === e.rule.id);
    setRules((l) => upsertRuleInList(l, e.rule));
    patchAllRows((rows) => (known ? reconcileRuleInRows(rows, e.rule) : applyRuleToRows(rows, e.rule)));
    setRuleMsg(e.message);
  }
  function onRuleDeleted(id: number, cleared: number) {
    setRules((l) => l.filter((r) => r.id !== id));
    patchAllRows((rows) => clearRuleFromRows(rows, id));
    setRuleMsg(
      cleared
        ? `Rule removed; ${cleared} transaction${cleared === 1 ? "" : "s"} it had categorized are uncategorized again.`
        : "Rule removed.",
    );
  }

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  async function onFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setResult(null);

    // Client-side guards so users get a clear message instead of an opaque Server Action
    // body-size rejection (base64 adds ~33%; the server cap is 25MB).
    const MAX_FILES = 12;
    const MAX_FILE_MB = 15;
    const MAX_TOTAL_MB = 18;
    if (files.length > MAX_FILES) {
      setError(`Too many files at once (${files.length}). Please upload ${MAX_FILES} or fewer.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" is over ${MAX_FILE_MB}MB. Split or compress it and try again.`);
      return;
    }
    const totalMB = files.reduce((n, f) => n + f.size, 0) / (1024 * 1024);
    if (totalMB > MAX_TOTAL_MB) {
      setError(
        `These files total ${totalMB.toFixed(1)}MB, over the ${MAX_TOTAL_MB}MB batch limit. Upload them in smaller batches.`,
      );
      return;
    }

    const payload = await Promise.all(
      files.map(async (f) => ({ name: f.name, dataB64: toBase64(await f.arrayBuffer()) })),
    );
    start(async () => {
      try {
        const parsed = await parsePdfStatements(payload);
        setStmts(parsed);
        setRecordBal(parsed.map((s) => s.balanceSuggestions.map(() => true)));
        setPhase("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function patchStmt(i: number, patch: Partial<ParsedStatement>) {
    setStmts((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function changeAccount(i: number, accountNumber: string) {
    patchStmt(i, { accountNumber });
    const stmt = stmts[i];
    if (!stmt || !stmt.detected) return;
    start(async () => {
      const a = await analyzeStatement({ txns: stmt.txns, accountNumber });
      setStmts((prev) =>
        prev.map((s, idx) => {
          // Stale-response guard: the free-text last-4 fires on every keystroke, so an
          // earlier (slower) analyze can resolve after a later one. Only apply if this
          // statement's account is still the one we analyzed for.
          if (idx !== i || s.accountNumber !== accountNumber) return s;
          // Rows align 1:1 by index with the prior analysis (same txns, same order), so
          // carry over any category the user had set rather than clobbering with rules.
          const rows = a.rows.map((r, j) => {
            const prev = s.rows[j];
            let withNote = prev?.notes ? { ...r, notes: prev.notes } : r;
            // Keep the user's merge choice when the re-analysis found the same pending match.
            if (prev?.pendingMatch && r.pendingMatch?.id === prev.pendingMatch.id) {
              withNote = { ...withNote, mergeWith: prev.mergeWith ?? null };
            }
            if (prev?.categoryPicked) {
              return { ...withNote, category: prev.category, categoryRuleId: null, categoryPicked: true };
            }
            return prev?.category != null
              ? { ...withNote, category: prev.category, categoryRuleId: prev.categoryRuleId ?? null }
              : withNote;
          });
          return {
            ...s,
            rows,
            total: a.total,
            newCount: a.newCount,
            duplicateCount: a.duplicateCount,
            finalizeCount: a.finalizeCount,
            errorCount: a.errorCount,
          };
        }),
      );
    });
  }

  // A hand-picked category is no longer "set by rule X" — drop the stamp with it.
  function setRowCategory(si: number, ri: number, category: string | null) {
    setStmts((prev) =>
      prev.map((s, idx) =>
        idx === si
          ? {
              ...s,
              rows: s.rows.map((r, j) =>
                j === ri ? { ...r, category, categoryRuleId: null, categoryPicked: true } : r,
              ),
            }
          : s,
      ),
    );
  }

  // The user's own commentary on a row, typed during review and written to the
  // transaction's notes at commit. Purely local until then — nothing to re-analyze.
  function setRowNotes(si: number, ri: number, notes: string | null) {
    setStmts((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, rows: s.rows.map((r, j) => (j === ri ? { ...r, notes } : r)) } : s,
      ),
    );
  }

  // Merge (or not) a matched hand-entered pending transaction into this row on commit.
  function setRowMerge(si: number, ri: number, mergeWith: number | null) {
    setStmts((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, rows: s.rows.map((r, j) => (j === ri ? { ...r, mergeWith } : r)) } : s,
      ),
    );
  }

  function patchBalance(i: number, k: number, patch: { balance?: number; asOf?: string }) {
    setStmts((prev) =>
      prev.map((s, idx) =>
        idx === i
          ? {
              ...s,
              balanceSuggestions: s.balanceSuggestions.map((b, j) =>
                j === k ? { ...b, ...patch } : b,
              ),
            }
          : s,
      ),
    );
  }

  function toggleBalance(i: number, k: number, on: boolean) {
    setRecordBal((prev) =>
      prev.map((arr, idx) => (idx === i ? arr.map((b, j) => (j === k ? on : b)) : arr)),
    );
  }

  const committable = stmts.filter((s) => s.detected);
  const totalNew = committable.reduce((n, s) => n + s.newCount, 0);
  const totalSettles = committable.reduce((n, s) => n + (s.finalizeCount ?? 0), 0);
  const totalBalances = committable.reduce((n, s) => {
    const idx = stmts.indexOf(s);
    return n + s.balanceSuggestions.filter((_, k) => recordBal[idx]?.[k]).length;
  }, 0);
  const missingAccount = committable.some((s) => !s.accountNumber.trim());

  function commit() {
    const inputs: CommitStatementInput[] = committable.map((s) => {
      const idx = stmts.indexOf(s);
      return {
        filename: s.filename,
        accountNumber: s.accountNumber.trim(),
        institution: s.institution,
        accountType: s.accountType,
        rows: s.rows,
        balances: s.balanceSuggestions.filter((_, k) => recordBal[idx]?.[k]),
      };
    });
    start(async () => {
      try {
        const res = await commitPdfStatements(inputs);
        setResult(res);
        setPhase("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reset() {
    setPhase("upload");
    setStmts([]);
    setRecordBal([]);
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Import from PDF statements</h2>
        <p className="text-sm text-neutral-500">
          For accounts that only give you PDF statements. Upload one or more at once — text is
          extracted directly (no OCR), transactions and the statement balance are captured.
        </p>
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

      {phase === "upload" && (
        <FileDropzone
          accept="application/pdf,.pdf"
          multiple
          disabled={pending}
          pending={pending}
          pendingLabel="Extracting…"
          title="Drag &amp; drop PDF statements, or"
          hint="Recognized formats are parsed automatically; unrecognized ones are flagged so a parser can be added."
          onFiles={onFiles}
        />
      )}

      {phase === "review" && (
        <div className="space-y-5">
          <p className="text-xs text-neutral-500">
            Tip: set a category, and use <span className="text-neutral-400">+ note</span> under a
            description to add a comment — both save with the transaction when you import.
          </p>
          {stmts.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 space-y-3"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-medium">
                  {s.filename}{" "}
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      s.detected
                        ? "bg-blue-100 text-blue-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {s.detected ? s.parserLabel : "Unrecognized format"}
                  </span>
                </div>
                <div className="text-xs text-neutral-500">
                  {s.pageCount} page{s.pageCount === 1 ? "" : "s"}
                </div>
              </div>

              {!s.detected ? (
                <div className="space-y-2">
                  <p className="text-sm text-amber-600">
                    No parser matched this statement. Adding one is ~40 lines (see
                    src/server/lib/pdf/parsers). First lines extracted:
                  </p>
                  <pre className="text-xs bg-neutral-100 dark:bg-neutral-900 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {s.sampleLines.join("\n")}
                  </pre>
                </div>
              ) : (
                <>
                  {/* Account + period + balance */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-500">Account *</span>
                      <div className="flex items-center gap-2">
                        <select
                          value={accounts.some((a) => a.accountNumber === s.accountNumber) ? s.accountNumber : ""}
                          onChange={(e) => changeAccount(i, e.target.value)}
                          className={inputCls}
                        >
                          <option value="">— pick / type —</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.accountNumber}>
                              {a.label ? `${a.label} (${a.accountNumber})` : `••${a.accountNumber}`}
                            </option>
                          ))}
                        </select>
                        <input
                          value={accounts.some((a) => a.accountNumber === s.accountNumber) ? "" : s.accountNumber}
                          onChange={(e) => changeAccount(i, e.target.value)}
                          placeholder="last-4"
                          className={inputCls + " w-24"}
                        />
                      </div>
                      {s.institution && (
                        <span className="text-xs text-neutral-400">
                          detected: {s.institution}
                          {s.accountType ? ` · ${s.accountType}` : ""}
                        </span>
                      )}
                    </label>

                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-500">Statement period</span>
                      <span className="tabular-nums">
                        {s.periodStart ? formatDate(s.periodStart) : "?"} —{" "}
                        {s.periodEnd ? formatDate(s.periodEnd) : "?"}
                      </span>
                      <span className="text-xs text-neutral-400">
                        opening {formatMoney(s.openingBalance)} · closing{" "}
                        {formatMoney(s.closingBalance)}
                      </span>
                    </div>

                    {s.balanceSuggestions.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-500">Record balance snapshots</span>
                        {s.balanceSuggestions.map((bal, k) => (
                          <div key={bal.kind} className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-xs text-neutral-500 w-20 shrink-0">
                              <input
                                type="checkbox"
                                checked={recordBal[i]?.[k] ?? false}
                                onChange={(e) => toggleBalance(i, k, e.target.checked)}
                              />
                              {bal.kind === "opening" ? "Opening" : "Closing"}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={bal.balance}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "") return; // ignore transient empty; don't write $0
                                const n = Number(v);
                                if (Number.isFinite(n)) patchBalance(i, k, { balance: n });
                              }}
                              disabled={!recordBal[i]?.[k]}
                              className={inputCls + " w-24"}
                            />
                            <input
                              type="date"
                              value={bal.asOf}
                              onChange={(e) => patchBalance(i, k, { asOf: e.target.value })}
                              disabled={!recordBal[i]?.[k]}
                              className={inputCls}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-sm">
                    {s.total} rows · <span className="text-green-700">{s.newCount} new</span> ·{" "}
                    <span className="text-yellow-700">{s.duplicateCount} duplicates</span> ·{" "}
                    {s.finalizeCount ? (
                      <>
                        <span className="text-blue-700">{s.finalizeCount} settle pending</span> ·{" "}
                      </>
                    ) : null}
                    <span className="text-red-700">{s.errorCount} errors</span>
                  </div>

                  {s.rows.length > 0 && (
                    <ImportPreviewTable
                      rows={s.rows}
                      allRows={allRows}
                      categoryOptions={categoryOptions}
                      rules={rules}
                      maxHeightClass="md:max-h-[40vh]"
                      onCategoryChange={(ri, c) => setRowCategory(i, ri, c)}
                      onNotesChange={(ri, n) => setRowNotes(i, ri, n)}
                      onMergeChange={(ri, id) => setRowMerge(i, ri, id)}
                      onRuleSaved={onRuleSaved}
                      onRuleDeleted={onRuleDeleted}
                    />
                  )}

                  {s.notes.length > 0 && (
                    <details className="text-xs text-neutral-500">
                      <summary className="cursor-pointer">{s.notes.length} parser note(s)</summary>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        {s.notes.map((n, ni) => (
                          <li key={ni}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={reset} className="px-3 py-1.5 text-sm text-neutral-500 hover:underline">
              ← Start over
            </button>
            <button
              onClick={commit}
              disabled={pending || (totalNew === 0 && totalSettles === 0 && totalBalances === 0) || missingAccount}
              className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {pending
                ? "Importing…"
                : `Import ${totalNew} new${totalSettles ? ` · settle ${totalSettles} pending` : ""}${totalBalances ? ` · ${totalBalances} balance${totalBalances === 1 ? "" : "s"}` : ""}`}
            </button>
            {missingAccount && (
              <span className="text-xs text-amber-600">Pick an account for every statement.</span>
            )}
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-4">
            <div className="font-semibold text-green-800 dark:text-green-200">Import complete</div>
            <div className="text-sm text-green-700 dark:text-green-300 mt-1">
              {result.statements} statement{result.statements === 1 ? "" : "s"} · inserted{" "}
              {result.inserted}
              {result.finalized ? ` · settled ${result.finalized} pending` : ""} · skipped {result.duplicates} duplicates ·{" "}
              {result.errors} errors ·{" "}
              {result.balancesRecorded} balance snapshot
              {result.balancesRecorded === 1 ? "" : "s"} recorded
              {result.merged
                ? ` · merged ${result.merged} into pending transaction${result.merged === 1 ? "" : "s"}`
                : ""}
              .
            </div>
            <div className="flex gap-3 mt-2 text-sm">
              <a href="/transactions" className="text-blue-600 hover:underline">
                View transactions →
              </a>
              <a href="/accounts" className="text-blue-600 hover:underline">
                View balances →
              </a>
            </div>
          </div>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Import more PDFs
          </button>
        </div>
      )}
    </div>
  );
}

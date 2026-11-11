"use client";

import { useState, useTransition } from "react";
import { FileDropzone } from "@/components/import/FileDropzone";
import {
  parsePdfStatements,
  analyzeStatement,
  commitPdfStatements,
} from "@/server/actions/pdf-import";
import type { ParsedStatement, CommitStatementInput, PdfCommitResult } from "@/server/lib/pdf/types";
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
import { Badge, Button, Card, Checkbox, EmptyState, Input, Money, Notice, Select, buttonClass } from "@/components/ds";
import { ImportSteps } from "@/components/import/ImportSteps";
import { reviewMeta } from "@/components/import/ImportWizard";
import Link from "next/link";

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
    <div className="space-y-5">
      <ImportSteps steps={["Upload", "Review", "Done"]} current={["upload", "review", "done"].indexOf(phase)} />

      {error && <Notice tone="danger">{error}</Notice>}
      {ruleMsg && (
        <Notice
          tone="ok"
          action={
            <Button size="sm" variant="ghost" onClick={() => setRuleMsg(null)}>
              Dismiss
            </Button>
          }
        >
          {ruleMsg}
        </Notice>
      )}

      {phase === "upload" && (
        <FileDropzone
          accept="application/pdf,.pdf"
          multiple
          disabled={pending}
          pending={pending}
          pendingLabel="Extracting…"
          title="Drop PDF statements here"
          hint="For accounts that only give you PDFs. Upload several at once; text is read directly (no OCR). Recognized formats parse automatically, others are flagged so a parser can be added."
          onFiles={onFiles}
        />
      )}

      {phase === "review" && (
        <div className="space-y-5">
          <p className="text-xs text-fg-3">
            Set a category, and use <span className="text-fg-2">+ note</span> under a description to add a comment; both save
            with the transaction when you import.
          </p>
          {stmts.map((s, i) => (
            <Card
              key={i}
              padded={false}
              title={`Review · ${s.filename}`}
              meta={
                s.detected
                  ? `${reviewMeta(s.newCount, s.duplicateCount, s.finalizeCount ?? 0, s.errorCount)} · ${s.pageCount} page${s.pageCount === 1 ? "" : "s"}`
                  : `${s.pageCount} page${s.pageCount === 1 ? "" : "s"}`
              }
              action={
                <Badge
                  label={s.detected ? s.parserLabel : "Unrecognized format"}
                  color={s.detected ? "#0ea5e9" : "#eab308"}
                  size="sm"
                />
              }
            >
              {!s.detected ? (
                <div className="space-y-2 px-5 pb-5 max-md:px-3.5">
                  <Notice tone="warn">
                    No parser matched this statement. Adding one is about 40 lines (see src/server/lib/pdf/parsers). First lines
                    extracted:
                  </Notice>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-panel bg-sunken p-2.5 text-xs">{s.sampleLines.join("\n")}</pre>
                </div>
              ) : (
                <>
                  {/* Account + period + balance */}
                  <div className="grid gap-4 px-5 pb-4 text-sm max-md:px-3.5 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="mp-field">
                      <span className="mp-field__label">
                        Account <span className="text-over">*</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <Select
                          aria-label="Account"
                          value={accounts.some((a) => a.accountNumber === s.accountNumber) ? s.accountNumber : ""}
                          onChange={(e) => changeAccount(i, e.target.value)}
                          className="min-w-0 flex-1"
                          options={[
                            { value: "", label: "Pick or type…" },
                            ...accounts.map((a) => ({
                              value: a.accountNumber,
                              label: a.label ? `${a.label} (${a.accountNumber})` : `••${a.accountNumber}`,
                            })),
                          ]}
                        />
                        <Input
                          aria-label="Account last four"
                          value={accounts.some((a) => a.accountNumber === s.accountNumber) ? "" : s.accountNumber}
                          onChange={(e) => changeAccount(i, e.target.value)}
                          placeholder="Last 4"
                          className="w-24 shrink-0"
                        />
                      </div>
                      {s.institution && (
                        <span className="mp-field__hint">
                          Detected: {s.institution}
                          {s.accountType ? ` · ${s.accountType}` : ""}
                        </span>
                      )}
                    </div>

                    <div className="mp-field">
                      <span className="mp-field__label">Statement period</span>
                      <span className="tabular-nums">
                        {s.periodStart ? formatDate(s.periodStart) : "?"} – {s.periodEnd ? formatDate(s.periodEnd) : "?"}
                      </span>
                      <span className="mp-field__hint">
                        Opening {s.openingBalance != null ? <Money value={s.openingBalance} kind="neutral" /> : "—"} · closing{" "}
                        {s.closingBalance != null ? <Money value={s.closingBalance} kind="neutral" /> : "—"}
                      </span>
                    </div>

                    {s.balanceSuggestions.length > 0 && (
                      <div className="mp-field">
                        <span className="mp-field__label">Record balance snapshots</span>
                        {s.balanceSuggestions.map((bal, k) => (
                          <div key={bal.kind} className="flex flex-wrap items-center gap-2">
                            <Checkbox
                              label={bal.kind === "opening" ? "Opening" : "Closing"}
                              checked={recordBal[i]?.[k] ?? false}
                              onChange={(e) => toggleBalance(i, k, e.target.checked)}
                              className="w-24 shrink-0 text-xs"
                            />
                            <Input
                              type="number"
                              step="0.01"
                              aria-label={`${bal.kind} balance`}
                              value={bal.balance}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "") return; // ignore transient empty; don't write $0
                                const n = Number(v);
                                if (Number.isFinite(n)) patchBalance(i, k, { balance: n });
                              }}
                              disabled={!recordBal[i]?.[k]}
                              className="!h-9 w-28"
                            />
                            <Input
                              type="date"
                              aria-label={`${bal.kind} balance date`}
                              value={bal.asOf}
                              onChange={(e) => patchBalance(i, k, { asOf: e.target.value })}
                              disabled={!recordBal[i]?.[k]}
                              className="!h-9 w-40"
                            />
                          </div>
                        ))}
                      </div>
                    )}
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
                    <details className="border-t border-line px-5 py-3 text-xs text-fg-3 max-md:px-3.5">
                      <summary className="cursor-pointer">
                        {s.notes.length} parser note{s.notes.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {s.notes.map((n, ni) => (
                          <li key={ni}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </Card>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" icon="arrow-left" onClick={reset}>
              Start over
            </Button>
            <Button
              icon="check"
              loading={pending}
              onClick={commit}
              disabled={pending || (totalNew === 0 && totalSettles === 0 && totalBalances === 0) || missingAccount}
            >
              {pending
                ? "Importing…"
                : `Import ${totalNew} new${totalSettles ? ` · settle ${totalSettles} pending` : ""}${totalBalances ? ` · ${totalBalances} balance${totalBalances === 1 ? "" : "s"}` : ""}`}
            </Button>
            {missingAccount && <span className="text-xs text-warn">Pick an account for every statement.</span>}
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <Card padded={false}>
          <EmptyState
            icon="circle-check"
            title="Import complete. Listo."
            body={
              <>
                {result.statements} statement{result.statements === 1 ? "" : "s"} · inserted {result.inserted}
                {result.finalized ? ` · settled ${result.finalized} pending` : ""} · skipped {result.duplicates} duplicates ·{" "}
                {result.errors} errors · {result.balancesRecorded} balance snapshot
                {result.balancesRecorded === 1 ? "" : "s"} recorded
                {result.merged ? ` · merged ${result.merged} into pending transaction${result.merged === 1 ? "" : "s"}` : ""}
                {result.billsLinked ? ` · linked ${result.billsLinked} to bills by rule` : ""}.
              </>
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/transactions" className={buttonClass({ variant: "secondary" })}>
                  View transactions
                </Link>
                <Link href="/accounts" className={buttonClass({ variant: "secondary" })}>
                  View balances
                </Link>
                <Button icon="upload" onClick={reset}>
                  Import more PDFs
                </Button>
              </div>
            }
          />
        </Card>
      )}
    </div>
  );
}

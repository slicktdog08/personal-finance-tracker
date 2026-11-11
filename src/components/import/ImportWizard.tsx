"use client";

import { useState, useTransition } from "react";
import { FileDropzone } from "@/components/import/FileDropzone";
import { inspectCsv, analyzeWithMapping, commitImport } from "@/server/actions/import";
import type {
  ColumnMapping,
  InspectResult,
  PreviewResult,
  PreviewRow,
  BalanceSnapshot,
  CommitResult,
} from "@/server/lib/import-types";
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
import { Button, Card, EmptyState, Input, Money, Notice, Segmented, Select, buttonClass, cx } from "@/components/ds";
import { ImportSteps } from "@/components/import/ImportSteps";
import Link from "next/link";

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

  const headers = inspect?.headers ?? [];
  // Column pickers: required ones list the headers; optional/unset ones lead with a blank.
  const cols = (blank?: string) => [...(blank ? [{ value: "", label: blank }] : []), ...headers.map((h) => ({ value: h, label: h }))];

  return (
    <div className="space-y-5">
      <ImportSteps steps={["Upload", "Map columns", "Review", "Done"]} current={["upload", "map", "preview", "done"].indexOf(phase)} />

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

      {/* Step 1: upload */}
      {phase === "upload" && (
        <FileDropzone
          accept=".csv,text/csv"
          disabled={pending}
          pending={pending}
          pendingLabel="Reading…"
          title="Drop a bank CSV here"
          hint="CSV from any bank. You map its columns next, so it works even with no account column or an odd Type field."
          onFiles={(files) => onFile(files[0])}
        />
      )}

      {/* Step 2: map columns */}
      {phase === "map" && inspect && mapping && (
        <Card
          title={`Map columns · ${filename}`}
          meta={`${inspect.rowCount} rows · ${inspect.headers.length} columns`}
          action={
            <Button size="sm" variant="ghost" icon="arrow-left" onClick={reset}>
              Start over
            </Button>
          }
        >
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MapField label="Date column" required>
                <Select value={mapping.date} onChange={(e) => set({ date: e.target.value })} options={cols()} />
              </MapField>
              <MapField label="Description column" required>
                <Select value={mapping.description} onChange={(e) => set({ description: e.target.value })} options={cols()} />
              </MapField>
              <MapField label="Net amount (optional)">
                <Select value={mapping.netAmount ?? ""} onChange={(e) => set({ netAmount: e.target.value || undefined })} options={cols("None")} />
              </MapField>
              <MapField label="Source category (optional)">
                <Select value={mapping.category ?? ""} onChange={(e) => set({ category: e.target.value || undefined })} options={cols("None")} />
              </MapField>
              <MapField
                label="Available balance (optional)"
                hint="Records the available balance into each account's balance ledger (one snapshot per account per day)."
              >
                <Select
                  value={mapping.balanceColumn ?? ""}
                  onChange={(e) => set({ balanceColumn: e.target.value || undefined })}
                  options={cols("None")}
                />
              </MapField>
            </div>

            {/* Account */}
            <section className="space-y-3 rounded-panel bg-sunken p-4">
              <div className="text-sm font-medium">Account</div>
              <Segmented
                label="Account source"
                value={mapping.accountMode}
                onChange={(v) => set({ accountMode: v })}
                options={[
                  { value: "fixed", label: "Same for all rows" },
                  { value: "column", label: "From a column" },
                ]}
              />
              {mapping.accountMode === "fixed" ? (
                <div className="flex flex-wrap items-end gap-3">
                  <MapField label="Pick an account" className="min-w-0 flex-1 basis-56">
                    <Select
                      value={accounts.some((a) => a.accountNumber === mapping.fixedAccountNumber) ? mapping.fixedAccountNumber ?? "" : ""}
                      onChange={(e) => set({ fixedAccountNumber: e.target.value })}
                      options={[
                        { value: "", label: "Choose…" },
                        ...accounts.map((a) => ({
                          value: a.accountNumber,
                          label: a.label ? `${a.label} (${a.accountNumber})` : `••${a.accountNumber}`,
                        })),
                      ]}
                    />
                  </MapField>
                  <MapField label="Or type a new last four" className="w-36">
                    <Input
                      value={
                        accounts.some((a) => a.accountNumber === mapping.fixedAccountNumber)
                          ? ""
                          : mapping.fixedAccountNumber ?? ""
                      }
                      onChange={(e) => set({ fixedAccountNumber: e.target.value })}
                      placeholder="e.g. 1234"
                    />
                  </MapField>
                </div>
              ) : (
                <MapField label="Account column" className="max-w-sm">
                  <Select
                    value={mapping.accountColumn ?? ""}
                    onChange={(e) => set({ accountColumn: e.target.value || undefined })}
                    options={cols("Choose a column…")}
                  />
                </MapField>
              )}
            </section>

            {/* Amount & direction */}
            <section className="space-y-3 rounded-panel bg-sunken p-4">
              <div className="text-sm font-medium">Amount and direction (money in vs out)</div>
              {/* Three long labels don't fit a phone row as a segmented control; radios wrap. */}
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm" role="radiogroup" aria-label="Amount layout">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="accent-[var(--mp-accent)]"
                    checked={mapping.amountMode !== "split" && mapping.directionMode === "sign"}
                    onChange={() => set({ amountMode: "single", directionMode: "sign" })}
                  />
                  One amount column, +/− sign
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="accent-[var(--mp-accent)]"
                    checked={mapping.amountMode !== "split" && mapping.directionMode === "column"}
                    onChange={() => set({ amountMode: "single", directionMode: "column" })}
                  />
                  Amount + a Debit/Credit label column
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="accent-[var(--mp-accent)]"
                    checked={mapping.amountMode === "split"}
                    onChange={() => set({ amountMode: "split" })}
                  />
                  Separate Debit and Credit columns
                </label>
              </div>
              {mapping.amountMode === "split" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <MapField label="Debit column (money out)" required>
                    <Select
                      value={mapping.debitColumn ?? ""}
                      onChange={(e) => set({ debitColumn: e.target.value || undefined })}
                      options={cols("Choose a column…")}
                    />
                  </MapField>
                  <MapField label="Credit column (money in)" required>
                    <Select
                      value={mapping.creditColumn ?? ""}
                      onChange={(e) => set({ creditColumn: e.target.value || undefined })}
                      options={cols("Choose a column…")}
                    />
                  </MapField>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <MapField label="Amount column" required>
                    <Select value={mapping.amount} onChange={(e) => set({ amount: e.target.value })} options={cols("Choose a column…")} />
                  </MapField>
                  {mapping.directionMode === "sign" ? (
                    <MapField label="A negative amount means">
                      <Select
                        value={mapping.negativeIs}
                        onChange={(e) => set({ negativeIs: e.target.value as "Debit" | "Credit" })}
                        options={[
                          { value: "Debit", label: "Debit (money out / charge)" },
                          { value: "Credit", label: "Credit (money in)" },
                        ]}
                      />
                    </MapField>
                  ) : (
                    <MapField label="Debit/Credit column" required>
                      <Select
                        value={mapping.directionColumn ?? ""}
                        onChange={(e) => set({ directionColumn: e.target.value || undefined })}
                        options={cols("Choose a column…")}
                      />
                    </MapField>
                  )}
                </div>
              )}
              <p className="text-xs text-fg-3">
                Tip: many bank exports use one signed amount (keep the first option, negative = Debit). Capital One and
                similar put the amount in a separate <strong>Debit</strong> or <strong>Credit</strong> column, so use the
                third option. A taxonomy column like Chase&apos;s &ldquo;Type&rdquo; (Sale/Payment/Fee) is not a direction;
                leave it unmapped.
              </p>
            </section>

            {/* Sample preview */}
            {inspect.sample.length > 0 && (
              <div className="overflow-x-auto rounded-panel border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-sunken text-left text-fg-3">
                    <tr>
                      {inspect.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inspect.sample.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {inspect.headers.map((h) => (
                          <td key={h} className="max-w-48 truncate whitespace-nowrap px-2.5 py-1.5">
                            {r[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button iconRight="arrow-right" loading={pending} onClick={analyze} disabled={pending || !canAnalyze(mapping)}>
                {pending ? "Analyzing…" : "Review rows"}
              </Button>
              {!canAnalyze(mapping) && (
                <span className="text-xs text-warn">Map date, description, the amount (or Debit/Credit columns), and pick an account.</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Step 3: preview */}
      {phase === "preview" && preview && (
        <Card
          padded={false}
          title={`Review · ${filename}`}
          meta={reviewMeta(preview.newCount, preview.duplicateCount, preview.finalizeCount ?? 0, preview.errorCount)}
          action={
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => setPhase("map")}>
                Back to mapping
              </Button>
              <Button
                size="sm"
                icon="check"
                loading={pending}
                onClick={commit}
                // Settling pending rows and recording balances are work too — a file of only
                // duplicates and pending settles must still be importable.
                disabled={pending || (preview.newCount === 0 && !preview.finalizeCount && balances.length === 0)}
              >
                {pending ? "Importing…" : importLabel(preview.newCount, preview.finalizeCount ?? 0, balances.length)}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 px-5 pb-3 max-md:px-3.5">
            <p className="text-xs text-fg-3">
              {preview.total} rows. Set a category, and use <span className="text-fg-2">+ note</span> under a description to add
              a comment; both save with the transaction when you import.
            </p>

            {balances.length > 0 && (
              <Notice tone="info" title={`${balances.length} balance snapshot${balances.length === 1 ? "" : "s"} to record`}>
                <div>
                  End-of-day balance per account per day, written to the account balance ledger. Ones already recorded for that
                  account and date are skipped.
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {balances.slice(0, 12).map((b) => (
                    <span key={`${b.accountNumber}-${b.asOf}`}>
                      {b.accountNumber || "—"} · {formatDate(b.asOf)} · <Money value={b.balance} kind="neutral" />
                    </span>
                  ))}
                  {balances.length > 12 && <span className="text-accent-text">+{balances.length - 12} more</span>}
                </div>
              </Notice>
            )}
          </div>

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
        </Card>
      )}

      {/* Step 4: done */}
      {phase === "done" && result && (
        <Card padded={false}>
          <EmptyState
            icon="circle-check"
            title="Import complete. Listo."
            body={
              <>
                Inserted {result.inserted}
                {result.finalized ? ` · settled ${result.finalized} pending` : ""} · skipped {result.duplicates} duplicates ·{" "}
                {result.errors} errors
                {result.merged ? ` · merged ${result.merged} into pending transaction${result.merged === 1 ? "" : "s"}` : ""}
                {result.billsLinked ? ` · linked ${result.billsLinked} to bills by rule` : ""}
                {result.balancesRecorded
                  ? ` · recorded ${result.balancesRecorded} balance snapshot${result.balancesRecorded === 1 ? "" : "s"}`
                  : ""}
                {result.batchId ? ` · batch #${result.batchId}` : ""}.
              </>
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/transactions" className={buttonClass({ variant: "secondary" })}>
                  View transactions
                </Link>
                <Link href="/transactions/categorize" className={buttonClass({ variant: "secondary" })}>
                  Mass categorize
                </Link>
                <Button icon="upload" onClick={reset}>
                  Import another file
                </Button>
              </div>
            }
          />
        </Card>
      )}
    </div>
  );
}

// A <label> wrapper (not ds Field, which is a div) so each picker is named by its label.
function MapField({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cx("mp-field", className)}>
      <span className="mp-field__label">
        {label}
        {required && <span className="text-over"> *</span>}
      </span>
      {children}
      {hint && <span className="mp-field__hint">{hint}</span>}
    </label>
  );
}

/** "4 new · 1 duplicate" — the review card's meta line. */
export function reviewMeta(newCount: number, dupes: number, settles: number, errors: number): string {
  const parts = [`${newCount} new`];
  if (dupes) parts.push(`${dupes} duplicate${dupes === 1 ? "" : "s"}`);
  if (settles) parts.push(`${settles} settle pending`);
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function importLabel(newCount: number, settles: number, balances: number): string {
  const parts = [`Import ${newCount} new`];
  if (settles) parts.push(`settle ${settles} pending`);
  if (balances) parts.push(`${balances} balance${balances === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

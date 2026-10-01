"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewCategorizeMatch,
  bulkCategorizeByMatch,
  applySavedRules,
  deleteCategoryRule,
} from "@/server/actions/categorize";
import type { MatchParams } from "@/server/lib/categorize-dto";
import type { Suggestion } from "@/server/lib/suggest";
import type { CategoryOption } from "@/server/queries";
import { describeRuleMatch, type CategoryRule } from "@/server/lib/categorize";
import { RuleEditor } from "@/components/transactions/RuleEditor";

export function MassCategorize({
  uncategorized,
  categoryOptions,
  suggestions,
  rules,
}: {
  uncategorized: number;
  categoryOptions: CategoryOption[];
  suggestions: Suggestion[];
  rules: CategoryRule[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);
  const [sugCat, setSugCat] = useState<Record<string, string>>(
    Object.fromEntries(suggestions.map((s) => [s.pattern, s.suggestedCategory ?? ""])),
  );
  const [donePatterns, setDonePatterns] = useState<Set<string>>(new Set());

  function applySuggestion(pattern: string) {
    const category = sugCat[pattern];
    if (!category) return;
    start(async () => {
      await bulkCategorizeByMatch({
        field: "description",
        matchType: "contains",
        pattern,
        onlyUncategorized: true,
        category,
        saveRule: true,
      });
      setDonePatterns((p) => new Set(p).add(pattern));
      router.refresh();
    });
  }

  const [autoMsg, setAutoMsg] = useState<string | null>(null);

  const [field, setField] = useState<"description" | "category">("description");
  const [matchType, setMatchType] = useState<"contains" | "equals" | "regex">("contains");
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [onlyUncat, setOnlyUncat] = useState(true);
  const [saveRule, setSaveRule] = useState(true);
  const [preview, setPreview] = useState<{ count: number; samples: string[] } | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const matchParams = (): MatchParams => ({ field, matchType, pattern, onlyUncategorized: onlyUncat });

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  function doPreview() {
    setApplyMsg(null);
    start(async () => {
      setPreview(await previewCategorizeMatch(matchParams()));
    });
  }
  function doApply() {
    if (!pattern.trim() || !category) return;
    start(async () => {
      const { updated: n } = await bulkCategorizeByMatch({ ...matchParams(), category, saveRule });
      setApplyMsg(`Updated ${n} transaction${n === 1 ? "" : "s"}${saveRule ? " and saved a rule" : ""}.`);
      setPreview(null);
      setPattern("");
      router.refresh();
    });
  }
  function doAutoApply() {
    start(async () => {
      const n = await applySavedRules(true);
      setAutoMsg(`Applied saved rules to ${n} uncategorized transaction${n === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  const visibleSuggestions = suggestions.filter((s) => !donePatterns.has(s.pattern));

  return (
    <div className="space-y-6">
      {/* Suggested rules */}
      <section className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Suggested rules</h2>
          <span className="text-xs text-neutral-500">
            from the most common uncategorized descriptions
          </span>
        </div>
        {visibleSuggestions.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No suggestions right now — nothing frequent left to categorize. 🎉
          </p>
        ) : (
          <div className="space-y-2">
            {visibleSuggestions.map((s) => (
              <div
                key={s.pattern}
                className="flex flex-wrap items-center gap-2 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-3 py-2"
                title={s.samples.join("\n")}
              >
                <span className="font-mono text-sm px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">
                  {s.pattern}
                </span>
                <span className="text-sm text-neutral-500">{s.matchCount} txns</span>
                <span className="text-xs text-neutral-400 truncate max-w-xs hidden sm:inline">
                  e.g. {s.samples[0]}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <select
                    value={sugCat[s.pattern] ?? ""}
                    onChange={(e) => setSugCat((m) => ({ ...m, [s.pattern]: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700"
                  >
                    <option value="">— pick category —</option>
                    {categoryOptions.filter((c) => c.active).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.emoji ? `${c.emoji} ` : ""}
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => applySuggestion(s.pattern)}
                    disabled={pending || !sugCat[s.pattern]}
                    className="px-3 py-1 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Apply{sugCat[s.pattern] ? ` (${s.matchCount})` : ""}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Applying a suggestion categorizes all matching uncategorized transactions and saves a
          reusable rule (description contains the pattern).
        </p>
      </section>

      {/* Auto-apply */}
      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
        <h2 className="font-semibold">Apply saved rules</h2>
        <p className="text-sm text-neutral-500">
          <strong>{uncategorized.toLocaleString()}</strong> transactions are currently
          uncategorized. Run all {rules.length} saved rule{rules.length === 1 ? "" : "s"} against
          them.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={doAutoApply}
            disabled={pending || rules.length === 0}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Apply {rules.length} rule{rules.length === 1 ? "" : "s"} to uncategorized
          </button>
          {autoMsg && <span className="text-sm text-green-600">{autoMsg}</span>}
        </div>
      </section>

      {/* Rule builder / bulk apply */}
      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
        <h2 className="font-semibold">Bulk categorize by match</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Match field">
            <select value={field} onChange={(e) => setField(e.target.value as typeof field)} className={inputCls}>
              <option value="description">Description</option>
              <option value="category">Current category</option>
            </select>
          </Field>
          <Field label="Type">
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as typeof matchType)}
              className={inputCls}
            >
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="regex">regex</option>
            </select>
          </Field>
          <Field label="Pattern">
            <input
              value={pattern}
              onChange={(e) => {
                setPattern(e.target.value);
                setPreview(null);
              }}
              placeholder="e.g. UBER"
              className={inputCls + " w-56"}
            />
          </Field>
          <Field label="Set category to">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              <option value="">— pick —</option>
              {categoryOptions.filter((c) => c.active).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={onlyUncat} onChange={(e) => setOnlyUncat(e.target.checked)} />
            Only uncategorized
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} />
            Save as reusable rule
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={doPreview}
            disabled={pending || !pattern.trim()}
            className="px-3 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            Preview
          </button>
          <button
            onClick={doApply}
            disabled={pending || !pattern.trim() || !category}
            className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Apply
          </button>
          {applyMsg && <span className="text-sm text-green-600">{applyMsg}</span>}
        </div>

        {preview && (
          <div className="rounded-md bg-neutral-100 dark:bg-neutral-900 p-3 text-sm space-y-1">
            <div className="font-medium">
              {preview.count.toLocaleString()} transaction{preview.count === 1 ? "" : "s"} match
            </div>
            {preview.samples.length > 0 && (
              <ul className="text-neutral-500 list-disc list-inside">
                {preview.samples.map((s, i) => (
                  <li key={i} className="truncate">
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Saved rules */}
      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="font-semibold">Saved rules ({rules.length})</h2>
          {ruleMsg && <span className="text-sm text-green-600">{ruleMsg}</span>}
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No rules yet. Check &ldquo;Save as reusable rule&rdquo; above to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 pr-3">Rule</th>
                  <th className="py-1 pr-3">→ Category</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 pr-3">{describeRuleMatch(r)}</td>
                    <td className="py-1 pr-3">{r.category}</td>
                    <td className="py-1 text-right whitespace-nowrap space-x-3">
                      <button
                        onClick={() => setEditing(r)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          start(async () => {
                            await deleteCategoryRule(r.id);
                            router.refresh();
                          })
                        }
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing && (
          <RuleEditor
            open
            onClose={() => setEditing(null)}
            categoryOptions={categoryOptions}
            mode={{ kind: "edit", rule: editing }}
            onSaved={(e) => {
              setRuleMsg(e.message);
              router.refresh();
            }}
            onDeleted={(_, cleared) => {
              setRuleMsg(
                cleared
                  ? `Rule removed; ${cleared} transaction${cleared === 1 ? "" : "s"} uncategorized again.`
                  : "Rule removed.",
              );
              router.refresh();
            }}
          />
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

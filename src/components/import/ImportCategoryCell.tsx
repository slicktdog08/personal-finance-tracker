"use client";

import { useRef, useState, useTransition } from "react";
import { RuleBadge } from "@/components/transactions/RuleBadge";
import { RuleEditor, type RuleSavedEvent } from "@/components/transactions/RuleEditor";
import { previewCategorizeMatch, bulkCategorizeByMatch } from "@/server/actions/categorize";
import { bestPhraseForDescription } from "@/server/lib/suggest";
import { countLocalMatches } from "@/components/import/rule-helpers";
import type { CategoryRule, RuleInput } from "@/server/lib/categorize";
import { settledCategory, settlesPending, type PreviewRow } from "@/server/lib/import-types";
import type { CategoryOption } from "@/server/queries";

// Category picker for one import-review row, with the same rule affordances as the
// transactions table: a "set by rule" chip when a saved rule picked the category,
// and — after you pick one by hand — an offer to turn it into a rule. Counts come
// from both the rows still on screen and the uncategorized rows already in the DB.
export function ImportCategoryCell({
  row,
  rows,
  categoryOptions,
  rules,
  disabled,
  onChange,
  onRuleSaved,
  onRuleDeleted,
}: {
  row: PreviewRow;
  /** Every row in the review (all statements), for on-screen match counts. */
  rows: PreviewRow[];
  categoryOptions: CategoryOption[];
  rules: CategoryRule[];
  disabled: boolean;
  onChange: (category: string | null) => void;
  onRuleSaved: (e: RuleSavedEvent) => void;
  onRuleDeleted: (ruleId: number, cleared: number) => void;
}) {
  const [pending, start] = useTransition();
  const [suggest, setSuggest] = useState<{
    pattern: string;
    category: string;
    fileCount: number;
    dbCount: number | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const editBtnRef = useRef<HTMLButtonElement>(null);

  // A row that settles a pending transaction is saved with that transaction's category (unless
  // one is picked here), so show that one rather than what the import guessed.
  const shown = settledCategory(row);
  const fromPending = settlesPending(row) && !row.categoryPicked && shown.category !== row.category;
  const rule = shown.categoryRuleId != null ? rules.find((r) => r.id === shown.categoryRuleId) : undefined;
  const localCount = (draft: RuleInput) =>
    countLocalMatches(
      rows.filter((r) => r !== row),
      draft,
    );

  function pick(category: string | null) {
    onChange(category);
    setSuggest(null);
    if (!category) return;
    // Best phrase from this description, scored against the other uncategorized rows on
    // screen. Seeding the list with the row itself guarantees a phrase even when nothing
    // else here matches — a rule is still worth saving for the next import.
    const others = rows
      .filter((r) => r !== row && r.status === "new" && !r.category)
      .map((r) => r.description);
    const best = bestPhraseForDescription(row.description, [row.description, ...others]);
    if (!best) return;
    const fileCount = Math.max(0, best.matchCount - 1);
    setSuggest({ pattern: best.pattern, category, fileCount, dbCount: null });
    start(async () => {
      try {
        const p = await previewCategorizeMatch({
          field: "description",
          matchType: "contains",
          pattern: best.pattern,
          onlyUncategorized: true,
        });
        setSuggest((s) => (s && s.pattern === best.pattern ? { ...s, dbCount: p.count } : s));
      } catch {
        // Count is decoration; the offer stands without it.
      }
    });
  }

  function saveSuggested() {
    if (!suggest) return;
    const s = suggest;
    start(async () => {
      const res = await bulkCategorizeByMatch({
        field: "description",
        matchType: "contains",
        pattern: s.pattern,
        onlyUncategorized: true,
        category: s.category,
        saveRule: true,
      });
      setSuggest(null);
      if (res.rule) {
        onRuleSaved({
          rule: res.rule,
          created: true,
          message: `Saved rule and categorized ${res.updated} existing transaction${res.updated === 1 ? "" : "s"}.`,
        });
      }
    });
  }

  const counts: string[] = [];
  if (suggest) {
    if (suggest.fileCount > 0) counts.push(`+${suggest.fileCount} here`);
    if (suggest.dbCount != null && suggest.dbCount > 0) counts.push(`+${suggest.dbCount} existing`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* 16px on phones so iOS doesn't zoom the page when the picker opens. */}
      <select
        value={shown.category ?? ""}
        onChange={(e) => pick(e.target.value || null)}
        title={fromPending ? "Kept from your pending entry — pick another to change it" : undefined}
        disabled={disabled || pending}
        className="bg-transparent border border-neutral-300 dark:border-neutral-700 rounded max-w-full px-2 py-1 text-base md:px-1 md:py-0.5 md:text-sm"
      >
        <option value="">— none —</option>
        {/* Active categories only, plus this row's current one (auto-mapped
            or disabled) so it isn't silently lost. */}
        {[
          ...categoryOptions
            .filter((c) => c.active || c.name === shown.category)
            .map((c) => ({ name: c.name, emoji: c.emoji })),
          ...(shown.category && !categoryOptions.some((c) => c.name === shown.category)
            ? [{ name: shown.category, emoji: null as string | null }]
            : []),
        ].map((c) => (
          <option key={c.name} value={c.name}>
            {c.emoji ? `${c.emoji} ` : ""}
            {c.name}
          </option>
        ))}
      </select>
      {fromPending && <span className="text-xs text-neutral-500">from pending</span>}
      {rule && (
        <RuleBadge
          rule={rule}
          currentCategory={shown.category}
          categoryOptions={categoryOptions}
          extraCount={localCount}
          extraLabel="on screen"
          onSaved={onRuleSaved}
          onDeleted={onRuleDeleted}
        />
      )}
      {/* Keeps to one line in a table cell; wraps inside a phone's card. */}
      {suggest && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 md:whitespace-nowrap">
          <button
            type="button"
            onClick={saveSuggested}
            disabled={pending}
            title={`Save rule: description contains "${suggest.pattern}" → ${suggest.category}. Applies to matching rows here and to uncategorized transactions already imported; future imports use it automatically.`}
            className="min-w-0 break-words text-xs text-blue-600 hover:underline text-left disabled:opacity-50"
          >
            Save rule “{suggest.pattern}”{counts.length ? ` (${counts.join(" · ")})` : ""} →
          </button>
          <button
            ref={editBtnRef}
            type="button"
            onClick={() => setEditing((o) => !o)}
            disabled={pending}
            title="Customize the pattern before saving the rule"
            aria-label="Customize rule"
            className="text-xs text-neutral-400 hover:text-blue-600 disabled:opacity-50"
          >
            ✎
          </button>
          <RuleEditor
            open={editing}
            onClose={() => setEditing(false)}
            anchorRef={editBtnRef}
            categoryOptions={categoryOptions}
            mode={{ kind: "create", pattern: suggest.pattern, category: suggest.category }}
            extraCount={localCount}
            extraLabel="on screen"
            onSaved={(e) => {
              setSuggest(null);
              onRuleSaved(e);
            }}
          />
        </span>
      )}
    </div>
  );
}

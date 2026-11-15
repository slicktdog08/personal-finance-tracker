"use client";

import { useRef, useState, useTransition } from "react";
import { RuleBadge } from "@/components/transactions/RuleBadge";
import { RuleEditor, type RuleSavedEvent } from "@/components/transactions/RuleEditor";
import { previewCategorizeMatch, createRule } from "@/server/actions/categorize";
import { suggestRule } from "@/server/lib/suggest";
import { countLocalMatches } from "@/components/import/rule-helpers";
import type { CategoryRule, RuleInput } from "@/server/lib/categorize";
import { settledCategory, settlesPending, type PreviewRow } from "@/server/lib/import-types";
import type { CategoryOption } from "@/server/queries";
import { ColorSelect } from "@/components/ColorSelect";
import { Icon } from "@/components/ds";

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
    // The merchant phrase from this description, read against the other rows on screen (their
    // cities and store numbers tell it what to leave out). There's always an offer, even when
    // nothing else here matches — a rule is still worth saving for the next import.
    const others = rows.filter((r) => r !== row && r.status === "new");
    const best = suggestRule(
      row.description,
      others.map((r) => ({ description: r.description, category: r.category })),
      category,
    );
    if (!best.pattern) return;
    const fileCount = best.matchCount;
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
      const res = await createRule({
        field: "description",
        matchType: "contains",
        pattern: s.pattern,
        accountId: null,
        direction: null,
        amountMin: null,
        amountMax: null,
        category: s.category,
        billId: null,
      });
      setSuggest(null);
      onRuleSaved({
        rule: res.rule,
        created: true,
        message: `Saved rule and categorized ${res.categorized} existing transaction${res.categorized === 1 ? "" : "s"}.`,
      });
    });
  }

  const counts: string[] = [];
  if (suggest) {
    if (suggest.fileCount > 0) counts.push(`+${suggest.fileCount} here`);
    if (suggest.dbCount != null && suggest.dbCount > 0) counts.push(`+${suggest.dbCount} existing`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* A category is a colored thing, so it's picked from its own badge (ColorSelect), never a
          plain <select>. Active categories only, plus this row's current one (auto-mapped or
          disabled) so it isn't silently lost. */}
      <ColorSelect
        value={shown.category ?? ""}
        onSelect={(name) => pick(name || null)}
        allowEmpty
        placeholder="Choose category"
        disabled={disabled || pending}
        options={[
          ...categoryOptions
            .filter((c) => c.active || c.name === shown.category)
            .map((c) => ({ name: c.name, color: c.color, emoji: c.emoji })),
          ...(shown.category && !categoryOptions.some((c) => c.name === shown.category)
            ? [{ name: shown.category, color: "#64748b", emoji: null as string | null }]
            : []),
        ]}
      />
      {fromPending && (
        <span className="text-xs text-fg-3" title="Kept from your pending entry. Pick another to change it.">
          from pending
        </span>
      )}
      {rule && (
        <RuleBadge
          rule={rule}
          currentCategory={shown.category}
          categoryOptions={categoryOptions}
          extraCount={localCount}
          extraLabel="on screen"
          source={{ description: row.description, amount: row.amount, direction: row.direction }}
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
            className="min-w-0 break-words text-xs text-accent-text hover:underline text-left disabled:opacity-50"
          >
            Always for “{suggest.pattern}”{counts.length ? ` (${counts.join(" · ")})` : ""}
          </button>
          <button
            ref={editBtnRef}
            type="button"
            onClick={() => setEditing((o) => !o)}
            disabled={pending}
            title="Choose the words, or limit the rule to an amount or direction"
            aria-label="Customize rule"
            className="inline-flex text-fg-3 hover:text-accent-text disabled:opacity-50"
          >
            <Icon name="pencil" size={13} />
          </button>
          <RuleEditor
            open={editing}
            onClose={() => setEditing(false)}
            anchorRef={editBtnRef}
            categoryOptions={categoryOptions}
            mode={{ kind: "create", pattern: suggest.pattern, category: suggest.category }}
            source={{ description: row.description, amount: row.amount, direction: row.direction }}
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

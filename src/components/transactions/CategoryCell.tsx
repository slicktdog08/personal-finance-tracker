"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ColorSelect } from "@/components/ColorSelect";
import { RuleBadge } from "@/components/transactions/RuleBadge";
import { RuleEditor } from "@/components/transactions/RuleEditor";
import { updateTransactionCategory } from "@/server/actions/transactions";
import { suggestRuleForDescription, bulkCategorizeByMatch } from "@/server/actions/categorize";
import { explainCategory, type CategoryRule } from "@/server/lib/categorize";
import type { CategoryOption } from "@/server/queries";

export function CategoryCell({
  id,
  value,
  options,
  path,
  description,
  rules = [],
  categoryRuleId = null,
}: {
  id: number;
  value: string | null;
  options: CategoryOption[];
  path: string;
  description?: string;
  /** Every saved rule, so the cell can show which one set this category. */
  rules?: CategoryRule[];
  /** The rule stamped on this row by import / apply-rules (null = by hand or untracked). */
  categoryRuleId?: number | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [suggest, setSuggest] = useState<{ pattern: string; count: number; category: string } | null>(
    null,
  );
  const [editingSuggest, setEditingSuggest] = useState(false);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  // Optimistic local value so the row doesn't vanish under an "uncategorized only" filter
  // when you assign a category — it stays until you refresh / re-apply the filter.
  const [curVal, setCurVal] = useState(value);
  // Re-sync when the server value changes (render-time adjustment, not an effect).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setCurVal(value);
  }

  // The rule behind this category. Until the page refreshes, the stamp still points at
  // the rule that set the OLD category, so after a manual change the chip flips to its
  // "still active" warning — exactly when you'd want to fix or remove it.
  const rule =
    description != null
      ? explainCategory({ description, category: curVal, categoryRuleId }, rules)
      : null;

  function onChange(newCat: string) {
    setCurVal(newCat || null);
    start(async () => {
      await updateTransactionCategory(id, newCat || null, path);
      setSuggest(null);
      // After assigning, suggest a rule that would catch similar uncategorized ones.
      if (newCat && description) {
        const s = await suggestRuleForDescription(description);
        if (s && s.matchCount >= 1) {
          setSuggest({ pattern: s.pattern, count: s.matchCount, category: newCat });
        }
      }
      // Intentionally NOT calling router.refresh() here, so the row stays in place.
    });
  }

  function applyRule() {
    if (!suggest) return;
    start(async () => {
      await bulkCategorizeByMatch({
        field: "description",
        matchType: "contains",
        pattern: suggest.pattern,
        onlyUncategorized: true,
        category: suggest.category,
        saveRule: true,
      });
      setSuggest(null);
      router.refresh(); // bulk action — let the list update
    });
  }

  // Only active categories are offered as new choices; a disabled one stays selectable
  // while it's this row's current value. Include the current value as an option even if
  // it's not in the managed list, so the colored pill still renders for legacy/orphan
  // categories.
  const pickable = options.filter((o) => o.active || o.name === curVal);
  const opts =
    curVal && !pickable.some((o) => o.name === curVal)
      ? [...pickable, { name: curVal, color: "#9ca3af", emoji: null, active: true }]
      : pickable;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ColorSelect
        value={curVal ?? ""}
        options={opts}
        allowEmpty
        placeholder="— uncategorized —"
        disabled={pending}
        onSelect={(name) => onChange(name)}
      />
      {rule && (
        <RuleBadge
          rule={rule}
          currentCategory={curVal}
          categoryOptions={options}
          onSaved={() => router.refresh()}
          onDeleted={() => router.refresh()}
        />
      )}
      {suggest && (
        <span className="inline-flex items-center gap-1">
          <button
            onClick={applyRule}
            disabled={pending}
            title={`Create rule: description contains "${suggest.pattern}" → ${suggest.category} (also saves it for future imports)`}
            className="text-xs text-blue-600 hover:underline text-left disabled:opacity-50"
          >
            +{suggest.count} like “{suggest.pattern}” →
          </button>
          <button
            ref={editBtnRef}
            type="button"
            onClick={() => setEditingSuggest((o) => !o)}
            disabled={pending}
            title="Customize the pattern before saving the rule"
            aria-label="Customize rule"
            className="text-xs text-neutral-400 hover:text-blue-600 disabled:opacity-50"
          >
            ✎
          </button>
          <RuleEditor
            open={editingSuggest}
            onClose={() => setEditingSuggest(false)}
            anchorRef={editBtnRef}
            categoryOptions={options}
            mode={{ kind: "create", pattern: suggest.pattern, category: suggest.category }}
            onSaved={() => {
              setSuggest(null);
              router.refresh();
            }}
          />
        </span>
      )}
    </div>
  );
}

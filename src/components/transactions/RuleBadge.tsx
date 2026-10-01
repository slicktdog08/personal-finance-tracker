"use client";

import { useRef, useState } from "react";
import { RuleEditor, type RuleSavedEvent } from "@/components/transactions/RuleEditor";
import { describeRuleMatch, type CategoryRule, type RuleInput } from "@/server/lib/categorize";
import type { CategoryOption } from "@/server/queries";

// "Set by rule X" chip next to a category. Click → edit or delete the rule. When
// the row's category no longer agrees with the rule (the user just re-categorized
// by hand), the chip turns amber and says so — that's the moment to fix the rule.
export function RuleBadge({
  rule,
  currentCategory,
  categoryOptions,
  onSaved,
  onDeleted,
  extraCount,
  extraLabel,
}: {
  rule: CategoryRule;
  currentCategory: string | null;
  categoryOptions: CategoryOption[];
  onSaved?: (e: RuleSavedEvent) => void;
  onDeleted?: (ruleId: number, cleared: number) => void;
  extraCount?: (draft: RuleInput) => number;
  extraLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const stale = currentCategory !== rule.category;
  const clause = describeRuleMatch(rule);

  const cls = stale
    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    : "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400";

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={
          stale
            ? `This was auto-categorized as ${rule.category} by the rule "${clause}", which is still active for future imports. Click to change or remove the rule.`
            : `Auto-categorized by rule: ${clause} → ${rule.category}. Click to edit or remove the rule.`
        }
        className={`inline-flex items-center gap-1 max-w-[16rem] rounded-full border px-2 py-0.5 text-[11px] leading-4 hover:underline ${cls}`}
      >
        <span aria-hidden>⚙</span>
        <span className="truncate">
          {stale ? (
            <>
              rule “{rule.pattern}” → {rule.category} still active
            </>
          ) : (
            <>rule “{rule.pattern}”</>
          )}
        </span>
      </button>
      <RuleEditor
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        categoryOptions={categoryOptions}
        mode={{ kind: "edit", rule }}
        note={
          stale
            ? `This row was changed to ${currentCategory ?? "uncategorized"} by hand, but the rule still maps ${clause} → ${rule.category} for future imports. Change its category, narrow the pattern, or delete it.`
            : undefined
        }
        extraCount={extraCount}
        extraLabel={extraLabel}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ds";
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

  // The kit's outline "rule" badge; a stale rule borrows the warn tint so it reads as "look here".
  const cls = stale
    ? "mp-badge mp-badge--sm max-w-[16rem] !bg-warn-soft !text-warn"
    : "mp-badge mp-badge--outline mp-badge--sm max-w-[16rem]";

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
        className={cls}
      >
        <Icon name={stale ? "triangle-alert" : "wand-sparkles"} size={11} />
        <span className="mp-badge__label">
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

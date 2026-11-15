"use client";

import { useRef, useState, useTransition } from "react";
import { ColorSelect } from "@/components/ColorSelect";
import { Icon } from "@/components/ds";
import { RuleBadge } from "@/components/transactions/RuleBadge";
import { RuleEditor, type RuleSource } from "@/components/transactions/RuleEditor";
import { updateTransactionCategory } from "@/server/actions/transactions";
import { suggestRuleForTransaction, createRule } from "@/server/actions/categorize";
import { explainCategory, type CategoryRule } from "@/server/lib/categorize";
import type { RuleSuggestion } from "@/server/lib/suggest";
import type { CategoryOption } from "@/server/queries";

export function CategoryCell({
  id,
  value,
  options,
  path,
  description,
  txn,
  rules = [],
  categoryRuleId = null,
  onCategorized,
}: {
  id: number;
  value: string | null;
  options: CategoryOption[];
  path: string;
  description?: string;
  /** The rest of the transaction, so a rule made from it can be limited to its account,
   *  direction or amount with one tap. */
  txn?: Omit<RuleSource, "description">;
  /** Every saved rule, so the cell can show which one set this category. */
  rules?: CategoryRule[];
  /** The rule stamped on this row by import / apply-rules (null = by hand or untracked). */
  categoryRuleId?: number | null;
  /** Told right before the save, so a filtered list can hold on to the row (see TransactionsTable). */
  onCategorized?: (id: number, category: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const [suggest, setSuggest] = useState<(RuleSuggestion & { category: string }) | null>(null);
  const [editingSuggest, setEditingSuggest] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  // Optimistic local value, re-synced when the server value changes (render-time adjustment,
  // not an effect).
  const [curVal, setCurVal] = useState(value);
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
  const source: RuleSource | undefined = description != null ? { description, ...txn } : undefined;

  function onChange(newCat: string) {
    setCurVal(newCat || null);
    setSuggest(null);
    setSaved(null);
    onCategorized?.(id, newCat || null);
    start(async () => {
      await updateTransactionCategory(id, newCat || null, path);
      if (!newCat || !description) return;
      // A rule already files this description here — nothing to offer.
      if (explainCategory({ description, category: newCat }, rules)) return;
      // Offer to make it a rule. Always — a merchant seen once is still worth a rule for next
      // month's import — with a count when it would also sort others right now.
      const s = await suggestRuleForTransaction(description, newCat);
      if (s.pattern) setSuggest({ ...s, category: newCat });
    });
  }

  function applyRule() {
    if (!suggest) return;
    // A pattern that also hits transactions filed elsewhere deserves a look before it's saved.
    if (suggest.conflicts > 0) {
      setEditingSuggest(true);
      return;
    }
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
      setSaved(res.categorized ? `Rule saved · ${res.categorized} more categorized` : "Rule saved");
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
    <div className="flex flex-wrap items-center gap-1.5">
      <ColorSelect
        value={curVal ?? ""}
        options={opts}
        allowEmpty
        placeholder="Set category"
        disabled={pending}
        onSelect={(name) => onChange(name)}
      />
      {rule && (
        <RuleBadge
          rule={rule}
          currentCategory={curVal}
          categoryOptions={options}
          source={source}
        />
      )}
      {saved && !suggest && (
        <span className="inline-flex items-center gap-1 text-xs text-fg-3">
          <Icon name="check" size={12} />
          {saved}
        </span>
      )}
      {suggest && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <button
            type="button"
            onClick={applyRule}
            disabled={pending}
            title={
              suggest.conflicts > 0
                ? `“${suggest.pattern}” also matches ${suggest.conflicts} transaction${suggest.conflicts === 1 ? "" : "s"} filed under other categories. Review the rule before saving it.`
                : `Save a rule: description contains “${suggest.pattern}” → ${suggest.category}. Future imports follow it${suggest.matchCount ? `, and ${suggest.matchCount} uncategorized transaction${suggest.matchCount === 1 ? " is" : "s are"} categorized now` : ""}.`
            }
            className="inline-flex min-w-0 items-center gap-1 text-left text-xs font-medium text-accent-text hover:underline disabled:opacity-50"
          >
            <Icon name={suggest.conflicts > 0 ? "triangle-alert" : "wand-sparkles"} size={12} className="shrink-0" />
            <span className="min-w-0 break-words">
              Always for “{suggest.pattern}”
              {suggest.matchCount > 0 && <span className="font-normal text-fg-3"> · +{suggest.matchCount} now</span>}
            </span>
          </button>
          <button
            ref={editBtnRef}
            type="button"
            onClick={() => setEditingSuggest((o) => !o)}
            disabled={pending}
            title="Choose the words, or limit the rule to this account or amount"
            aria-label="Customize rule"
            className="inline-flex shrink-0 text-fg-3 hover:text-accent-text disabled:opacity-50"
          >
            <Icon name="pencil" size={12} />
          </button>
          <button
            type="button"
            onClick={() => setSuggest(null)}
            title="No rule for this one"
            aria-label="Dismiss rule suggestion"
            className="inline-flex shrink-0 text-fg-3 hover:text-fg"
          >
            <Icon name="x" size={12} />
          </button>
          <RuleEditor
            open={editingSuggest}
            onClose={() => setEditingSuggest(false)}
            anchorRef={editBtnRef}
            categoryOptions={options}
            mode={{ kind: "create", pattern: suggest.pattern, category: suggest.category }}
            source={source}
            onSaved={(e) => {
              setSuggest(null);
              setSaved(e.message);
            }}
          />
        </span>
      )}
    </div>
  );
}

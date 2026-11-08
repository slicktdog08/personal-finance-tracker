"use client";

import { useEffect, useState, useTransition, type RefObject } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { ColorSelect } from "@/components/ColorSelect";
import {
  previewCategorizeMatch,
  bulkCategorizeByMatch,
  updateCategoryRule,
  deleteCategoryRule,
  getRuleUsage,
} from "@/server/actions/categorize";
import { describeRuleMatch, type CategoryRule, type RuleInput } from "@/server/lib/categorize";
import type { CategoryOption } from "@/server/queries";

// One editor for every place a rule is born or changed: the inline "+N like X"
// suggestion (create), the "set by rule" chip on a row (edit/delete), the import
// review, and the saved-rules table. Bottom sheet on mobile, anchored popover on
// desktop when an anchor is given, centered dialog otherwise.
export type RuleEditorMode =
  | {
      kind: "create";
      pattern: string;
      category: string;
      field?: RuleInput["field"];
      matchType?: RuleInput["matchType"];
    }
  | { kind: "edit"; rule: CategoryRule };

export interface RuleSavedEvent {
  rule: CategoryRule;
  /** True when saved from create mode (the server may still have reused an identical rule). */
  created: boolean;
  /** Rows changed in the database by this save, for a status line. */
  message: string;
}

function initialDraft(mode: RuleEditorMode): RuleInput {
  if (mode.kind === "create") {
    return {
      field: mode.field ?? "description",
      matchType: mode.matchType ?? "contains",
      pattern: mode.pattern,
      category: mode.category,
    };
  }
  const r = mode.rule;
  return {
    field: r.field === "raw_category" ? "raw_category" : "description",
    matchType: r.matchType === "equals" || r.matchType === "regex" ? r.matchType : "contains",
    pattern: r.pattern,
    category: r.category,
  };
}

const toMatchField = (f: RuleInput["field"]) => (f === "raw_category" ? "category" : "description");

export function RuleEditor({
  open,
  onClose,
  anchorRef,
  categoryOptions,
  mode,
  note,
  extraCount,
  extraLabel = "in this file",
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  categoryOptions: CategoryOption[];
  mode: RuleEditorMode;
  /** Context line shown above the form, e.g. why the row and the rule disagree. */
  note?: string;
  /** Extra matches outside the database (the import review's on-screen rows). */
  extraCount?: (draft: RuleInput) => number;
  extraLabel?: string;
  onSaved?: (e: RuleSavedEvent) => void;
  onDeleted?: (ruleId: number, cleared: number) => void;
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<RuleInput>(() => initialDraft(mode));
  const [reapply, setReapply] = useState(true);
  const [preview, setPreview] = useState<{ pattern: string; count: number; samples: string[] } | null>(
    null,
  );
  const [usage, setUsage] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clearOnDelete, setClearOnDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time it opens (render-time state adjustment — the project's
  // lint config bans setState inside effects).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(initialDraft(mode));
      setReapply(true);
      setPreview(null);
      setUsage(null);
      setConfirmDelete(false);
      setClearOnDelete(false);
      setError(null);
    }
  }

  const ruleId = mode.kind === "edit" ? mode.rule.id : null;
  const pattern = draft.pattern.trim();

  // Live "how many uncategorized rows would this hit", debounced per keystroke.
  useEffect(() => {
    if (!open || !pattern) return;
    let alive = true;
    const field = toMatchField(draft.field);
    const matchType = draft.matchType;
    const t = setTimeout(async () => {
      try {
        const res = await previewCategorizeMatch({ field, matchType, pattern, onlyUncategorized: true });
        if (alive) setPreview({ pattern, ...res });
      } catch {
        // Preview is best-effort; saving still validates.
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, draft.field, draft.matchType, pattern]);

  useEffect(() => {
    if (!open || ruleId == null) return;
    let alive = true;
    getRuleUsage(ruleId)
      .then((n) => {
        if (alive) setUsage(n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, ruleId]);

  const canSave = !!pattern && !!draft.category && !pending;
  const extra = extraCount && pattern ? extraCount({ ...draft, pattern }) : 0;
  const shownPreview = preview && preview.pattern === pattern ? preview : null;

  function save() {
    if (!canSave) return;
    setError(null);
    start(async () => {
      try {
        if (mode.kind === "create") {
          const res = await bulkCategorizeByMatch({
            field: toMatchField(draft.field),
            matchType: draft.matchType,
            pattern,
            onlyUncategorized: true,
            category: draft.category,
            saveRule: true,
          });
          if (!res.rule) throw new Error("The rule was not saved.");
          onSaved?.({
            rule: res.rule,
            created: true,
            message: `Saved rule and categorized ${res.updated} existing transaction${res.updated === 1 ? "" : "s"}.`,
          });
        } else {
          const res = await updateCategoryRule(mode.rule.id, { ...draft, pattern }, reapply);
          const parts: string[] = [];
          if (reapply) {
            if (res.recategorized) parts.push(`${res.recategorized} recategorized`);
            if (res.cleared) parts.push(`${res.cleared} cleared`);
            if (res.applied) parts.push(`${res.applied} newly categorized`);
          }
          onSaved?.({
            rule: res.rule,
            created: false,
            message: parts.length ? `Rule updated: ${parts.join(", ")}.` : "Rule updated.",
          });
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function doDelete() {
    if (mode.kind !== "edit") return;
    setError(null);
    start(async () => {
      try {
        const r = await deleteCategoryRule(mode.rule.id, { clearCategories: clearOnDelete });
        onDeleted?.(mode.rule.id, r.cleared);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const inputCls =
    "mp-input !h-9";

  const selectCls = "mp-select !h-9";
  const pickable = categoryOptions.filter((c) => c.active || c.name === draft.category);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode.kind === "create" ? "Create categorization rule" : "Edit categorization rule"}
      anchorRef={anchorRef}
      desktop={anchorRef ? "anchored" : "centered"}
      width={360}
    >
      <div className="space-y-3 text-left text-sm">
        {note && (
          <p className="rounded-panel bg-warn-soft px-3 py-2 text-xs text-warn">
            {note}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="mp-field__label">Match on</span>
            <select
              value={draft.field}
              onChange={(e) => setDraft((d) => ({ ...d, field: e.target.value as RuleInput["field"] }))}
              className={selectCls}
            >
              <option value="description">Description</option>
              <option value="raw_category">Bank category</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="mp-field__label">Type</span>
            <select
              value={draft.matchType}
              onChange={(e) =>
                setDraft((d) => ({ ...d, matchType: e.target.value as RuleInput["matchType"] }))
              }
              className={selectCls}
            >
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="regex">regex</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="mp-field__label">Pattern</span>
          <input
            value={draft.pattern}
            onChange={(e) => setDraft((d) => ({ ...d, pattern: e.target.value }))}
            className={inputCls + " font-mono"}
            placeholder="e.g. UBER"
            autoFocus
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="mp-field__label">Set category to</span>
          <div>
            <ColorSelect
              value={draft.category}
              options={pickable}
              placeholder="Pick category"
              onSelect={(v) => setDraft((d) => ({ ...d, category: v }))}
            />
          </div>
        </div>

        <div className="rounded-panel bg-sunken px-3 py-2 text-xs space-y-1">
          {!pattern ? (
            <span className="text-fg-3">Enter a pattern to see what it would match.</span>
          ) : (
            <>
              <div className="text-fg">
                {shownPreview ? (
                  <>
                    <span className="font-medium">{shownPreview.count.toLocaleString()}</span> uncategorized
                    transaction{shownPreview.count === 1 ? "" : "s"} match
                  </>
                ) : (
                  <span className="text-fg-3">Counting matches…</span>
                )}
                {extra > 0 && (
                  <>
                    {" "}
                    · <span className="font-medium">{extra}</span> {extraLabel}
                  </>
                )}
              </div>
              {shownPreview && shownPreview.samples.length > 0 && (
                <ul className="text-fg-3 space-y-0.5">
                  {shownPreview.samples.slice(0, 3).map((s, i) => (
                    <li key={i} className="truncate">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {mode.kind === "edit" && usage != null && (
                <div className="text-fg-3">
                  Currently set the category on <span className="font-medium">{usage}</span> transaction
                  {usage === 1 ? "" : "s"}.
                </div>
              )}
            </>
          )}
        </div>

        {mode.kind === "edit" && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={reapply}
              onChange={(e) => setReapply(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Re-apply after saving: transactions this rule set are updated to the new category
              (or uncategorized if they no longer match), and uncategorized matches are picked up.
              Categories set by hand are never touched.
            </span>
          </label>
        )}
        {mode.kind === "create" && (
          <p className="text-[11px] text-fg-3">
            Saves the rule for future imports and categorizes the uncategorized transactions it
            matches now. Already-categorized rows are left alone.
          </p>
        )}

        {error && <p className="text-xs text-over">{error}</p>}

        {confirmDelete && mode.kind === "edit" ? (
          <div className="rounded-panel bg-danger-soft p-3 space-y-2 text-xs">
            <div className="text-danger">
              Delete the rule “{describeRuleMatch(mode.rule)} → {mode.rule.category}”? Future imports
              will no longer auto-categorize these.
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={clearOnDelete}
                onChange={(e) => setClearOnDelete(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Also clear the category on the {usage ?? "…"} transaction{usage === 1 ? "" : "s"} it
                set (they become uncategorized).
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="mp-btn mp-btn--ghost mp-btn--sm"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={pending}
                className="mp-btn mp-btn--danger mp-btn--sm"
              >
                {pending ? "Deleting…" : "Delete rule"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            {mode.kind === "edit" && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium text-over hover:underline"
              >
                Delete rule…
              </button>
            )}
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="mp-btn mp-btn--ghost mp-btn--sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="mp-btn mp-btn--primary mp-btn--sm"
              >
                {pending
                  ? "Saving…"
                  : mode.kind === "create"
                    ? `Save rule${shownPreview ? ` & apply (${shownPreview.count})` : ""}`
                    : "Save"}
              </button>
            </span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

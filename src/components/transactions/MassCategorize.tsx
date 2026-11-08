"use client";

import { useState, useTransition } from "react";
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
import { ColorSelect } from "@/components/ColorSelect";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Glyph,
  IconButton,
  Input,
  ListRow,
  Notice,
  Select,
} from "@/components/ds";

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
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);
  const [sugCat, setSugCat] = useState<Record<string, string>>(
    Object.fromEntries(suggestions.map((s) => [s.pattern, s.suggestedCategory ?? ""])),
  );
  const [donePatterns, setDonePatterns] = useState<Set<string>>(new Set());

  const active = categoryOptions.filter((c) => c.active);
  const colorOf = (name: string | null | undefined) =>
    categoryOptions.find((c) => c.name === name)?.color;

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
  // Any change to what's matched makes an earlier preview's count wrong.
  const stale = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

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
    });
  }
  function doAutoApply() {
    start(async () => {
      const n = await applySavedRules(true);
      setAutoMsg(`Applied saved rules to ${n} uncategorized transaction${n === 1 ? "" : "s"}.`);
    });
  }

  const visibleSuggestions = suggestions.filter((s) => !donePatterns.has(s.pattern));

  return (
    <div className="space-y-4">
      <div className="mp-grid items-start" style={{ "--cols": 2 } as React.CSSProperties}>
        {/* Suggested rules */}
        <Card title="Suggested rules" meta="from your most common uncategorized descriptions">
          {visibleSuggestions.length === 0 ? (
            <EmptyState
              compact
              icon="wand-sparkles"
              title="No suggestions right now"
              body="Nothing frequent is left to categorize."
            />
          ) : (
            <div>
              {visibleSuggestions.map((s) => (
                <div key={s.pattern} title={s.samples.join("\n")}>
                  <ListRow
                    lead={<Glyph icon="wand-sparkles" color={colorOf(sugCat[s.pattern])} />}
                    title={
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px]">“{s.pattern}”</span>
                        <span className="text-fg-3">→</span>
                        <ColorSelect
                          value={sugCat[s.pattern] ?? ""}
                          options={active}
                          placeholder="Pick category"
                          onSelect={(v) => setSugCat((m) => ({ ...m, [s.pattern]: v }))}
                        />
                      </span>
                    }
                    sub={
                      <>
                        Matches {s.matchCount} transaction{s.matchCount === 1 ? "" : "s"}
                        {s.samples[0] && <span className="max-sm:hidden"> · e.g. {s.samples[0]}</span>}
                      </>
                    }
                    end={
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => applySuggestion(s.pattern)}
                        disabled={pending || !sugCat[s.pattern]}
                        title={sugCat[s.pattern] ? undefined : "Pick a category first"}
                      >
                        Apply
                      </Button>
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-fg-3">
            Applying one categorizes every matching uncategorized transaction and saves a rule
            (description contains the phrase) for future imports.
          </p>
        </Card>

        {/* Rule builder / bulk apply */}
        <Card title="Mass categorize" meta={`${uncategorized.toLocaleString()} uncategorized`}>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Match on">
                <Select
                  value={field}
                  onChange={(e) => stale(setField)(e.target.value as typeof field)}
                  options={[
                    { value: "description", label: "Description" },
                    { value: "category", label: "Current category" },
                  ]}
                />
              </Field>
              <Field label="How">
                <Select
                  value={matchType}
                  onChange={(e) => stale(setMatchType)(e.target.value as typeof matchType)}
                  options={[
                    { value: "contains", label: "Contains" },
                    { value: "equals", label: "Equals" },
                    { value: "regex", label: "Regex" },
                  ]}
                />
              </Field>
            </div>
            <Field label={field === "description" ? "Description text" : "Category text"}>
              <Input
                icon="search"
                value={pattern}
                onChange={(e) => stale(setPattern)(e.target.value)}
                placeholder="e.g. UBER"
              />
            </Field>
            <Field label="Set category to">
              <div>
                <ColorSelect value={category} options={active} placeholder="Pick category" onSelect={setCategory} />
              </div>
            </Field>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Checkbox label="Only uncategorized" checked={onlyUncat} onChange={(e) => stale(setOnlyUncat)(e.target.checked)} />
              <Checkbox label="Save as a rule" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon="eye" onClick={doPreview} disabled={pending || !pattern.trim()}>
                Preview
              </Button>
              <Button icon="tags" onClick={doApply} disabled={pending || !pattern.trim() || !category}>
                {preview ? `Categorize ${preview.count.toLocaleString()} match${preview.count === 1 ? "" : "es"}` : "Categorize matches"}
              </Button>
            </div>
            {applyMsg && <Notice tone="ok">{applyMsg}</Notice>}
            {preview && (
              <div className="rounded-panel bg-sunken p-3 text-sm space-y-1">
                <div className="font-medium">
                  {preview.count.toLocaleString()} transaction{preview.count === 1 ? "" : "s"} match
                </div>
                {preview.samples.length > 0 && (
                  <ul className="text-fg-3 list-disc list-inside">
                    {preview.samples.map((s, i) => (
                      <li key={i} className="truncate">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Auto-apply */}
      <Card
        title="Apply saved rules"
        meta={`${rules.length} rule${rules.length === 1 ? "" : "s"}`}
        action={
          <Button
            size="sm"
            icon="wand-sparkles"
            onClick={doAutoApply}
            disabled={pending || rules.length === 0}
          >
            Apply to uncategorized
          </Button>
        }
      >
        <p className="text-sm text-fg-2">
          {uncategorized.toLocaleString()} transaction{uncategorized === 1 ? " is" : "s are"} uncategorized.
          Run every saved rule against them.
        </p>
        {autoMsg && (
          <Notice tone="ok" className="mt-3">
            {autoMsg}
          </Notice>
        )}
      </Card>

      {/* Saved rules */}
      <Card title="Saved rules" meta={String(rules.length)}>
        {ruleMsg && (
          <Notice tone="ok" className="mb-3">
            {ruleMsg}
          </Notice>
        )}
        {rules.length === 0 ? (
          <EmptyState
            compact
            icon="wand-sparkles"
            title="No rules yet"
            body="Tick “Save as a rule” when you categorize, and future imports follow it."
          />
        ) : (
          <div>
            {rules.map((r) => (
              <ListRow
                key={r.id}
                lead={<Glyph icon="wand-sparkles" color={colorOf(r.category)} size="sm" />}
                title={<span className="font-mono text-[13px]">{describeRuleMatch(r)}</span>}
                sub={
                  <span className="inline-flex items-center gap-1.5">
                    →
                    <Badge label={r.category} color={colorOf(r.category)} size="sm" />
                  </span>
                }
                end={
                  <span className="flex items-center gap-0.5">
                    <IconButton icon="pencil" label="Edit rule" size="sm" onClick={() => setEditing(r)} />
                    <IconButton
                      icon="trash-2"
                      label="Delete rule"
                      size="sm"
                      disabled={pending}
                      className="hover:!text-over"
                      onClick={() =>
                        start(async () => {
                          await deleteCategoryRule(r.id);
                        })
                      }
                    />
                  </span>
                }
              />
            ))}
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
            }}
            onDeleted={(_, cleared) => {
              setRuleMsg(
                cleared
                  ? `Rule removed; ${cleared} transaction${cleared === 1 ? "" : "s"} uncategorized again.`
                  : "Rule removed.",
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}

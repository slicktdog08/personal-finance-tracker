"use client";

import { useEffect, useMemo, useState, useTransition, type RefObject } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { ColorSelect } from "@/components/ColorSelect";
import {
  previewRuleDraft,
  createRule,
  updateCategoryRule,
  deleteCategoryRule,
  getRuleUsage,
  getRuleEditorOptions,
  type RuleEditorOptions,
} from "@/server/actions/categorize";
import type { RulePreview } from "@/server/lib/rules";
import {
  describeRuleActions,
  describeRuleMatch,
  type CategoryRule,
  type RuleDirection,
  type RuleInput,
} from "@/server/lib/categorize";
import { describeWords, phraseFromWords, wordsCovered } from "@/server/lib/suggest";
import type { CategoryOption } from "@/server/queries";
import { Icon } from "@/components/ds";

// One editor for every place a rule is born or changed: the inline "+N like X"
// suggestion (create), the "set by rule" chip on a row (edit/delete), the import
// review, the saved-rules list, and "auto-link future payments" from a bill link.
// Bottom sheet on mobile, anchored popover on desktop when an anchor is given,
// centered dialog otherwise.
//
// A rule is conditions (text match + optional account / direction / amount range) → actions
// (set a category, link a bill — either or both).
//
// Opened from a transaction (`source`), the form is mostly taps: the description is laid out as
// word chips to pick the pattern from, and "only this account / direction / amount" are one-tap
// limits filled in from that transaction. The selects and free-form fields sit under "More
// options" for everything else.
export type RuleEditorMode =
  | ({ kind: "create" } & Partial<RuleInput>)
  | { kind: "edit"; rule: CategoryRule };

/** The transaction a rule is being made (or fixed) from. */
export interface RuleSource {
  description: string;
  accountId?: number | null;
  accountName?: string | null;
  amount?: number | string | null;
  direction?: string | null;
}

export interface RuleSavedEvent {
  rule: CategoryRule;
  /** True when saved from create mode (the server may still have reused an identical rule). */
  created: boolean;
  /** Rows changed in the database by this save, for a status line. */
  message: string;
}

const BLANK: RuleInput = {
  field: "description",
  matchType: "contains",
  pattern: "",
  accountId: null,
  direction: null,
  amountMin: null,
  amountMax: null,
  category: null,
  billId: null,
};

function initialDraft(mode: RuleEditorMode): RuleInput {
  if (mode.kind === "create") {
    const { kind: _kind, ...rest } = mode;
    void _kind;
    return { ...BLANK, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  }
  const r = mode.rule;
  return {
    field: r.field === "raw_category" ? "raw_category" : "description",
    matchType: r.matchType === "equals" || r.matchType === "regex" ? r.matchType : "contains",
    pattern: r.pattern,
    accountId: r.accountId,
    direction: r.direction === "Debit" || r.direction === "Credit" ? r.direction : null,
    amountMin: r.amountMin,
    amountMax: r.amountMax,
    category: r.category,
    billId: r.billId,
  };
}

const hasExtraConditions = (d: RuleInput) =>
  d.accountId != null || d.direction != null || d.amountMin != null || d.amountMax != null;

const sameAmount = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.005;

const fmtMoney = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Does the draft need the full controls — something the one-tap limits can't show?
function needsMore(d: RuleInput, src: RuleSource | undefined): boolean {
  if (d.field !== "description" || d.matchType !== "contains") return true;
  if (!src) return hasExtraConditions(d);
  const amt = src.amount == null ? null : Math.abs(Number(src.amount));
  if (d.accountId != null && d.accountId !== src.accountId) return true;
  if (d.direction != null && d.direction !== src.direction) return true;
  if (d.amountMin != null || d.amountMax != null) {
    if (!sameAmount(d.amountMin, amt) || !sameAmount(d.amountMax, amt)) return true;
  }
  return false;
}

// Shared across every editor on the page; refreshed each time an editor opens.
let optionsCache: RuleEditorOptions | null = null;

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function parseAmount(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
}

export function RuleEditor({
  open,
  onClose,
  anchorRef,
  categoryOptions,
  mode,
  source,
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
  /** The transaction this was opened from: its words become pattern chips and its account,
   *  direction and amount become one-tap limits. */
  source?: RuleSource;
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
  const [showMore, setShowMore] = useState(() => needsMore(initialDraft(mode), source));
  // Amount inputs keep the raw text so "12." can be typed; the draft holds the parsed number.
  const [minText, setMinText] = useState(() => String(initialDraft(mode).amountMin ?? ""));
  const [maxText, setMaxText] = useState(() => String(initialDraft(mode).amountMax ?? ""));
  const [reapply, setReapply] = useState(true);
  const [preview, setPreview] = useState<({ key: string } & RulePreview) | null>(null);
  const [usage, setUsage] = useState<{ categories: number; bills: number } | null>(null);
  const [options, setOptions] = useState<RuleEditorOptions | null>(optionsCache);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clearCats, setClearCats] = useState(false);
  const [clearLinks, setClearLinks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time it opens (render-time state adjustment — the project's
  // lint config bans setState inside effects).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const d = initialDraft(mode);
      setDraft(d);
      setShowMore(needsMore(d, source));
      setMinText(d.amountMin != null ? String(d.amountMin) : "");
      setMaxText(d.amountMax != null ? String(d.amountMax) : "");
      setReapply(true);
      setPreview(null);
      setUsage(null);
      setConfirmDelete(false);
      setClearCats(false);
      setClearLinks(false);
      setError(null);
    }
  }
  const ruleId = mode.kind === "edit" ? mode.rule.id : null;
  const pattern = draft.pattern.trim();
  const draftKey = JSON.stringify({ ...draft, pattern });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getRuleEditorOptions()
      .then((o) => {
        optionsCache = o;
        if (alive) setOptions(o);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  // Live "what would this do", debounced per keystroke.
  useEffect(() => {
    if (!open || !pattern || (!draft.category && draft.billId == null)) return;
    let alive = true;
    const input = JSON.parse(draftKey) as RuleInput;
    const t = setTimeout(async () => {
      try {
        const res = await previewRuleDraft(input);
        if (alive) setPreview({ key: draftKey, ...res });
      } catch {
        // Preview is best-effort; saving still validates.
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, draftKey, pattern, draft.category, draft.billId]);

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

  const hasAction = !!draft.category || draft.billId != null;
  const canSave = !!pattern && hasAction && !pending;
  const extra = extraCount && pattern ? extraCount({ ...draft, pattern }) : 0;
  const shownPreview = preview && preview.key === draftKey ? preview : null;
  const shownCount = shownPreview ? shownPreview.categorized + shownPreview.linked : null;

  const accountName = (id: number) => options?.accounts.find((a) => a.id === id)?.name;
  const billName = (id: number) => options?.bills.find((b) => b.id === id)?.name;

  function save() {
    if (!canSave) return;
    setError(null);
    const input = { ...draft, pattern };
    start(async () => {
      try {
        if (mode.kind === "create") {
          const res = await createRule(input);
          const parts: string[] = [];
          if (res.categorized) parts.push(`categorized ${plural(res.categorized, "transaction")}`);
          if (res.linked) parts.push(`linked ${plural(res.linked, "transaction")} to the bill`);
          onSaved?.({
            rule: res.rule,
            created: true,
            message: parts.length ? `Saved rule and ${parts.join(", ")}.` : "Saved rule.",
          });
        } else {
          const res = await updateCategoryRule(mode.rule.id, input, reapply);
          const parts: string[] = [];
          if (reapply) {
            if (res.recategorized) parts.push(`${res.recategorized} recategorized`);
            if (res.cleared) parts.push(`${res.cleared} uncategorized`);
            if (res.categorized) parts.push(`${res.categorized} newly categorized`);
            if (res.relinked) parts.push(`${res.relinked} moved to the new bill`);
            if (res.unlinked) parts.push(`${res.unlinked} unlinked`);
            if (res.linked) parts.push(`${res.linked} newly linked`);
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
        const r = await deleteCategoryRule(mode.rule.id, { clearCategories: clearCats, clearBillLinks: clearLinks });
        onDeleted?.(mode.rule.id, r.cleared);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // ---- Pattern from the source transaction's own words ----
  const words = useMemo(() => (source ? describeWords(source.description) : []), [source]);
  const pickWords = !!source && draft.field === "description" && draft.matchType === "contains" && words.length > 0;
  const covered = pickWords ? wordsCovered(source.description, words, draft.pattern) : null;
  function tapWord(i: number) {
    if (!source) return;
    let from = i;
    let to = i;
    if (covered) {
      [from, to] = covered;
      if (i < from) from = i;
      else if (i > to) to = i;
      else if (from === to) return; // the last word can't be dropped; type over it instead
      else if (i === from) from = i + 1;
      else to = i === to ? i - 1 : i;
    }
    set("pattern", phraseFromWords(source.description, words, from, to));
  }

  // ---- One-tap limits from the source transaction ----
  const srcAmount = source?.amount == null || source.amount === "" ? null : Math.abs(Number(source.amount));
  const srcDirection: RuleDirection | null =
    source?.direction === "Debit" || source?.direction === "Credit" ? source.direction : null;
  const srcAccountName =
    source?.accountId != null ? (accountName(source.accountId) ?? source.accountName ?? null) : null;
  const amountPinned = sameAmount(draft.amountMin, srcAmount) && sameAmount(draft.amountMax, srcAmount);
  function setAmounts(min: number | null, max: number | null) {
    setDraft((d) => ({ ...d, amountMin: min, amountMax: max }));
    setMinText(min != null ? String(min) : "");
    setMaxText(max != null ? String(max) : "");
  }
  const quickLimits = !!source && (source.accountId != null || srcDirection != null || (srcAmount != null && Number.isFinite(srcAmount)));

  const what = draft.field === "raw_category" ? "bank category" : "description";
  const how = draft.matchType === "equals" ? "is exactly" : draft.matchType === "regex" ? "matches the regex" : "contains";
  const elsewhere = shownPreview?.elsewhere;
  // "Too broad" once the pattern sweeps in more settled transactions than it would newly sort.
  const tooBroad = !!elsewhere && elsewhere.total >= 3 && elsewhere.total > (shownPreview?.categorized ?? 0);
  const selectCls = "mp-select !h-9";
  const inputCls = "mp-input !h-9";
  const pickable = categoryOptions.filter((c) => c.active || c.name === draft.category);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode.kind === "create" ? "Create rule" : "Edit rule"}
      anchorRef={anchorRef}
      desktop={anchorRef ? "anchored" : "centered"}
      width={400}
    >
      <div className="space-y-3 text-left text-sm">
        {note && <p className="rounded-panel bg-warn-soft px-3 py-2 text-xs text-warn">{note}</p>}

        {/* ---- When ---- */}
        <div className="mp-field__label">
          When the {what} {how}
        </div>
        {pickWords && (
          <div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Words in this transaction">
              {words.map((w, i) => {
                const on = !!covered && i >= covered[0] && i <= covered[1];
                return (
                  <button
                    key={`${w.start}:${w.text}`}
                    type="button"
                    aria-pressed={on}
                    onClick={() => tapWord(i)}
                    title={
                      w.kind === "code"
                        ? "Looks like a store or reference number — it changes from one transaction to the next"
                        : w.kind === "place"
                          ? "Looks like a place — shared by every merchant there"
                          : w.kind === "filler"
                            ? "Bank or card-processor boilerplate"
                            : undefined
                    }
                    className={
                      "rounded-md border px-1.5 py-0.5 font-mono text-xs transition-colors " +
                      (on
                        ? "border-accent bg-accent-soft text-accent-text"
                        : w.kind === "name"
                          ? "border-line-2 bg-surface text-fg hover:bg-hover"
                          : "border-dashed border-line-2 text-fg-3 hover:bg-hover")
                    }
                  >
                    {w.text}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-fg-3">
              Tap words to grow or shrink the match. Dashed ones are store numbers, places and bank
              boilerplate — usually best left out.
            </p>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="sr-only">Pattern</span>
          <input
            value={draft.pattern}
            onChange={(e) => set("pattern", e.target.value)}
            className={inputCls + " font-mono"}
            placeholder="e.g. UBER"
            autoFocus={!pickWords}
          />
        </label>

        {quickLimits && !showMore && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-fg-3">Only</span>
            {source?.accountId != null && (
              <button
                type="button"
                className="mp-chip !h-7 !px-2.5 !text-xs"
                aria-pressed={draft.accountId === source.accountId}
                onClick={() => set("accountId", draft.accountId === source.accountId ? null : source.accountId!)}
              >
                on {srcAccountName ?? "this account"}
              </button>
            )}
            {srcDirection && (
              <button
                type="button"
                className="mp-chip !h-7 !px-2.5 !text-xs"
                aria-pressed={draft.direction === srcDirection}
                onClick={() => set("direction", draft.direction === srcDirection ? null : srcDirection)}
              >
                {srcDirection === "Credit" ? "money in" : "money out"}
              </button>
            )}
            {srcAmount != null && Number.isFinite(srcAmount) && (
              <button
                type="button"
                className="mp-chip !h-7 !px-2.5 !text-xs"
                aria-pressed={amountPinned}
                onClick={() => (amountPinned ? setAmounts(null, null) : setAmounts(srcAmount, srcAmount))}
              >
                exactly {fmtMoney(srcAmount)}
              </button>
            )}
          </div>
        )}

        {showMore ? (
          <div className="space-y-2 rounded-panel border border-line p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="mp-field__label">Match on</span>
                <select
                  value={draft.field}
                  onChange={(e) => set("field", e.target.value as RuleInput["field"])}
                  className={selectCls}
                >
                  <option value="description">Description</option>
                  <option value="raw_category">Bank category</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="mp-field__label">How</span>
                <select
                  value={draft.matchType}
                  onChange={(e) => set("matchType", e.target.value as RuleInput["matchType"])}
                  className={selectCls}
                >
                  <option value="contains">contains</option>
                  <option value="equals">is exactly</option>
                  <option value="regex">matches regex</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="mp-field__label">Account</span>
                <select
                  value={draft.accountId ?? ""}
                  onChange={(e) => set("accountId", e.target.value ? Number(e.target.value) : null)}
                  className={selectCls}
                >
                  <option value="">Any account</option>
                  {options?.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  {draft.accountId != null && !options?.accounts.some((a) => a.id === draft.accountId) && (
                    <option value={draft.accountId}>Account #{draft.accountId}</option>
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="mp-field__label">Direction</span>
                <select
                  value={draft.direction ?? ""}
                  onChange={(e) => set("direction", (e.target.value || null) as RuleDirection | null)}
                  className={selectCls}
                >
                  <option value="">Either</option>
                  <option value="Debit">Money out</option>
                  <option value="Credit">Money in</option>
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="mp-field__label">Amount between</span>
              <div className="flex items-center gap-2">
                <input
                  value={minText}
                  onChange={(e) => {
                    setMinText(e.target.value);
                    set("amountMin", parseAmount(e.target.value));
                  }}
                  inputMode="decimal"
                  placeholder="any"
                  aria-label="Minimum amount"
                  className={inputCls + " w-full tabular-nums"}
                />
                <span className="text-fg-3">and</span>
                <input
                  value={maxText}
                  onChange={(e) => {
                    setMaxText(e.target.value);
                    set("amountMax", parseAmount(e.target.value));
                  }}
                  inputMode="decimal"
                  placeholder="any"
                  aria-label="Maximum amount"
                  className={inputCls + " w-full tabular-nums"}
                />
              </div>
              <span className="text-[11px] text-fg-3">
                Use the same number twice for an exact amount. Handy when two payments share one
                statement line.
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="text-xs font-medium text-accent-text hover:underline"
          >
            More options
            <span className="font-normal text-fg-3"> · exact match, regex, bank category, amount range</span>
          </button>
        )}

        {/* ---- Then ---- */}
        <div className="mp-field__label pt-1">Then</div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-fg-2">Set category</span>
          <div>
            <ColorSelect
              value={draft.category ?? ""}
              options={pickable}
              allowEmpty
              placeholder="Don’t change category"
              onSelect={(v) => set("category", v || null)}
            />
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-2">Link to bill</span>
          <select
            value={draft.billId ?? ""}
            onChange={(e) => set("billId", e.target.value ? Number(e.target.value) : null)}
            className={selectCls}
          >
            <option value="">Don’t link a bill</option>
            {options?.bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            {draft.billId != null && !options?.bills.some((b) => b.id === draft.billId) && (
              <option value={draft.billId}>Bill #{draft.billId}</option>
            )}
          </select>
          {draft.billId != null && (
            <span className="text-[11px] text-fg-3">
              Links each match to the bill and to its row on that month’s sheet. Payments you
              linked by hand, and pending ones, are left alone.
            </span>
          )}
        </label>

        {/* ---- Preview ---- */}
        <div className="rounded-panel bg-sunken px-3 py-2 text-xs space-y-1">
          {!pattern ? (
            <span className="text-fg-3">Enter a pattern to see what it would match.</span>
          ) : !hasAction ? (
            <span className="text-fg-3">Pick a category, a bill, or both.</span>
          ) : (
            <>
              <div className="text-fg">
                {shownPreview ? (
                  <>
                    {draft.category && (
                      <>
                        <span className="font-medium">{shownPreview.categorized.toLocaleString()}</span> uncategorized
                        would be categorized
                      </>
                    )}
                    {draft.category && draft.billId != null && " · "}
                    {draft.billId != null && (
                      <>
                        <span className="font-medium">{shownPreview.linked.toLocaleString()}</span> unlinked would be
                        linked
                      </>
                    )}
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
              {elsewhere && elsewhere.total > 0 && (
                <div className={tooBroad ? "flex items-start gap-1.5 text-warn" : "text-fg-3"}>
                  {tooBroad && <Icon name="triangle-alert" size={12} className="mt-0.5 shrink-0" />}
                  <span>
                    {tooBroad && <span className="font-medium">Probably too broad. </span>}
                    Also matches {plural(elsewhere.total, "transaction")} already filed elsewhere (
                    {elsewhere.top.map((t) => `${t.category} ${t.n.toLocaleString()}`).join(", ")}
                    {elsewhere.top.reduce((n, t) => n + t.n, 0) < elsewhere.total ? ", …" : ""}). Those stay
                    put, but new ones like them would become {draft.category}.
                  </span>
                </div>
              )}
              {mode.kind === "edit" && usage != null && (usage.categories > 0 || usage.bills > 0) && (
                <div className="text-fg-3">
                  So far it has
                  {usage.categories > 0 && <> categorized {plural(usage.categories, "transaction")}</>}
                  {usage.categories > 0 && usage.bills > 0 && " and"}
                  {usage.bills > 0 && <> linked {plural(usage.bills, "transaction")}</>}.
                </div>
              )}
            </>
          )}
        </div>

        {mode.kind === "edit" && (
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={reapply} onChange={(e) => setReapply(e.target.checked)} className="mt-0.5" />
            <span>
              Re-apply after saving: what this rule set follows the new version (or is undone if it
              no longer matches), and open transactions it now matches are picked up. Anything you
              set by hand is never touched.
            </span>
          </label>
        )}
        {mode.kind === "create" && (
          <p className="text-[11px] text-fg-3">
            Saves the rule for future imports and syncs, and applies it now to uncategorized /
            unlinked transactions. Anything already set is left alone.
          </p>
        )}

        {error && <p className="text-xs text-over">{error}</p>}

        {confirmDelete && mode.kind === "edit" ? (
          <div className="rounded-panel bg-danger-soft p-3 space-y-2 text-xs">
            <div className="text-danger">
              Delete the rule “{describeRuleMatch(mode.rule, { account: accountName, bill: billName })} →{" "}
              {describeRuleActions(mode.rule, { account: accountName, bill: billName })}”? Future imports
              won’t follow it.
            </div>
            {(usage?.categories ?? 0) > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={clearCats} onChange={(e) => setClearCats(e.target.checked)} className="mt-0.5" />
                <span>
                  Also clear the category on the {plural(usage!.categories, "transaction")} it categorized.
                </span>
              </label>
            )}
            {(usage?.bills ?? 0) > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={clearLinks} onChange={(e) => setClearLinks(e.target.checked)} className="mt-0.5" />
                <span>Also unlink the {plural(usage!.bills, "transaction")} it linked to the bill.</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="mp-btn mp-btn--ghost mp-btn--sm">
                Keep it
              </button>
              <button type="button" onClick={doDelete} disabled={pending} className="mp-btn mp-btn--danger mp-btn--sm">
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
              <button type="button" onClick={onClose} className="mp-btn mp-btn--ghost mp-btn--sm">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={!canSave} className="mp-btn mp-btn--primary mp-btn--sm">
                {pending
                  ? "Saving…"
                  : mode.kind === "create"
                    ? `Save rule${shownCount ? ` & apply (${shownCount})` : ""}`
                    : "Save"}
              </button>
            </span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

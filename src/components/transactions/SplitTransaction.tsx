"use client";

import { useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Badge, Icon } from "@/components/ds";
import { CASH_SOURCE_CATEGORY } from "@/constants/enums";
import { setTransactionSplits } from "@/server/actions/splits";
import { formatMoney, toNum } from "@/server/lib/money";
import type { CategoryOption, SplitPiece } from "@/server/queries";

export interface SplittableTxn {
  id: number;
  description: string;
  category: string | null;
  amount: string | null;
  splits?: SplitPiece[];
}

type Draft = { key: number; category: string; amount: string };

const cents = (n: number) => Math.round(n * 100);
const parseAmount = (s: string) => Number(s.replace(/[$,\s]/g, ""));

/**
 * Per-row "Split" action: file part of one transaction under a different category ($40 of a
 * $100 Target run as Household, the rest stays Groceries). The parts are carved off; the
 * transaction's own category keeps whatever's left, so what you save always adds back up to
 * the full amount. See planning/features/transaction-splits.md.
 */
export function SplitTransaction({
  txn,
  categoryOptions,
  path = "/transactions",
  disabledReason,
}: {
  txn: SplittableTxn;
  categoryOptions: CategoryOption[];
  path?: string;
  /** Set when this row can't be split (a cash withdrawal); shown as the button's tooltip. */
  disabledReason?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [mainCat, setMainCat] = useState(txn.category ?? "");
  const [parts, setParts] = useState<Draft[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const total = toNum(txn.amount) ?? 0;
  const isSplit = (txn.splits?.length ?? 0) > 0;

  function openPanel() {
    setMainCat(txn.category ?? "");
    const seeded = (txn.splits ?? []).map((p, i) => ({
      key: i + 1,
      category: p.category,
      amount: String(toNum(p.amount) ?? ""),
    }));
    const list = seeded.length ? seeded : [{ key: 1, category: "", amount: "" }];
    setParts(list);
    setNextKey(list.length + 1);
    setError("");
    setOpen(true);
  }

  const update = (key: number, patch: Partial<Draft>) =>
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const remove = (key: number) => setParts((prev) => prev.filter((p) => p.key !== key));
  const addPart = () => {
    setParts((prev) => [...prev, { key: nextKey, category: "", amount: "" }]);
    setNextKey((k) => k + 1);
  };

  const splitCents = parts.reduce((s, p) => {
    const n = parseAmount(p.amount);
    return s + (Number.isFinite(n) && n > 0 ? cents(n) : 0);
  }, 0);
  const leftCents = cents(total) - splitCents;
  const filled = parts.filter((p) => p.category || p.amount.trim());
  const incomplete = filled.some((p) => {
    const n = parseAmount(p.amount);
    return !p.category || !Number.isFinite(n) || n <= 0;
  });
  const valid = leftCents > 0 && !incomplete;

  function save(pieces: { category: string; amount: number }[]) {
    setError("");
    start(async () => {
      const res = await setTransactionSplits(txn.id, pieces, { category: mainCat || null, path });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  const inputCls =
    "mp-input !h-9";

  const selectCls = "mp-select !h-9";
  const pickable = (current: string) =>
    categoryOptions.filter((c) => c.active || c.name === current);
  const catSelect = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectCls + " flex-1 min-w-0"}
    >
      <option value="">{placeholder}</option>
      {pickable(value).map((c) => (
        <option key={c.name} value={c.name}>
          {c.emoji ? `${c.emoji} ` : ""}
          {c.name}
        </option>
      ))}
      {value && !categoryOptions.some((c) => c.name === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openPanel())}
        disabled={pending || !!disabledReason}
        title={disabledReason ?? (isSplit ? "Edit how this is split" : "Split across categories")}
        aria-label="Split transaction"
        // Accent when the row is already split, so split rows are findable at a glance.
        className={`mp-btn mp-iconbtn mp-btn--sm ${isSplit ? "mp-btn--soft" : "mp-btn--ghost"}`}
      >
        <Icon name="scissors" size={16} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Split across categories"
        anchorRef={btnRef}
        desktop="anchored"
        width={340}
      >
        <div className="space-y-3 text-left">
          <p className="text-xs text-fg-3">
            <span className="font-medium text-fg">
              {formatMoney(total)}
            </span>{" "}
            · <span className="truncate">{txn.description}</span>
          </p>

          <div className="space-y-1">
            <span className="mp-field__label">Keeps the rest</span>
            <div className="flex items-center gap-2">
              {catSelect(mainCat, setMainCat, "— uncategorized —")}
              <span
                className={`w-20 shrink-0 text-right text-sm tabular-nums font-medium ${
                  leftCents > 0 ? "" : "text-over"
                }`}
              >
                {formatMoney(leftCents / 100)}
              </span>
              <span className="w-6 shrink-0" />
            </div>
          </div>

          <div className="space-y-1">
            <span className="mp-field__label">Split off</span>
            {parts.map((p) => (
              <div key={p.key} className="flex items-center gap-2">
                {catSelect(p.category, (v) => update(p.key, { category: v }), "— category —")}
                <input
                  value={p.amount}
                  onChange={(e) => update(p.key, { amount: e.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                  className={inputCls + " w-20 shrink-0 text-right tabular-nums"}
                />
                <button
                  onClick={() => remove(p.key)}
                  title="Remove this part"
                  aria-label="Remove this part"
                  className="inline-flex w-6 shrink-0 justify-center text-fg-3 hover:text-over"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button onClick={addPart} className="text-xs font-medium text-accent-text hover:underline">
                Add another part
              </button>
              {parts.length === 1 && total > 0 && (
                <button
                  onClick={() =>
                    update(parts[0].key, { amount: (Math.floor(cents(total) / 2) / 100).toFixed(2) })
                  }
                  className="text-xs text-fg-3 hover:underline"
                  title="Split it down the middle"
                >
                  Half
                </button>
              )}
            </div>
          </div>

          {parts.some((p) => p.category === CASH_SOURCE_CATEGORY) && (
            <p className="text-[11px] text-warn">
              The {CASH_SOURCE_CATEGORY} part is treated as cash back: it works like an ATM
              withdrawal, so cash purchases can be offset against it on /cash.
            </p>
          )}
          {leftCents <= 0 && (
            <p className="text-xs text-over">
              The parts can&apos;t take the whole {formatMoney(total)} — something has to stay in
              the first category.
            </p>
          )}
          {error && <p className="text-xs text-over">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {isSplit && (
              <button
                onClick={() => save([])}
                disabled={pending}
                className="mp-btn mp-btn--ghost mp-btn--sm !text-over"
                title="Put the whole amount back in one category"
              >
                Unsplit
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="ml-auto mp-btn mp-btn--ghost mp-btn--sm"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                save(filled.map((p) => ({ category: p.category, amount: parseAmount(p.amount) })))
              }
              disabled={pending || !valid}
              className="mp-btn mp-btn--primary mp-btn--sm"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/**
 * The parts of a split row, shown under its category: what the row's own category keeps, then
 * each piece carved off it.
 */
export function SplitSummary({
  amount,
  splits,
  categoryOptions,
}: {
  amount: string | null;
  splits: SplitPiece[];
  categoryOptions: CategoryOption[];
}) {
  if (!splits.length) return null;
  const meta = new Map(categoryOptions.map((c) => [c.name, c]));
  const splitCents = splits.reduce((s, p) => s + cents(toNum(p.amount) ?? 0), 0);
  const keeps = (cents(toNum(amount) ?? 0) - splitCents) / 100;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-3">
      <span className="inline-flex items-center gap-1 tabular-nums" title="What stays in the category above">
        <Icon name="scissors" size={11} />
        {formatMoney(keeps)} here
      </span>
      {splits.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 tabular-nums">
          + {formatMoney(p.amount)}
          <Badge
            label={p.category}
            color={meta.get(p.category)?.color}
            emoji={meta.get(p.category)?.emoji}
            size="sm"
          />
        </span>
      ))}
    </div>
  );
}

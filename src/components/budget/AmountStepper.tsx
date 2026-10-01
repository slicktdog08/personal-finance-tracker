"use client";

import { useState } from "react";
import { formatMoney } from "@/server/lib/money";

/**
 * Phone money control: − / a big tappable number / +. Tap the number to type; Enter or blur
 * commits, Esc cancels. Buttons step by `step` and commit at once. 44px targets.
 */
export function AmountStepper({
  value,
  step = 25,
  min = 0,
  max,
  onCommit,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  const parse = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return s.trim() === "" || Number.isNaN(n) ? null : clamp(Math.round(n));
  };
  const btn =
    "h-11 w-11 shrink-0 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xl leading-none select-none active:scale-95 transition-transform disabled:opacity-30";
  return (
    <div className="flex items-center justify-between gap-2 w-full" role="group" aria-label={ariaLabel}>
      <button type="button" className={btn} disabled={disabled || value - step < min} onClick={() => onCommit(clamp(value - step))} aria-label={`Decrease ${ariaLabel} by ${step}`}>
        −
      </button>
      {text == null ? (
        <button type="button" disabled={disabled} onClick={() => setText(String(value))} className="h-11 flex-1 rounded-xl text-2xl font-semibold tabular-nums tracking-tight active:bg-neutral-100 dark:active:bg-neutral-800 disabled:cursor-default" title="Tap to type an amount">
          {formatMoney(value)}
        </button>
      ) : (
        <input
          autoFocus
          inputMode="numeric"
          aria-label={`${ariaLabel} (typed)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = parse(text);
            setText(null);
            if (n != null && n !== value) onCommit(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
          }}
          className="h-11 flex-1 min-w-0 rounded-xl border border-indigo-400 bg-transparent text-center text-2xl font-semibold tabular-nums outline-none ring-2 ring-indigo-400/20"
        />
      )}
      <button type="button" className={btn} disabled={disabled || (max != null && value + step > max)} onClick={() => onCommit(clamp(value + step))} aria-label={`Increase ${ariaLabel} by ${step}`}>
        +
      </button>
    </div>
  );
}

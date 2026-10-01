"use client";

import { useState } from "react";

/**
 * Desktop money control: a slim track with a filled portion in the envelope's color and a
 * typed field to its right. `onChange` fires while dragging; `onCommit` once on release / blur /
 * Enter / arrow keys. Styled via `.envelope-range` in globals.css.
 */
export function AmountSlider({
  value,
  max,
  min = 0,
  step = 5,
  color,
  disabled,
  ariaLabel,
  onChange,
  onCommit,
}: {
  value: number;
  max: number;
  min?: number;
  step?: number;
  color?: string | null;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const hi = Math.max(max, value, min + step);
  const pct = ((Math.min(Math.max(value, min), hi) - min) / (hi - min)) * 100;
  const parse = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return s.trim() === "" || Number.isNaN(n) ? null : Math.max(min, Math.round(n));
  };
  const commit = (v: number) => onCommit?.(v);
  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <input
        type="range"
        min={min}
        max={hi}
        step={step}
        value={Math.min(Math.max(value, min), hi)}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key))
            commit(Number((e.target as HTMLInputElement).value));
        }}
        className="envelope-range flex-1 min-w-16 cursor-pointer disabled:cursor-default"
        style={{ "--range-color": color || "#6366f1", "--range-pct": `${pct}%` } as React.CSSProperties}
      />
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
        <input
          inputMode="numeric"
          aria-label={`${ariaLabel} (typed)`}
          value={text ?? String(value)}
          disabled={disabled}
          onFocus={() => setText(String(value))}
          onChange={(e) => {
            setText(e.target.value);
            const n = parse(e.target.value);
            if (n != null) onChange(n);
          }}
          onBlur={() => {
            const n = text != null ? parse(text) : null;
            setText(null);
            if (n != null) commit(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-9 w-24 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 pl-5 pr-2 text-right text-sm font-semibold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 disabled:opacity-40"
        />
      </div>
    </div>
  );
}

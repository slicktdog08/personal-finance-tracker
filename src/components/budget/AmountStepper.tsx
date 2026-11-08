"use client";

import { useState } from "react";
import { IconButton, Input, Money } from "@/components/ds";

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
  return (
    <div className="flex items-center justify-between gap-2 w-full" role="group" aria-label={ariaLabel}>
      <IconButton
        icon="minus"
        variant="secondary"
        size="lg"
        className="h-11 w-11 shrink-0"
        disabled={disabled || value - step < min}
        onClick={() => onCommit(clamp(value - step))}
        label={`Decrease ${ariaLabel} by ${step}`}
      />
      {text == null ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setText(String(value))}
          className="h-11 flex-1 rounded-control active:bg-hover disabled:cursor-default"
          title="Tap to type an amount"
        >
          <Money value={value} kind="neutral" style={{ font: "var(--mp-type-money-md)" }} />
        </button>
      ) : (
        <Input
          autoFocus
          money
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
          className="h-11 flex-1 min-w-0 text-center! text-xl font-semibold"
        />
      )}
      <IconButton
        icon="plus"
        variant="secondary"
        size="lg"
        className="h-11 w-11 shrink-0"
        disabled={disabled || (max != null && value + step > max)}
        onClick={() => onCommit(clamp(value + step))}
        label={`Increase ${ariaLabel} by ${step}`}
      />
    </div>
  );
}

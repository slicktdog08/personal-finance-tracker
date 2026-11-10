"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton, Input, Money } from "@/components/ds";

/**
 * Phone money control: − / a big tappable number / +. Tap the number to type; Enter or blur
 * commits, Esc cancels. 44px targets.
 *
 * Buttons step by `step` from what's SHOWN, not from the saved amount: each tap moves a local draft
 * at once, and the draft is committed once the taps pause (COMMIT_DELAY). Committing every tap made
 * each one wait on a server round trip, and taps made meanwhile all stepped from the same stale
 * amount — so they seemed to lag, lock up, or get lost. The draft gives way once the saved amount
 * catches up (or changes for any other reason).
 */
const COMMIT_DELAY = 450;

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
  const [draft, setDraft] = useState<number | null>(null);
  const [last, setLast] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The saved amount moved: drop the draft unless taps are still waiting to be committed.
  if (last !== value) {
    setLast(value);
    if (timer.current == null) setDraft(null);
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const shown = draft ?? value;
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  const flush = (n: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (n !== value) onCommit(n);
    else setDraft(null);
  };
  const stepBy = (d: number) => {
    const n = clamp(shown + d);
    setDraft(n);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(n), COMMIT_DELAY);
  };
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
        disabled={disabled || shown <= min}
        onClick={() => stepBy(-step)}
        label={`Decrease ${ariaLabel} by ${step}`}
      />
      {text == null ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setText(String(shown))}
          className="h-11 flex-1 rounded-control active:bg-hover disabled:cursor-default"
          title="Tap to type an amount"
        >
          <Money value={shown} kind="neutral" style={{ font: "var(--mp-type-money-md)" }} />
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
            if (n == null) return;
            setDraft(n);
            flush(n);
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
        disabled={disabled || (max != null && shown >= max)}
        onClick={() => stepBy(step)}
        label={`Increase ${ariaLabel} by ${step}`}
      />
    </div>
  );
}

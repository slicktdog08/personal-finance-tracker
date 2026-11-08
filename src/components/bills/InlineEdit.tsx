"use client";

import { useState } from "react";
import { cx } from "@/components/ds";

/**
 * Read-as-text, click-to-edit cell for the month table. Shows the formatted value (a <Money>, "Oct 3")
 * until clicked, then a compact input that commits on blur or Enter and reverts on Escape. Clicks are
 * stopped so they don't also open the row's edit sheet.
 */
export function InlineEdit({
  value,
  render,
  onCommit,
  label,
  inputMode,
  type = "text",
  min,
  max,
  className,
  inputClassName,
}: {
  /** The raw value the input starts from ("" when unset). */
  value: string;
  /** Display for a value — receives the optimistic value while a save is in flight. */
  render: (v: string) => React.ReactNode;
  onCommit: (v: string) => void;
  label: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: "text" | "number";
  min?: number;
  max?: number;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  // Show what was typed until the refreshed server value arrives, so the cell doesn't flash back.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setOptimistic(null);
  }
  const shown = optimistic ?? value;

  if (!editing)
    return (
      <button
        type="button"
        title={`Edit ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={cx(
          "-mx-1.5 max-w-full rounded-chip px-1.5 py-0.5 text-left outline-none hover:bg-hover hover:shadow-[inset_0_0_0_1px_var(--mp-border-2)] focus-visible:shadow-[var(--mp-focus-ring)]",
          className,
        )}
      >
        {render(shown)}
      </button>
    );

  return (
    <input
      autoFocus
      aria-label={label}
      type={type}
      min={min}
      max={max}
      inputMode={inputMode}
      defaultValue={shown}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        setEditing(false);
        const v = e.currentTarget.value;
        if (v !== shown) {
          setOptimistic(v);
          onCommit(v);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = shown;
          e.currentTarget.blur();
        }
      }}
      className={cx(
        "h-8 rounded-control border border-accent bg-surface px-2 text-sm text-fg outline-none shadow-[0_0_0_3px_color-mix(in_oklch,var(--mp-accent)_22%,transparent)]",
        inputClassName,
      )}
    />
  );
}

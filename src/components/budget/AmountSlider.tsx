"use client";

import { useState } from "react";
import { Input, Slider } from "@/components/ds";

/**
 * Desktop money control: the design system's slider in the envelope's color and a typed field
 * to its right. `onChange` fires while dragging; `onCommit` once on release / blur / Enter /
 * arrow keys — so a drag is one server write, not fifty.
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
  const parse = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return s.trim() === "" || Number.isNaN(n) ? null : Math.max(min, Math.round(n));
  };
  const commit = (v: number) => onCommit?.(v);
  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <Slider
        min={min}
        max={hi}
        step={step}
        value={Math.min(Math.max(value, min), hi)}
        color={color ?? undefined}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={onChange}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key))
            commit(Number((e.target as HTMLInputElement).value));
        }}
        className="flex-1 min-w-16 cursor-pointer disabled:cursor-default disabled:opacity-40"
      />
      <div className="w-28 shrink-0">
        <Input
          money
          icon="dollar-sign"
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
          className="h-9 font-semibold"
        />
      </div>
    </div>
  );
}

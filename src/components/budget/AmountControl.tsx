"use client";

import { useState } from "react";
import { useIsDesktop } from "@/components/ui/useMediaQuery";
import { AmountSlider } from "@/components/budget/AmountSlider";
import { AmountStepper } from "@/components/budget/AmountStepper";

/**
 * The one amount control: slider + typed field at md and up, − / number / + below. Both call
 * `onCommit` once per settled change; a slider drag previews locally (draft dropped when the
 * committed prop arrives) and optionally via `onPreview`.
 */
export function AmountControl({
  value,
  max,
  min = 0,
  step = 25,
  sliderStep,
  color,
  disabled = false,
  ariaLabel,
  onCommit,
  onPreview,
}: {
  value: number;
  max: number;
  min?: number;
  step?: number;
  sliderStep?: number;
  color?: string | null;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (v: number) => void;
  onPreview?: (v: number) => void;
}) {
  const desktop = useIsDesktop();
  const [draft, setDraft] = useState<number | null>(null);
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setDraft(null);
  }
  if (!desktop) return <AmountStepper value={value} step={step} min={min} max={max} disabled={disabled} ariaLabel={ariaLabel} onCommit={onCommit} />;
  return (
    <AmountSlider
      value={draft ?? value}
      max={max}
      min={min}
      step={sliderStep ?? Math.max(1, Math.round(step / 5))}
      color={color}
      disabled={disabled}
      ariaLabel={ariaLabel}
      onChange={(v) => {
        setDraft(v);
        onPreview?.(v);
      }}
      onCommit={(v) => {
        if (v !== value) onCommit(v);
        else setDraft(null);
      }}
    />
  );
}

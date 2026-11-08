import { Money, ProgressBar } from "@/components/ds";

export interface FlowSegment {
  label: string;
  value: number;
  color: string;
  muted?: boolean;
}

/**
 * Where the month's income goes, as one bar. Segments are proportional to `total` (income);
 * a legend beneath names each with a colored square and a whole-dollar figure. Zero segments are
 * skipped in the bar so it never shows a hairline of nothing.
 */
export function FlowBar({ segments, total, className }: { segments: FlowSegment[]; total: number; className?: string }) {
  const shown = segments.filter((s) => s.value > 0);
  const base = Math.max(total, shown.reduce((s, x) => s + x.value, 0), 1);
  const tint = (s: FlowSegment) => (s.muted ? `color-mix(in oklch, ${s.color} 45%, transparent)` : s.color);
  return (
    <div className={className}>
      <ProgressBar size="lg" max={base} segments={shown.map((s) => ({ value: s.value, color: tint(s) }))} label="Where income goes" />
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <i aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: tint(s) }} />
            <span className="text-fg-2">{s.label}</span>
            <Money value={s.value} kind="neutral" whole className="font-medium" />
          </span>
        ))}
      </div>
    </div>
  );
}

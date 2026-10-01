import { formatMoney } from "@/server/lib/money";

export interface FlowSegment {
  label: string;
  value: number;
  color: string;
  muted?: boolean;
}

/**
 * Where the month's income goes, as one bar. Segments are proportional to `total` (income);
 * a legend beneath names each with a colored dot. Zero segments are skipped so the bar never
 * shows a hairline of nothing.
 */
export function FlowBar({ segments, total }: { segments: FlowSegment[]; total: number }) {
  const shown = segments.filter((s) => s.value > 0);
  const base = Math.max(total, shown.reduce((s, x) => s + x.value, 0), 1);
  return (
    <div>
      <div className="h-3 w-full flex overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        {shown.map((s) => (
          <div
            key={s.label}
            className="h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / base) * 100}%`, backgroundColor: s.color, opacity: s.muted ? 0.35 : 1 }}
            title={`${s.label}: ${formatMoney(s.value)}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color, opacity: s.muted ? 0.5 : 1 }} />
            <span className="text-neutral-500">{s.label}</span>
            <span className="font-medium">{formatMoney(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

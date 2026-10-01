"use client";

import { formatMoney } from "@/server/lib/money";

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

// valueFormat is a string flag (not a function) because this client component is
// rendered from server components, which can't pass functions as props.
export function BarsChart({
  labels,
  series,
  height = 170,
  valueFormat = "number",
  highlightIndex = -1,
}: {
  labels: string[];
  series: BarSeries[];
  height?: number;
  valueFormat?: "money" | "number";
  highlightIndex?: number;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const fmt = valueFormat === "money" ? formatMoney : (n: number) => String(n);

  if (labels.length === 0) {
    return <p className="text-sm text-neutral-500">No data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Bars and labels scroll together sideways on narrow screens instead of
          crushing the fixed-width bars into the container. ~30px per month keeps
          the labels legible. */}
      <div className="overflow-x-auto">
        <div className="space-y-2" style={{ minWidth: labels.length * 30 }}>
      <div className="flex items-end gap-1" style={{ height }}>
        {labels.map((lab, i) => (
          <div
            key={lab + i}
            className={`flex-1 h-full flex flex-col justify-end rounded ${
              i === highlightIndex ? "bg-blue-100/60 dark:bg-blue-950/40 ring-1 ring-blue-300 dark:ring-blue-800" : ""
            }`}
          >
            <div className="flex items-end justify-center gap-0.5 h-full">
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                const h = (v / max) * 100;
                return (
                  <div
                    key={s.name}
                    title={`${lab} · ${s.name}: ${fmt(v)}`}
                    style={{ height: `${h}%`, backgroundColor: s.color }}
                    className="w-2.5 rounded-t transition-all hover:opacity-80 min-h-[2px]"
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {labels.map((lab, i) => (
          <div
            key={lab + i}
            className={`flex-1 text-center text-[10px] truncate ${
              i === highlightIndex
                ? "font-bold text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500"
            }`}
          >
            {lab}
          </div>
        ))}
      </div>
        </div>
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

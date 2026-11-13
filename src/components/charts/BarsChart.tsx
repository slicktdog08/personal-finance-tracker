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
    return <p className="text-sm text-fg-3">No data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Bars and labels scroll together sideways on narrow screens instead of
          crushing the fixed-width bars into the container. ~34px per group (more
          with several series side by side) keeps the labels legible. */}
      <div className="overflow-x-auto">
        <div className="space-y-2" style={{ minWidth: labels.length * Math.max(34, series.length * 10 + 12) }}>
      <div className="flex items-end gap-1" style={{ height }}>
        {labels.map((lab, i) => (
          <div
            key={lab + i}
            className={`flex-1 h-full flex flex-col justify-end rounded ${
              i === highlightIndex ? "bg-sunken" : ""
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
                    className="w-2 rounded-t-[3px] transition-all hover:opacity-80 min-h-[2px]"
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
                ? "font-semibold text-fg"
                : "text-fg-3"
            }`}
          >
            {lab}
          </div>
        ))}
      </div>
        </div>
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

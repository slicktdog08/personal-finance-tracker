"use client";

import { formatMoney } from "@/server/lib/money";

export interface DeltaBarPoint {
  label: string; // "Jan '25"
  value: number | null; // null = no comparable month (nothing recorded on one side)
}

/**
 * Month-over-month change as bars around a shared zero line: gains rise in income green, losses
 * hang in the over red. The one chart here that must show negatives, which BarsChart can't.
 * Bars and labels scroll together sideways on narrow screens, like BarsChart.
 */
export function DeltaBars({ points, height = 170 }: { points: DeltaBarPoint[]; height?: number }) {
  const values = points.flatMap((p) => (p.value == null ? [] : [p.value]));
  if (!values.length) return <p className="text-sm text-fg-3">No data yet.</p>;

  const maxUp = Math.max(1, ...values.filter((v) => v > 0), 0);
  const maxDown = Math.max(1, ...values.filter((v) => v < 0).map(Math.abs), 0);
  // The zero line sits where the data needs it, with each side getting room for its extreme.
  const upShare = (maxUp / (maxUp + maxDown)) * 100;

  return (
    <div className="overflow-x-auto">
      <div className="space-y-2" style={{ minWidth: points.length * 30 }}>
        <div className="relative" style={{ height }}>
          <div className="absolute inset-x-0 border-t border-line-2" style={{ top: `${upShare}%` }} aria-hidden />
          <div className="flex h-full gap-1">
            {points.map((p, i) => {
              const v = p.value ?? 0;
              const up = v >= 0;
              const side = up ? upShare : 100 - upShare;
              const h = p.value == null ? 0 : (Math.abs(v) / (up ? maxUp : maxDown)) * side;
              return (
                <div key={p.label + i} className="relative flex-1" title={p.value == null ? `${p.label}: no record` : `${p.label}: ${v >= 0 ? "+" : "−"}${formatMoney(Math.abs(v))}`}>
                  {p.value != null && (
                    <div
                      className="absolute inset-x-[15%] rounded-[3px] transition-all hover:opacity-80"
                      style={{
                        height: `${Math.max(h, 1)}%`,
                        ...(up ? { bottom: `${100 - upShare}%` } : { top: `${upShare}%` }),
                        backgroundColor: up ? "var(--mp-money-income)" : "var(--mp-money-over)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex gap-1">
          {points.map((p, i) => (
            <div key={p.label + i} className="flex-1 text-center text-[10px] truncate text-fg-3">
              {p.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

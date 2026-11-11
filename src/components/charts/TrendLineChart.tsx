"use client";

import { useId, useState } from "react";
import { Money } from "@/components/ds";
import { formatMoney } from "@/server/lib/money";

export interface TrendPoint {
  /** "Jan '25" — the x-axis tick and the readout's month name. */
  label: string;
  value: number | null; // null = not recorded that month
}

/**
 * MiPlata monthly trend line: one value per month across every tracked period, drawn in the same
 * voice as the cash chart — accent line over the design system's one allowed gradient, no
 * gridlines, a dashed rule where the line crosses zero. Leading months with no value are skipped
 * so the line begins where the record does.
 *
 * Hover / touch snaps to a month and the readout above says the value and the change against the
 * month before. With no pointer the readout rests on the latest month.
 */
export function TrendLineChart({
  points,
  height = 210,
  color: colorProp,
  label = "Net worth by month",
  goodWhen = "up",
}: {
  points: TrendPoint[];
  height?: number;
  /** Line colour; defaults to accent, or owed red once the latest value is below zero. */
  color?: string;
  /** Accessible name for the chart. */
  label?: string;
  /** For a debt series a fall is the good direction — only changes how the readout's delta reads. */
  goodWhen?: "up" | "down";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId();

  // Keep the original index so x stays proportional to time even when leading months are null.
  const defined = points.flatMap((p, i) => (p.value == null ? [] : [{ ...p, value: p.value, i }]));
  if (defined.length < 2) return null;

  const W = 640;
  const H = height;
  const pad = 8;
  const denom = Math.max(1, points.length - 1);
  const values = defined.map((d) => d.value);
  const span0 = Math.max(...values) - Math.min(...values);
  const lo = Math.min(...values) - Math.max(span0 * 0.08, 50);
  const hi = Math.max(...values) + Math.max(span0 * 0.08, 50);
  const x = (i: number) => pad + (i / denom) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const line = defined.map((d, k) => `${k ? "L" : "M"}${x(d.i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const first = defined[0];
  const last = defined[defined.length - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const want = (((e.clientX - r.left) / r.width) * W - pad) / ((W - pad * 2) / denom);
    let best = 0;
    for (let k = 1; k < defined.length; k++) if (Math.abs(defined[k].i - want) < Math.abs(defined[best].i - want)) best = k;
    setHover(best);
  };

  const active = defined[hover ?? defined.length - 1];
  const activePos = hover ?? defined.length - 1;
  const prev = activePos > 0 ? defined[activePos - 1] : null;
  const delta = prev ? active.value - prev.value : null;
  const color = colorProp ?? (last.value < 0 ? "var(--mp-money-owed)" : "var(--mp-accent)");
  const deltaGood = delta == null || Math.abs(delta) < 0.5 ? null : (delta > 0) === (goodWhen === "up");
  const pct = (px: number) => `${(px / W) * 100}%`;

  // Ticks: first, last, and a handful of evenly spaced months in between (by original index).
  const every = Math.max(1, Math.ceil(points.length / 8));
  const ticks = points.flatMap((p, i) =>
    i === 0 || i === points.length - 1 || (i % every === 0 && i <= points.length - 1 - every / 2) ? [{ label: p.label, i }] : [],
  );

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mb-2 min-h-[22px] text-xs text-fg-3">
        <span className="text-[13px] text-fg-2">{active.label}</span>
        <Money value={active.value} kind={active.value < 0 ? "over" : "neutral"} className="text-sm font-semibold" />
        {delta != null && (
          <span className={deltaGood == null ? undefined : deltaGood ? "text-income" : "text-over"}>
            {delta >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(delta))} vs {prev!.label}
          </span>
        )}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          className="block touch-none cursor-crosshair"
          role="img"
          aria-label={label}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: color }} stopOpacity=".16" />
              <stop offset="1" style={{ stopColor: color }} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${x(last.i).toFixed(1)} ${H} L${x(first.i).toFixed(1)} ${H} Z`} fill={`url(#${gradId})`} />
          {lo < 0 && hi > 0 && (
            <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} style={{ stroke: "var(--mp-money-over)" }} strokeOpacity=".5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          )}
          <path d={line} fill="none" style={{ stroke: color }} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <line x1={x(active.i)} x2={x(active.i)} y1={0} y2={H} style={{ stroke: "var(--mp-text-3)" }} strokeOpacity=".35" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* The marker is HTML so it stays round while the SVG stretches to the card's width. */}
        <span
          aria-hidden
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface"
          style={{ left: pct(x(active.i)), top: y(active.value), borderColor: color }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-xs text-fg-3">
        {ticks.map((t, k) => (
          <span
            key={t.i}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: pct(x(t.i)),
              transform: k === 0 ? "translateX(-8px)" : k === ticks.length - 1 ? "translateX(calc(-100% + 8px))" : "translateX(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

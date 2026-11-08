"use client";

import { useId, useState } from "react";
import { Money } from "@/components/ds";
import { dayLabel } from "@/components/dashboard/kit";
import { daysBetween, isoToUtc, utcToIso } from "@/server/lib/pay-schedule";

export interface CashLineDay {
  date: string;
  balance: number;
  /** actual = the balance ledger (solid); projected = the plan from today on (dashed). */
  kind: "actual" | "projected";
  /** Actual days only: a balance was recorded that day, rather than carried forward. */
  recorded?: boolean;
  /** Projected days only: what moved the money ("Rent −$1,200.00 · everyday −$91.65"). */
  note?: string;
}

/**
 * MiPlata cash line: cash on hand by day, recorded (solid accent) joined to projected (dashed
 * accent) at today, over a faint accent fade — the only gradient the design system allows. A thin
 * sky line is the month as budgeted; the gap between the two IS "above or below plan". The lowest
 * projected day gets a ringed marker. No gridlines; a dotted rule marks each month boundary.
 *
 * Hover / touch snaps to a day and the readout above says the balance, whether it was recorded or
 * projected, and where the plan had it. With no pointer the readout rests on the last recorded day.
 * Every color is a CSS variable, applied through `style` so it follows the theme.
 */
export function CashLineChart({
  days,
  plan = [],
  low,
  start,
  end,
  height = 190,
}: {
  days: CashLineDay[];
  plan?: { date: string; balance: number }[];
  low?: { date: string; balance: number } | null;
  /** First and last day on the x-axis. */
  start: string;
  end: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = `cash-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (days.length < 2) return null;

  const W = 640;
  const H = height;
  const pad = 8;
  const total = Math.max(1, daysBetween(start, end));
  const values = [...days.map((d) => d.balance), ...plan.map((d) => d.balance)];
  const span0 = Math.max(...values) - Math.min(...values);
  // Breathing room above and below so the line never rides the card edge.
  const lo = Math.min(...values) - Math.max(span0 * 0.08, 50);
  const hi = Math.max(...values) + Math.max(span0 * 0.08, 50);
  const xi = (i: number) => pad + (i / total) * (W - pad * 2);
  const x = (iso: string) => xi(daysBetween(start, iso));
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const path = (pts: { date: string; balance: number }[]) =>
    pts.map((d, k) => `${k ? "L" : "M"}${x(d.date).toFixed(1)} ${y(d.balance).toFixed(1)}`).join(" ");

  const actual = days.filter((d) => d.kind === "actual");
  const projected = days.filter((d) => d.kind === "projected");
  const join = actual[actual.length - 1];
  const projLine = join && projected.length ? [join, ...projected] : projected;
  const planOn = new Map(plan.map((d) => [d.date, d.balance]));

  // Month boundaries + ticks on the 1st and 15th, and the last day.
  const boundaries: string[] = [];
  const ticks: string[] = [];
  for (let t = isoToUtc(start); utcToIso(t) <= end; t += 86_400_000) {
    const iso = utcToIso(t);
    const d = Number(iso.slice(8, 10));
    if (d === 1 && iso !== start) boundaries.push(iso);
    if (d === 1 || d === 15) ticks.push(iso);
  }
  if (!ticks.includes(start)) ticks.unshift(start);
  // Drop a tick that would crowd the final label.
  while (ticks.length && daysBetween(ticks[ticks.length - 1], end) < 6 && ticks[ticks.length - 1] !== end) ticks.pop();
  ticks.push(end);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const want = Math.round((((e.clientX - r.left) / r.width) * W - pad) / ((W - pad * 2) / total));
    let best = 0;
    for (let i = 1; i < days.length; i++)
      if (Math.abs(daysBetween(start, days[i].date) - want) < Math.abs(daysBetween(start, days[best].date) - want)) best = i;
    setHover(best);
  };
  const rest = actual.length ? days.indexOf(join) : 0;
  const active = days[hover ?? rest];
  const planHere = planOn.get(active.date) ?? null;
  const pct = (px: number) => `${(px / W) * 100}%`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mb-2 min-h-[22px] text-xs text-fg-3">
        <span className="text-[13px] text-fg-2">{dayLabel(active.date)}</span>
        <Money value={active.balance} kind={active.balance < 0 ? "over" : "neutral"} className="text-sm font-semibold" />
        <span className="min-w-0">
          {active.kind === "actual" ? (active.recorded ? "recorded" : "carried forward") : "projected"}
          {planHere != null && (
            <>
              {" · plan "}
              <Money value={planHere} kind="plan" />
            </>
          )}
          {active.note && <> · {active.note}</>}
          {low && active.date === low.date && active.kind === "projected" && " · lowest ahead"}
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          className="block touch-none cursor-crosshair"
          role="img"
          aria-label="Cash on hand by day: recorded so far, projected ahead, against the month as budgeted"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--mp-accent)" }} stopOpacity=".16" />
              <stop offset="1" style={{ stopColor: "var(--mp-accent)" }} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path(days)} L${x(days[days.length - 1].date).toFixed(1)} ${H} L${x(days[0].date).toFixed(1)} ${H} Z`} fill={`url(#${gid})`} />
          {boundaries.map((b) => (
            <line key={b} x1={x(b)} x2={x(b)} y1={0} y2={H} style={{ stroke: "var(--mp-border-2)" }} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          {lo < 0 && hi > 0 && (
            <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} style={{ stroke: "var(--mp-money-over)" }} strokeOpacity=".5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          )}
          {plan.length > 1 && (
            <path d={path(plan)} fill="none" style={{ stroke: "var(--mp-money-plan)" }} strokeWidth="1.25" strokeOpacity=".55" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
          {actual.length > 1 && (
            <path d={path(actual)} fill="none" style={{ stroke: "var(--mp-accent)" }} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
          {projLine.length > 1 && (
            <path d={path(projLine)} fill="none" style={{ stroke: "var(--mp-accent)" }} strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
          <line x1={x(active.date)} x2={x(active.date)} y1={0} y2={H} style={{ stroke: "var(--mp-text-3)" }} strokeOpacity=".35" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Markers are HTML so they stay round while the SVG stretches to the card's width. */}
        {low && low.date >= start && low.date <= end && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface"
            style={{ left: pct(x(low.date)), top: y(low.balance), borderColor: low.balance < 0 ? "var(--mp-money-over)" : "var(--mp-money-plan)" }}
          />
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface"
          style={{ left: pct(x(active.date)), top: y(active.balance) }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-xs text-fg-3">
        {ticks.map((t, i) => (
          <span
            key={t}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: pct(x(t)),
              transform: i === 0 ? "translateX(-8px)" : i === ticks.length - 1 ? "translateX(calc(-100% + 8px))" : "translateX(-50%)",
            }}
          >
            {dayLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

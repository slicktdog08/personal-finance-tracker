"use client";

import { useState } from "react";
import { formatMoney } from "@/server/lib/money";
import { formatDate, shortMonthLabel } from "@/server/lib/period";
import { daysBetween, isoToUtc, utcToIso } from "@/server/lib/pay-schedule";
import type { CashProjection } from "@/server/lib/cash-projection";
import type { DailyCashPoint } from "@/server/queries";

type Day =
  | { date: string; balance: number; kind: "actual"; recorded: boolean }
  | { date: string; balance: number; kind: "projected"; paycheck: boolean; outflow: boolean; spread: number };

/**
 * Cash on hand across the horizon: what happened this month (solid, dots on recorded days, from
 * the balance ledger) joined to what's projected (dashed, lighter fill) at the last recorded day —
 * on into next month, so the 1st-of-the-month cliff is on the chart. A vertical rule marks the
 * month boundary. Hover/touch snaps to a day; the readout above says measured / carried /
 * projected and what moved the money.
 *
 * A third, thinner line is the FORECAST HISTORY: for each day a projection was recorded, where
 * that day's projection said the month would END. It shares the dollar axis and is plotted against
 * the day the forecast was made, so the drift reads as a shape — flat means the plan is holding,
 * a slide means the month is getting away — and it converges on the dashed line's endpoint as the
 * month runs out. This is the same information the "on the 21st this looked like …" sentence
 * carries, except you can see every day of it at once.
 */
export function CashMonthChart({
  daily,
  projection: p,
  monthStart,
  horizonEnd,
}: {
  daily: DailyCashPoint[];
  projection: CashProjection | null;
  monthStart: string; // YYYY-MM-DD
  horizonEnd: string; // last day drawn (this month's end, or the projection's horizon)
}) {
  const [hover, setHover] = useState<number | null>(null);

  const actual: Day[] = daily.map((d) => ({ date: d.date, balance: d.total, kind: "actual", recorded: d.recorded }));
  const lastActual = actual[actual.length - 1]?.date ?? null;
  const projected: Day[] = (p?.days ?? [])
    .filter((d) => d.date >= monthStart && d.date <= horizonEnd && (lastActual == null || d.date > lastActual))
    .map((d) => ({ date: d.date, balance: d.balance, kind: "projected", paycheck: d.paycheck, outflow: d.outflow, spread: d.spread }));
  const seed: Day[] = actual.length === 0 && p ? [{ date: p.asOf < monthStart ? monthStart : p.asOf, balance: p.start, kind: "actual", recorded: false }] : [];
  const days: Day[] = [...seed, ...actual, ...projected];
  if (days.length < 2) return null;

  // Forecast history: one point per day a projection was recorded, at what it said month-end
  // would be. Only inside the drawn window, and only once there are two to make a line of.
  const forecast = (p?.trend?.series ?? []).filter((s) => s.takenOn >= monthStart && s.takenOn <= horizonEnd);
  const showForecast = forecast.length > 1;

  const width = 640;
  const height = 160;
  const padX = 8;
  const padTop = 14;
  const padBottom = 28;
  const values = [...days.map((d) => d.balance), ...(showForecast ? forecast.map((s) => s.endBalance) : [])];
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const total = Math.max(1, daysBetween(monthStart, horizonEnd)); // x-axis length in days
  const idxOf = (iso: string) => daysBetween(monthStart, iso);
  const xOfIdx = (i: number) => padX + (i / total) * (width - padX * 2);
  const x = (iso: string) => xOfIdx(idxOf(iso));
  const y = (v: number) => padTop + (1 - (v - min) / span) * (height - padTop - padBottom);
  const pt = (d: Day) => `${x(d.date).toFixed(1)},${y(d.balance).toFixed(1)}`;
  const base = y(Math.max(min, 0));

  const actualDays = days.filter((d) => d.kind === "actual");
  const joinIdx = actualDays.length - 1;
  const projLine = joinIdx >= 0 && projected.length ? [days[joinIdx], ...projected] : projected;
  const areaOf = (seg: Day[]) => (seg.length ? `${x(seg[0].date).toFixed(1)},${base} ${seg.map(pt).join(" ")} ${x(seg[seg.length - 1].date).toFixed(1)},${base}` : "");
  const lowProj = p && projected.length ? projected.reduce((m, d) => (d.balance < m.balance ? d : m), projected[0]) : null;
  const color = "#059669";
  // Indigo, not a shade of the cash green: it is a different quantity (a forecast made on that
  // day), so it must not read as more cash history.
  const forecastColor = "#6366f1";
  const forecastPts = forecast.map((s) => `${x(s.takenOn).toFixed(1)},${y(s.endBalance).toFixed(1)}`).join(" ");

  // Month boundaries + ticks: the 1st and 15th of every month on the axis, labeled with the month.
  const boundaries: string[] = [];
  const ticks: { iso: string; label: string }[] = [];
  for (let t = isoToUtc(monthStart); utcToIso(t) <= horizonEnd; t += 86_400_000) {
    const iso = utcToIso(t);
    const d = Number(iso.slice(8, 10));
    if (d === 1 && iso !== monthStart) boundaries.push(iso);
    if (d === 1 || d === 15) ticks.push({ iso, label: d === 1 ? shortMonthLabel(iso.slice(0, 7)).replace(/ '\d\d$/, "") + " 1" : "15" });
  }
  if (!ticks.some((k) => k.iso === horizonEnd)) ticks.push({ iso: horizonEnd, label: String(Number(horizonEnd.slice(8, 10))) });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const want = Math.round(((px - padX) / (width - padX * 2)) * total);
    let best = 0;
    for (let i = 1; i < days.length; i++) if (Math.abs(idxOf(days[i].date) - want) < Math.abs(idxOf(days[best].date) - want)) best = i;
    setHover(best);
  };
  const idx = hover ?? (actualDays.length ? joinIdx : days.length - 1);
  const active = days[idx];
  const prev = idx > 0 ? days[idx - 1] : null;
  const change = prev ? active.balance - prev.balance : null;
  const events = active.kind === "projected" && p ? p.events.filter((e) => e.date === active.date) : [];
  // What the projection recorded on the hovered day thought month-end would be — the forecast
  // line's value at that x, so hovering explains the second line as well as the first.
  const forecastHere = showForecast ? (forecast.find((s) => s.takenOn === active.date) ?? null) : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1 text-sm min-h-6">
        <span className="font-medium tabular-nums">{formatDate(active.date)}</span>
        <span className={`text-lg font-semibold tabular-nums ${active.balance < 0 ? "text-red-600" : ""}`}>{formatMoney(active.balance)}</span>
        {change != null && (
          <span className={`text-xs tabular-nums ${change >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {change >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(change))} vs prior day
          </span>
        )}
        {active.kind === "actual" ? (
          <span className="text-xs text-neutral-500">{active.recorded ? "balance recorded" : "carried forward"}</span>
        ) : (
          <span className="text-xs text-neutral-500 min-w-0 truncate">
            projected
            {events.length > 0 && ` · ${events.map((e) => `${e.label} ${e.amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(e.amount))}`).join(" · ")}`}
            {active.spread > 0 && ` · everyday −${formatMoney(active.spread)}`}
            {lowProj && active.date === lowProj.date && " · projected low"}
          </span>
        )}
        {forecastHere && (
          <span className="text-xs tabular-nums" style={{ color: forecastColor }}>
            · forecast that day: {formatMoney(forecastHere.endBalance)} at month end
          </span>
        )}
        {hover == null && <span className="text-xs text-neutral-400">· hover or touch the chart</span>}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto touch-none cursor-crosshair"
        role="img"
        aria-label={`Cash on hand by day: recorded so far, projected into next month${showForecast ? ", with each day's forecast of month-end cash" : ""}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="cash-month-actual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cash-month-proj" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {boundaries.map((b) => (
          <line key={b} x1={x(b)} x2={x(b)} y1={padTop - 4} y2={height - padBottom + 4} stroke="#a3a3a3" strokeDasharray="2 3" strokeWidth="1" />
        ))}
        {min < 0 && <line x1={padX} x2={width - padX} y1={y(0)} y2={y(0)} stroke="#ef4444" strokeDasharray="4 3" strokeWidth="1" />}
        {actualDays.length > 1 && <polygon points={areaOf(actualDays)} fill="url(#cash-month-actual)" />}
        {projLine.length > 1 && <polygon points={areaOf(projLine)} fill="url(#cash-month-proj)" />}
        {actualDays.length > 1 && <polyline points={actualDays.map(pt).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {projLine.length > 1 && (
          <polyline points={projLine.map(pt).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5 4" strokeOpacity="0.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}
        {showForecast && (
          <>
            <polyline points={forecastPts} fill="none" stroke={forecastColor} strokeWidth="1.5" strokeOpacity="0.85" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {forecast.map((s) => (
              <circle key={s.takenOn} cx={x(s.takenOn)} cy={y(s.endBalance)} r="1.8" fill={forecastColor} fillOpacity="0.9" />
            ))}
          </>
        )}
        {actualDays.map((d) => (d.kind === "actual" && d.recorded ? <circle key={d.date} cx={x(d.date)} cy={y(d.balance)} r="2.5" fill={color} /> : null))}
        {projected.map((d) =>
          d.kind === "projected" && (d.paycheck || d.outflow) ? (
            <line key={d.date} x1={x(d.date)} x2={x(d.date)} y1={height - padBottom + 2} y2={height - padBottom + (d.paycheck ? 10 : 7)} stroke={d.paycheck ? "#16a34a" : "#ef4444"} strokeWidth={d.paycheck ? 3 : 2} />
          ) : null,
        )}
        {lowProj && <circle cx={x(lowProj.date)} cy={y(lowProj.balance)} r="4" fill="#fff" stroke={lowProj.balance < 0 ? "#ef4444" : color} strokeWidth="2" strokeDasharray="2 2" />}
        {joinIdx >= 0 && projected.length > 0 && <circle cx={x(days[joinIdx].date)} cy={y(days[joinIdx].balance)} r="3.5" fill={color} />}
        <line x1={x(active.date)} x2={x(active.date)} y1={padTop} y2={height - padBottom} stroke={color} strokeOpacity="0.45" strokeDasharray="3 3" strokeWidth="1" />
        <circle cx={x(active.date)} cy={y(active.balance)} r="5" fill="#fff" stroke={color} strokeWidth="2.5" />
        {ticks.map((k) => (
          <text key={k.iso} x={x(k.iso)} y={height - 4} fontSize="10" textAnchor={k.iso === monthStart ? "start" : k.iso === horizonEnd ? "end" : "middle"} fill="#737373">
            {k.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

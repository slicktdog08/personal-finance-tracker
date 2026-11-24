import { formatMoney } from "@/server/lib/money";

// Charts for Spending Pace. Plain SVG rendered on the server (no client JS), colors from the theme
// tokens so they follow light and dark mode. Target and break-even are drawn as today's values —
// the horizontal lines the pace is judged against.

export interface PacePoint {
  date: string;
  value: number;
}

const TARGET = "var(--mp-ok)";
const BREAK_EVEN = "var(--mp-danger)";
const INK = "var(--mp-accent)";

function Legend({ target, breakEven }: { target: number; breakEven: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: TARGET }} /> Target {formatMoney(target)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: BREAK_EVEN }} /> Break-even {formatMoney(breakEven)}
      </span>
    </div>
  );
}

/** The 14-day average over time against today's target and break-even lines. */
export function PaceSparkline({ points, target, breakEven, label }: { points: PacePoint[]; target: number; breakEven: number; label: string }) {
  const width = 280;
  const height = 64;
  const pad = 4;
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, breakEven, target, 1) * 1.08;
  const min = Math.min(0, ...vals, target);
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="space-y-1.5">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={label}>
        <line x1={pad} x2={width - pad} y1={y(target)} y2={y(target)} stroke={TARGET} strokeWidth={1.25} strokeDasharray="4 3" />
        <line x1={pad} x2={width - pad} y1={y(breakEven)} y2={y(breakEven)} stroke={BREAK_EVEN} strokeWidth={1.25} strokeDasharray="4 3" />
        <polyline points={line} fill="none" style={{ stroke: INK }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r={3} style={{ fill: INK }} />
      </svg>
      <Legend target={target} breakEven={breakEven} />
    </div>
  );
}

/** One bar per day (net discretionary) with the target and break-even lines across. */
export function PaceDailyBars({ points, target, breakEven, highlight = [] }: { points: PacePoint[]; target: number; breakEven: number; highlight?: string[] }) {
  const width = 640;
  const height = 180;
  const padB = 18;
  const padT = 6;
  if (!points.length) return <p className="text-sm text-fg-3">No days to show yet.</p>;
  const max = Math.max(...points.map((p) => p.value), breakEven, 1) * 1.08;
  const slot = width / points.length;
  const bw = Math.max(2, slot * 0.68);
  const y = (v: number) => padT + (1 - Math.max(0, v) / max) * (height - padT - padB);
  const hl = new Set(highlight);
  return (
    <div className="space-y-1.5">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Discretionary spend per day">
        {points.map((p, i) => {
          const top = y(p.value);
          const over = p.value > breakEven;
          return (
            <g key={p.date}>
              <title>{`${p.date}: ${formatMoney(p.value)}`}</title>
              <rect
                x={i * slot + (slot - bw) / 2}
                y={top}
                width={bw}
                height={Math.max(0, height - padB - top)}
                rx={2}
                style={{ fill: over ? BREAK_EVEN : INK, opacity: hl.has(p.date) || over ? 1 : 0.7 }}
              />
              {(i === 0 || i === points.length - 1 || i % 7 === 0) && (
                <text x={i * slot + slot / 2} y={height - 4} textAnchor="middle" fontSize={10} style={{ fill: "var(--mp-text-3)" }}>
                  {p.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke={TARGET} strokeWidth={1.25} strokeDasharray="5 4" />
        <line x1={0} x2={width} y1={y(breakEven)} y2={y(breakEven)} stroke={BREAK_EVEN} strokeWidth={1.25} strokeDasharray="5 4" />
      </svg>
      <Legend target={target} breakEven={breakEven} />
    </div>
  );
}

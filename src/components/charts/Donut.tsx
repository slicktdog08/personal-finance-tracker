"use client";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  data,
  size = 200,
  thickness = 28,
  centerLabel,
  centerSub,
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  let cumulative = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px] mx-auto">
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" className="text-neutral-200 dark:text-neutral-800" strokeWidth={thickness} />
        {total > 0 &&
          data.map((d, i) => {
            const pct = (d.value / total) * 100;
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                pathLength={100}
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={-cumulative}
              >
                <title>{`${d.label}: ${d.value} (${pct.toFixed(0)}%)`}</title>
              </circle>
            );
            cumulative += pct;
            return el;
          })}
      </g>
      {centerLabel && (
        <text x="50%" y="47%" textAnchor="middle" className="fill-current text-xl font-bold">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x="50%" y="60%" textAnchor="middle" className="fill-neutral-500 text-[10px]">
          {centerSub}
        </text>
      )}
    </svg>
  );
}

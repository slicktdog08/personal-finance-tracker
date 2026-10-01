import { formatMoney } from "@/server/lib/money";

export interface SparkPoint {
  label: string; // e.g. "Jan '25"
  value: number | null; // null = no recorded value that month
}

// Minimal history sparkline: a filled area + line across the recorded months, a solid dot on the
// latest point (the "present") and a ringed dot on the highlighted (selected) month. Leading
// months with no recorded value are skipped so the line begins where the data begins. Renders
// nothing with fewer than two data points — a lone point isn't a trend.
export function Sparkline({
  points,
  color,
  highlightIndex = -1,
}: {
  points: SparkPoint[];
  color: string;
  highlightIndex?: number;
}) {
  const width = 240;
  const height = 48;
  const pad = 5;
  const n = points.length;

  // Keep original index so x-position stays proportional to time even when leading months are null.
  const defined = points.flatMap((p, i) =>
    p.value == null ? [] : [{ label: p.label, value: p.value, i }],
  );
  if (defined.length < 2) return null;

  const values = defined.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const denom = Math.max(1, n - 1);

  const x = (i: number) => pad + (i / denom) * (width - pad * 2);
  // A flat series (every value equal) has no vertical range — draw it through the middle rather
  // than pinned to the baseline.
  const y = (v: number) =>
    span === 0 ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2);

  const line = defined.map((d) => `${x(d.i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const first = defined[0];
  const last = defined[defined.length - 1];
  const area = `${x(first.i).toFixed(1)},${height - pad} ${line} ${x(last.i).toFixed(1)},${height - pad}`;
  const hi = highlightIndex >= 0 ? defined.find((d) => d.i === highlightIndex) : undefined;
  const gid = `spark-grad-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      style={{ maxWidth: 320 }}
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {hi && hi.i !== last.i && (
        <circle cx={x(hi.i)} cy={y(hi.value)} r="3.5" fill="#fff" stroke={color} strokeWidth="2" />
      )}
      <circle cx={x(last.i)} cy={y(last.value)} r="3" fill={color} />
      {/* Invisible hover targets for a per-point value tooltip. */}
      {defined.map((d) => (
        <rect
          key={d.i}
          x={x(d.i) - (width - pad * 2) / (denom * 2)}
          y="0"
          width={(width - pad * 2) / denom}
          height={height}
          fill="transparent"
        >
          <title>{`${d.label}: ${formatMoney(d.value)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** A number with a whisper of a label — no box. Rows of these sit inside a card. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "good" | "bad" | "accent";
}) {
  const t = tone === "good" ? "text-income" : tone === "bad" ? "text-over" : tone === "accent" ? "text-accent-text" : "text-fg";
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-fg-3">{label}</div>
      <div className={`mt-1 text-lg md:text-xl font-semibold tabular-nums tracking-tight leading-none ${t}`}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-fg-3 leading-snug">{hint}</div>}
    </div>
  );
}

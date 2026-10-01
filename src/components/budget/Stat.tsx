/** A number with a whisper of a label — no box. Rows of these replace tiles. */
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
  const t = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "accent" ? "text-indigo-600 dark:text-indigo-400" : "";
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl md:text-2xl font-semibold tabular-nums tracking-tight leading-none ${t}`}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-neutral-500 leading-snug">{hint}</div>}
    </div>
  );
}

// Planned-vs-actual bar: fills toward the plan in the line's color, and anything past it
// shows as a red overrun segment so "over" is visible at a glance, not just as a number.
export function PlanBar({
  planned,
  actual,
  color,
  className = "",
}: {
  planned: number;
  actual: number;
  color?: string | null;
  className?: string;
}) {
  const base = Math.max(planned, actual, 0.01);
  const within = Math.min(actual, planned);
  const withinPct = (within / base) * 100;
  const overPct = actual > planned ? ((actual - planned) / base) * 100 : 0;
  // Unspent plan shows as the track itself, so the bar's full width == max(planned, actual).
  return (
    <div className={`h-2.5 w-full flex overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800 ${className}`}>
      <div
        className="h-full"
        style={{ width: `${Math.max(actual > 0 ? 1.5 : 0, withinPct)}%`, backgroundColor: color || "#3b82f6" }}
      />
      {overPct > 0 && <div className="h-full bg-red-500/85" style={{ width: `${overPct}%` }} />}
    </div>
  );
}

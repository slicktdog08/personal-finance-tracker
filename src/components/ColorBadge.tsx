import { badgeStyle } from "@/lib/colors";

export function ColorBadge({
  label,
  color,
  emoji,
  title,
}: {
  label: string;
  color?: string | null;
  emoji?: string | null;
  title?: string;
}) {
  if (!label) return <span className="text-neutral-400">—</span>;
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={badgeStyle(color)}
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      {label}
    </span>
  );
}

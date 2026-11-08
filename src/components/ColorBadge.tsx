import { Badge } from "@/components/ds";

// A user-colored label (category, bill status, payment type) rendered as a MiPlata Badge.
// `solid` (default) fills with the picked hex — bill statuses and payment types, so a table
// scans like a status board; `tint` derives a readable pastel — categories. A user-picked emoji
// is accepted for callers but not drawn: the design keeps emoji out of badges (Glyph only).
export function ColorBadge({
  label,
  color,
  title,
  variant = "solid",
}: {
  label: string;
  color?: string | null;
  emoji?: string | null;
  title?: string;
  variant?: "solid" | "tint";
}) {
  return <Badge label={label} color={color || "#9ca3af"} title={title} variant={variant} dot={variant === "tint"} />;
}

import { AttentionStrip as DsAttentionStrip } from "@/components/ds";

export interface AttentionItem {
  key: string;
  label: string;
  href: string;
  /** red = past due / broken; amber = housekeeping; pending = money in flight; neutral/info = FYI. */
  tone: "red" | "amber" | "neutral" | "pending" | "info";
  /** Shown after the label in secondary ink, through <Money>. */
  amount?: number;
}

const TONE = { red: "danger", amber: "warn", neutral: "info", info: "info", pending: "pending" } as const;

/**
 * Housekeeping that changes the numbers below it — each pill links to where it's fixed. Calm,
 * neutral pills where only the dot carries the tone (never a red banner). Renders nothing when the
 * books are clean, so it costs no space on a good day; scrolls sideways on a phone rather than
 * wrapping into a wall of chips.
 */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (!items.length) return null;
  return (
    <div aria-label="Needs attention">
      <DsAttentionStrip items={items.map((i) => ({ id: i.key, label: i.label, href: i.href, tone: TONE[i.tone], amount: i.amount }))} />
    </div>
  );
}

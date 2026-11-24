import Link from "next/link";
import { Card, Icon, buttonClass } from "@/components/ds";

/**
 * The way into a "categorize my history" chat: shown wherever the backlog is visible. The
 * advisor works through it a round at a time in /advisor — grouping by merchant, asking for
 * context, and applying only what the user confirms there.
 */
export function CategorizeWithAdvisor({ uncategorized }: { uncategorized: number }) {
  if (uncategorized <= 0) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Icon name="sparkles" size={18} className="shrink-0 text-accent-text" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
            {uncategorized.toLocaleString("en-US")} uncategorized — work through them with the advisor
          </p>
          <p className="text-sm text-fg-2">
            Claude groups them by merchant, asks what it needs to know (where you lived, trips, what a recurring payment is), and proposes batches. Nothing changes until you confirm in the chat; recurring merchants become rules, and bill payments can be linked.
          </p>
        </div>
        <Link href="/advisor?start=categorize" className={buttonClass({ variant: "primary" })}>
          <Icon name="message-circle" size={16} /> Start in chat
        </Link>
      </div>
    </Card>
  );
}

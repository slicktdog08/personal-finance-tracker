import Link from "next/link";
import { Icon, buttonClass, cx } from "@/components/ds";
import { MONTH_ABBR } from "@/server/lib/period";

// Small pieces every dashboard card shares. Server-safe: no hooks, no client-only imports.

/** The kit's ghost "Debts ›" card action, as a link (ds Button is a <button>, and these navigate). */
export function CardLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={buttonClass({ variant: "ghost", size: "sm", className: cx("shrink-0", className) })}>
      {children}
      <Icon name="chevron-right" size={15} />
    </Link>
  );
}

/**
 * A ds ListRow that navigates. ListRow's own onClick is a client callback, which a server-rendered
 * dashboard can't pass — so this is the same markup (mp-listrow + the button variant's hover) on a
 * <Link>.
 */
export function LinkRow({
  href,
  lead,
  title,
  sub,
  end,
  endSub,
  className,
  tooltip,
}: {
  href: string;
  lead?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  end?: React.ReactNode;
  endSub?: React.ReactNode;
  className?: string;
  /** Native tooltip. */
  tooltip?: string;
}) {
  return (
    <Link href={href} className={cx("mp-listrow mp-listrow--button", className)} title={tooltip}>
      {lead}
      <div className="mp-listrow__main">
        <div className="mp-listrow__title">{title}</div>
        {sub && <div className="mp-listrow__sub">{sub}</div>}
      </div>
      {(end || endSub) && (
        <div className="mp-listrow__end">
          {end}
          {endSub && <div className="mp-listrow__sub">{endSub}</div>}
        </div>
      )}
    </Link>
  );
}

/** "2026-11-05" → "Nov 5". The year only adds noise on a forward-looking dashboard. */
export function dayLabel(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "—";
  return `${MONTH_ABBR[Number(m[2]) - 1]} ${Number(m[3])}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-10-21" → "Wed, Oct 21" (parsed by parts — no timezone shift). */
export function weekdayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${WEEKDAYS[wd]}, ${dayLabel(iso)}`;
}

/**
 * Distinct account hues for the "where your cash is" bar, ordered so the biggest balances get the
 * most distinguishable ones. Accounts have no color of their own; these are fixed brand-neutral
 * hues that read on white and on true black alike.
 */
export const ACCOUNT_COLORS = ["#10b981", "#0ea5e9", "#c2410c", "#8b5cf6", "#db2777", "#0891b2", "#65a30d", "#ca8a04"];

"use client";

import Link from "next/link";
import { Badge, Glyph, Icon, Money, ProgressBar, buttonClass, cx, type IconName } from "@/components/ds";
import { PLAN_COLORS } from "@/components/budget/colors";

/**
 * The envelope: one card per budget line. At rest it leads with what's LEFT (numbers first),
 * "left of $plan" beside it, and a thin bar with a tick where you'd be on pace today. Tap the
 * card (or its padlock) and it opens — an accent ring, the amount control slides in at the
 * bottom — and it joins the balancing pool. Everything else on the card is quiet.
 *
 * `tone` decides what going past the plan means: spending past it is over (rose); paying a debt
 * past it, or keeping more than a savings line asked, is good news (green).
 */
export function Envelope({
  emoji,
  icon,
  title,
  subtitle,
  href,
  color,
  planned,
  used,
  usedLabel = "spent",
  remainingLabel,
  tone = "spend",
  marker,
  open,
  auto = false,
  pending = false,
  onToggle,
  onRemove,
  control,
  aside,
}: {
  emoji?: string | null;
  /** Shown in the glyph when there's no emoji. */
  icon?: IconName;
  title: string;
  subtitle?: React.ReactNode;
  href?: string | null;
  color?: string | null;
  planned: number;
  used: number | null;
  usedLabel?: string;
  /** Custom caption beside the big number; default derives from planned − used. */
  remainingLabel?: React.ReactNode;
  tone?: "spend" | "pay" | "save";
  /** Pace tick on the bar (same units as planned). */
  marker?: number | null;
  open: boolean;
  /** The auto-rebalance sink: not lockable, shown with a subtle badge instead of a padlock. */
  auto?: boolean;
  pending?: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  control?: React.ReactNode;
  /** Small extra line under the bar (badges, notes). */
  aside?: React.ReactNode;
}) {
  const accent = color || PLAN_COLORS.spend;
  const has = used != null;
  const diff = has ? planned - used : planned;
  const over = has && diff < -0.005;
  const overBad = over && tone === "spend";
  const settled = has && Math.abs(diff) <= 0.005 && planned > 0;
  const big = has ? Math.abs(diff) : planned;
  const bigKind = overBad ? "over" : over ? "income" : "neutral";
  const planMoney = <Money value={planned} kind="neutral" whole />;
  const caption =
    remainingLabel ??
    (!has ? null : tone === "spend" ? (
      <>
        {over ? "over" : "left"} of {planMoney}
      </>
    ) : tone === "pay" ? (
      settled ? (
        "paid in full"
      ) : over ? (
        <>extra beyond {planMoney}</>
      ) : (
        <>to go of {planMoney}</>
      )
    ) : over ? (
      <>above {planMoney}</>
    ) : (
      <>short of {planMoney}</>
    ));

  return (
    <div
      className={cx(
        "mp-card relative transition-[border-color,box-shadow] duration-200",
        open ? "border-accent ring-2 ring-accent/25" : "hover:border-line-2 hover:shadow-hover",
        pending && "opacity-70",
      )}
    >
      <button type="button" onClick={auto ? undefined : onToggle} disabled={auto} aria-expanded={auto ? undefined : open} className="block w-full text-left p-5 max-md:p-3.5 disabled:cursor-default rounded-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {emoji ? (
              <Glyph color={accent} size="sm">
                <span className="text-[13px] leading-none">{emoji}</span>
              </Glyph>
            ) : icon ? (
              <Glyph icon={icon} color={accent} size="sm" />
            ) : (
              <Glyph color={accent} size="sm">
                <span className="text-xs font-semibold">{title.slice(0, 1).toUpperCase()}</span>
              </Glyph>
            )}
            <div className="min-w-0">
              <div className="font-medium leading-snug truncate">{title}</div>
              {subtitle && <div className="text-xs text-fg-3 truncate mt-0.5">{subtitle}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 mt-0.5">
            {overBad ? (
              <Badge label="Over" color="var(--mp-money-over)" size="sm" />
            ) : (
              has && (
                <span className="text-xs text-fg-3 whitespace-nowrap">
                  <Money value={used} kind="neutral" /> {usedLabel}
                </span>
              )
            )}
            {auto ? (
              <Badge label="Auto" variant="outline" dot={false} size="sm" title="Auto-rebalance target — it absorbs every change" />
            ) : (
              <Icon name={open ? "lock-open" : "lock"} size={14} className={open ? "text-accent-text" : "text-fg-3"} />
            )}
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <Money value={overBad ? diff : big} kind={bigKind} sign={overBad ? "auto" : "none"} style={{ font: "var(--mp-type-money-md)" }} />
          {caption && <span className="text-xs text-fg-3 text-right min-w-0">{caption}</span>}
        </div>
        {has && planned > 0 && (
          <ProgressBar
            size="sm"
            className="mt-3"
            max={planned}
            value={Math.min(used, planned)}
            color={overBad ? PLAN_COLORS.over : accent}
            marker={marker != null && marker > 0 && marker < planned ? marker : undefined}
            label={`${title}: ${Math.round((used / planned) * 100)}% ${usedLabel}`}
          />
        )}
        {aside && <div className="mt-2 text-xs">{aside}</div>}
      </button>
      {open && (control || onRemove || href) && (
        <div className="px-5 pb-4 pt-3 max-md:px-3.5 border-t border-line motion-safe:animate-[rise_.2s_ease-out]">
          {control}
          {(onRemove || href) && (
            <div className="mt-3 flex items-center justify-between gap-2">
              {href ? (
                <Link href={href} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  See transactions
                  <Icon name="arrow-right" size={14} />
                </Link>
              ) : (
                <span />
              )}
              {onRemove && (
                <button type="button" onClick={onRemove} className={cx(buttonClass({ variant: "ghost", size: "sm" }), "text-fg-3 hover:text-over")}>
                  <Icon name="trash-2" size={14} />
                  Remove envelope
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

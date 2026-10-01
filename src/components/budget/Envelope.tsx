"use client";

import Link from "next/link";
import { LockIcon, UnlockIcon } from "@/components/icons";
import { formatMoney } from "@/server/lib/money";

/**
 * The envelope: one card per budget line. At rest it shows the name, the planned amount, and
 * how much of it is used. Tap the card (or its padlock) and it opens — a colored ring, the
 * amount control slides in at the bottom — and it joins the balancing pool. That's the whole
 * interaction: no separate lock pill, no move dialog. Everything else on the card is quiet.
 */
export function Envelope({
  emoji,
  title,
  subtitle,
  href,
  color,
  planned,
  used,
  usedLabel = "spent",
  remainingLabel,
  open,
  auto = false,
  pending = false,
  onToggle,
  onRemove,
  control,
  aside,
}: {
  emoji?: string | null;
  title: string;
  subtitle?: React.ReactNode;
  href?: string | null;
  color?: string | null;
  planned: number;
  used: number | null;
  usedLabel?: string;
  /** Custom "left"/"over" line; default derives from planned − used. */
  remainingLabel?: React.ReactNode;
  open: boolean;
  /** The auto-rebalance sink: not lockable, shown with a subtle badge instead of a padlock. */
  auto?: boolean;
  pending?: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  control?: React.ReactNode;
  /** Small extra line under the numbers (badges, notes). */
  aside?: React.ReactNode;
}) {
  const accent = color || "#6366f1";
  const over = used != null && used > planned;
  const pct = planned > 0 && used != null ? Math.min(100, (used / planned) * 100) : 0;
  const overPct = planned > 0 && used != null && over ? Math.min(100, ((used - planned) / Math.max(used, 1)) * 100) : 0;
  return (
    <div
      className={`group relative rounded-2xl border bg-white dark:bg-neutral-900 transition-all duration-200 ${
        open
          ? "border-indigo-400/70 shadow-[0_8px_30px_-12px_rgba(99,102,241,0.45)] ring-1 ring-indigo-400/40"
          : "border-neutral-200/80 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-sm"
      } ${pending ? "opacity-70" : ""}`}
    >
      {/* Accent thread along the top edge in the envelope's color. */}
      <div className="absolute inset-x-5 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <button type="button" onClick={auto ? undefined : onToggle} disabled={auto} className="w-full text-left p-4 pb-3 disabled:cursor-default">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg font-semibold" style={{ backgroundColor: `${accent}1a`, color: emoji ? undefined : accent }} aria-hidden>
              {emoji ?? title.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="font-medium leading-tight truncate">{title}</div>
              {subtitle && <div className="text-xs text-neutral-500 truncate mt-0.5">{subtitle}</div>}
            </div>
          </div>
          {auto ? (
            <span className="shrink-0 mt-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">auto</span>
          ) : (
            <span className={`shrink-0 mt-0.5 transition-colors ${open ? "text-indigo-500" : "text-neutral-300 dark:text-neutral-600 group-hover:text-neutral-400"}`} aria-hidden>
              {open ? <UnlockIcon /> : <LockIcon />}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-baseline justify-between gap-2">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{formatMoney(planned)}</div>
          {used != null && (
            <div className="text-sm tabular-nums text-neutral-500">
              <span className={over ? "text-red-600 dark:text-red-400 font-medium" : "text-neutral-700 dark:text-neutral-300"}>{formatMoney(used)}</span> {usedLabel}
            </div>
          )}
        </div>
        <div className="mt-2.5 h-1.5 w-full flex overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${over ? 100 - overPct : pct}%`, backgroundColor: accent }} />
          {over && <div className="h-full bg-red-500 transition-[width] duration-500" style={{ width: `${overPct}%` }} />}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className={over ? "text-red-600 dark:text-red-400 font-medium" : "text-neutral-500"}>
            {remainingLabel ?? (used == null ? "" : over ? `${formatMoney(used - planned)} over` : `${formatMoney(planned - used)} left`)}
          </span>
          {aside}
        </div>
      </button>
      {open && (control || onRemove || href) && (
        <div className="px-4 pb-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 motion-safe:animate-[rise_.2s_ease-out]">
          {control}
          {(onRemove || href) && (
            <div className="mt-3 flex items-center justify-between text-xs">
              {href ? (
                <Link href={href} className="text-neutral-500 hover:text-indigo-600 hover:underline">
                  See transactions →
                </Link>
              ) : (
                <span />
              )}
              {onRemove && (
                <button type="button" onClick={onRemove} className="text-neutral-400 hover:text-red-600">
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

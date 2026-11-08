"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ds/Icon";

// periods are passed oldest -> newest.
export function MonthNav({
  periods,
  current,
  basePath = "/dashboard",
  mode = "query",
}: {
  periods: { label: string; pretty: string }[];
  current: string;
  /** Page the picker navigates within; every month-scoped page can reuse it. */
  basePath?: string;
  /** query: `${basePath}?period=2026-10` (dashboard, budget). path: `${basePath}/2026-10` (/months). */
  mode?: "query" | "path";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const idx = periods.findIndex((p) => p.label === current);
  const older = idx > 0 ? periods[idx - 1] : null;
  const newer = idx >= 0 && idx < periods.length - 1 ? periods[idx + 1] : null;

  const hrefFor = (label: string) => (mode === "path" ? `${basePath}/${label}` : `${basePath}?period=${label}`);
  // The arrows aren't <Link>s, so nothing prefetches them; warm both neighbours so a tap
  // lands on an already-fetched month.
  const olderHref = older ? hrefFor(older.label) : null;
  const newerHref = newer ? hrefFor(newer.label) : null;
  useEffect(() => {
    if (olderHref) router.prefetch(olderHref);
    if (newerHref) router.prefetch(newerHref);
  }, [router, olderHref, newerHref]);

  // In a transition so the label can show it's working (motion.css pulses it) while the month loads.
  const go = (label: string) => start(() => router.push(hrefFor(label)));

  const btn = "mp-btn mp-iconbtn mp-btn--ghost h-9 w-9 shrink-0";

  return (
    <div className="mp-monthnav" data-pending={pending || undefined}>
      <button type="button" className={btn} disabled={!older} onClick={() => older && go(older.label)} title="Previous month" aria-label="Previous month">
        <Icon name="chevron-left" size={18} />
      </button>
      <select
        value={current}
        onChange={(e) => go(e.target.value)}
        aria-label="Month"
        className="mp-monthnav__label min-w-0 cursor-pointer appearance-none rounded-md bg-transparent py-1.5 text-center hover:bg-hover"
      >
        {[...periods].reverse().map((p) => (
          <option key={p.label} value={p.label}>
            {p.pretty}
          </option>
        ))}
      </select>
      <button type="button" className={btn} disabled={!newer} onClick={() => newer && go(newer.label)} title="Next month" aria-label="Next month">
        <Icon name="chevron-right" size={18} />
      </button>
    </div>
  );
}

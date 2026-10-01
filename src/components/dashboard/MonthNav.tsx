"use client";

import { useRouter } from "next/navigation";

// periods are passed oldest -> newest.
export function MonthNav({
  periods,
  current,
  basePath = "/dashboard",
}: {
  periods: { label: string; pretty: string }[];
  current: string;
  /** Page the picker navigates within; every month-scoped page can reuse it. */
  basePath?: string;
}) {
  const router = useRouter();
  const idx = periods.findIndex((p) => p.label === current);
  const older = idx > 0 ? periods[idx - 1] : null;
  const newer = idx >= 0 && idx < periods.length - 1 ? periods[idx + 1] : null;

  const go = (label: string) => router.push(`${basePath}?period=${label}`);

  const btn =
    "min-h-10 px-3 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm font-medium disabled:opacity-40 hover:bg-neutral-100 dark:hover:bg-neutral-800";

  return (
    <div className="flex items-center gap-2">
      <button className={btn} disabled={!older} onClick={() => older && go(older.label)} title="Previous month">
        ◀
      </button>
      <select
        value={current}
        onChange={(e) => go(e.target.value)}
        className="border rounded-md px-2 py-1.5 text-sm font-medium bg-transparent border-neutral-300 dark:border-neutral-700"
      >
        {[...periods].reverse().map((p) => (
          <option key={p.label} value={p.label}>
            {p.pretty}
          </option>
        ))}
      </select>
      <button className={btn} disabled={!newer} onClick={() => newer && go(newer.label)} title="Next month">
        ▶
      </button>
    </div>
  );
}

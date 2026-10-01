// Helpers for period (month) identity and labels.

export function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parsePeriodLabel(label: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(label.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

// "04 01 24 - 04 30 24" / "09 01 25 - 09 31 25 (1)" → { year: 2024/2025, month }
export function parseFolderPeriod(folderName: string): { year: number; month: number } | null {
  const m = /^(\d{2})\s+\d{2}\s+(\d{2})/.exec(folderName.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const yy = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: 2000 + yy, month };
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// Map an ISO date (YYYY-MM-DD) to { year, month }.
export function dateToYearMonth(iso: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** The label of the month `today` falls in — the month the app treats as "current". */
export function currentPeriodLabel(today: string): string | null {
  const ym = dateToYearMonth(today);
  return ym ? periodLabel(ym.year, ym.month) : null;
}

/**
 * The month a month-scoped page should land on when the URL doesn't ask for one: the month we're
 * actually living in, falling back to the newest month on record for when the current month has
 * no period row yet. `periods` must be newest-first, as getPeriods returns it.
 *
 * Pages apply their own "explicitly requested" rule before calling this, because they don't all
 * agree on what counts as a request — /cash treats an empty `?period=` as a deliberate
 * "all months", while /dashboard and /budget only honour a label that exists.
 */
export function defaultPeriod<T extends { label: string }>(periods: T[], today: string): T {
  const current = currentPeriodLabel(today);
  return periods.find((p) => p.label === current) ?? periods[0];
}

// Parse common bank date formats → ISO YYYY-MM-DD. Returns null if unparseable.
export function parseDateToIso(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // MM/DD/YYYY or M/D/YY
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    let [, mm, dd, yy] = m;
    let year = Number(yy);
    if (yy.length === 2) year += 2000;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // YYYY-MM-DD
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [, y, mm, dd] = m;
    return `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // Fallback to Date parsing
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate(),
    ).padStart(2, "0")}`;
  }
  return null;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function prettyPeriod(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "2026-06-24" -> "Jun 24, 2026" (parsed by parts; no timezone shift)
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  const [, y, mo, d] = m;
  const idx = Number(mo) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${MONTH_ABBR[idx]} ${Number(d)}, ${y}`;
}

// "2025-01" -> "Jan '25"
export function shortMonthLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!m) return label;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return label;
  return `${MONTH_ABBR[month - 1]} '${String(year).slice(2)}`;
}

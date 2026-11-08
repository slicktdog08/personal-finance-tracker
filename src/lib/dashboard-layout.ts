// The dashboard's widget arrangement: an ordered list laid onto a 12-column grid, each widget a
// width in columns and an optional fixed height. Shared by the page (server), the save action,
// and the grid (client) — so it stays free of server and DOM imports.
//
// Order + width (rather than free x/y placement) is deliberate: it renders correctly on the server
// with plain CSS grid flow — no measuring pass, no layout flash — and a widget that's absent this
// month (Safe to spend, Payday, …) just drops out of the flow instead of leaving a hole at fixed
// coordinates.

export const GRID_COLS = 12;
export const MIN_W = 2;
// Below lg the dashboard is its own two-column grid with its own saved arrangement: a 12-column
// width means nothing on a phone, and the order worth having there isn't the desktop's either.
export const MOBILE_COLS = 2;
export const MOBILE_MIN_W = 1;
// Low enough for a one-line widget (the attention pills) to be sized to its content; the grid also
// snaps back to fit-content when a drag reaches the content's natural height.
export const MIN_H = 32;
export const MAX_H = 2400;
/** Heights snap to this many px while resizing. */
export const H_STEP = 8;

export const WIDGET_IDS = [
  "attention",
  "safe-to-spend",
  "cash",
  "credit",
  "loans",
  "payday",
  "card-rebalance",
  "next-7-days",
  "cash-accounts",
  "activity",
  "this-month",
  "budget",
  "cash-month",
  "category-spend",
  "debt-payoff",
  "net-worth",
  "goals",
  "category-trends",
  "top-spending",
  "income-vs-outgoing",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export interface LayoutItem {
  id: WidgetId;
  /** Columns spanned: 1–12 in the desktop layout (lg+), 1–2 in the mobile one. */
  w: number;
  /** Fixed height in px; null = as tall as the content. */
  h: number | null;
}

/** Which arrangement: desktop (lg+, 12 columns) or mobile (phones and tablets, 2 columns). */
export type LayoutKind = "desktop" | "mobile";
export interface DashboardLayouts {
  desktop: LayoutItem[];
  mobile: LayoutItem[];
  /** False while the phone layout has never been saved — it then mirrors the desktop order. */
  mobileSaved: boolean;
}
export const LAYOUT_KEYS: Record<LayoutKind, string> = { desktop: "dashboard", mobile: "dashboard-mobile" };
export const colsOf = (kind: LayoutKind) => (kind === "desktop" ? GRID_COLS : MOBILE_COLS);
export const minWOf = (kind: LayoutKind) => (kind === "desktop" ? MIN_W : MOBILE_MIN_W);

/**
 * The arrangement a new dashboard starts with — and what "Reset" goes back to. It follows the
 * MiPlata hierarchy: Safe to spend + payday, then the forward look (next 7 days beside the cash
 * line), then "is it going down?" (debt, budget, net worth), where the cash sits and what it's
 * saved toward — and only then the detail panels the old dashboard led with. Saved layouts keep
 * their own order; normalizeLayout only slots in widgets they've never seen.
 */
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: "attention", w: 12, h: null },
  { id: "safe-to-spend", w: 8, h: null },
  { id: "payday", w: 4, h: null },
  { id: "card-rebalance", w: 12, h: null },
  { id: "next-7-days", w: 6, h: null },
  { id: "cash-month", w: 6, h: null },
  { id: "debt-payoff", w: 4, h: null },
  { id: "budget", w: 4, h: null },
  { id: "net-worth", w: 4, h: null },
  { id: "cash-accounts", w: 6, h: null },
  { id: "goals", w: 6, h: null },
  { id: "cash", w: 4, h: null },
  { id: "credit", w: 4, h: null },
  { id: "loans", w: 4, h: null },
  { id: "activity", w: 8, h: null },
  { id: "this-month", w: 4, h: null },
  { id: "category-spend", w: 12, h: null },
  { id: "category-trends", w: 8, h: null },
  { id: "top-spending", w: 4, h: null },
  { id: "income-vs-outgoing", w: 12, h: null },
];

/** Widgets that pair up two-across on a phone by default; everything else takes the full row. */
const MOBILE_HALF: ReadonlySet<WidgetId> = new Set<WidgetId>(["cash", "credit", "loans"]);

/**
 * The phone arrangement before it's ever been customized there: the desktop order (so the two
 * stay in step until the user rearranges on a phone), each widget at its default phone width.
 */
export function mobileDefaultFrom(desktop: LayoutItem[]): LayoutItem[] {
  return desktop.map((d) => ({ id: d.id, w: MOBILE_HALF.has(d.id) ? 1 : MOBILE_COLS, h: null }));
}

const isWidgetId = (v: unknown): v is WidgetId => typeof v === "string" && (WIDGET_IDS as readonly string[]).includes(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Turn whatever is stored (or posted) into a complete, valid layout: unknown ids and duplicates
 * dropped, sizes clamped, and any widget the stored copy doesn't know about — one added to the
 * dashboard after the layout was saved — slotted back in right after the widget it follows by
 * default, so new panels appear where they were designed to rather than at the very bottom.
 */
export function normalizeLayout(raw: unknown): LayoutItem[] {
  return normalizeAgainst(raw, DEFAULT_LAYOUT, MIN_W, GRID_COLS);
}

/**
 * The phone arrangement, normalized the same way. Nothing stored → it follows `desktop`'s order;
 * a widget the stored copy lacks slots in after its predecessor in that order.
 */
export function normalizeMobileLayout(raw: unknown, desktop: LayoutItem[]): LayoutItem[] {
  return normalizeAgainst(raw, mobileDefaultFrom(desktop), MOBILE_MIN_W, MOBILE_COLS);
}

function normalizeAgainst(raw: unknown, defaults: LayoutItem[], minW: number, cols: number): LayoutItem[] {
  const items = Array.isArray(raw) ? raw : [];
  const defaultOf = (id: WidgetId) => defaults.find((d) => d.id === id) ?? { id, w: cols, h: null };
  const out: LayoutItem[] = [];
  const seen = new Set<WidgetId>();
  for (const r of items) {
    if (!r || typeof r !== "object") continue;
    const { id, w, h } = r as Record<string, unknown>;
    if (!isWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      w: typeof w === "number" && Number.isFinite(w) ? clamp(Math.round(w), minW, cols) : defaultOf(id).w,
      h: typeof h === "number" && Number.isFinite(h) ? clamp(Math.round(h), MIN_H, MAX_H) : null,
    });
  }
  defaults.forEach((d, i) => {
    if (seen.has(d.id)) return;
    // Walk back to the nearest default predecessor that's present and insert after it.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((o) => o.id === defaults[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, { ...d });
    seen.add(d.id);
  });
  return out;
}

/**
 * Widths for the widgets actually on screen, in a grid of `cols` columns. Rows are packed from the FULL layout the way
 * CSS grid flows them (left to right, wrapping when the next widget doesn't fit); then, in each
 * row, the width of any widget that isn't rendered this time is shared out among the ones that
 * are. So the tile strip reads as one full row whether or not Safe to spend and Payday apply, and
 * a user's widths are kept exactly whenever everything is present.
 */
export function effectiveWidths(layout: LayoutItem[], present: ReadonlySet<WidgetId>, cols = GRID_COLS): Map<WidgetId, number> {
  const rows: LayoutItem[][] = [];
  let row: LayoutItem[] = [];
  let used = 0;
  for (const it of layout) {
    if (used + it.w > cols && row.length) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(it);
    used += it.w;
  }
  if (row.length) rows.push(row);

  const out = new Map<WidgetId, number>();
  for (const r of rows) {
    const shown = r.filter((it) => present.has(it.id));
    if (!shown.length) continue;
    const total = r.reduce((s, it) => s + it.w, 0);
    const shownTotal = shown.reduce((s, it) => s + it.w, 0);
    if (shownTotal === total) {
      for (const it of shown) out.set(it.id, it.w);
      continue;
    }
    // Scale up to the row's original span; largest remainder keeps the integers summing exactly.
    const exact = shown.map((it) => (it.w / shownTotal) * total);
    const ws = exact.map(Math.floor);
    let left = total - ws.reduce((s, n) => s + n, 0);
    const byRemainder = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of byRemainder) {
      if (left <= 0) break;
      ws[i]++;
      left--;
    }
    shown.forEach((it, i) => out.set(it.id, ws[i]));
  }
  return out;
}

/** Move `id` to sit just before / after `target`. Returns the same array when nothing changes. */
export function moveItem(layout: LayoutItem[], id: WidgetId, target: WidgetId, after: boolean): LayoutItem[] {
  if (id === target) return layout;
  const from = layout.findIndex((l) => l.id === id);
  if (from < 0) return layout;
  const rest = layout.filter((l) => l.id !== id);
  const t = rest.findIndex((l) => l.id === target);
  if (t < 0) return layout;
  const next = [...rest.slice(0, t + (after ? 1 : 0)), layout[from], ...rest.slice(t + (after ? 1 : 0))];
  return next.every((l, i) => l === layout[i]) ? layout : next;
}

export const sameLayout = (a: LayoutItem[], b: LayoutItem[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.w === b[i].w && x.h === b[i].h);

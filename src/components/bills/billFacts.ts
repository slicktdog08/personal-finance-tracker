import { MONTH_ABBR } from "@/server/lib/period";
import { toNum } from "@/server/lib/money";
import type { InstancePatch } from "@/server/lib/bill-types";

export interface SheetRow {
  id: number;
  billId: number | null;
  name: string;
  amount: string | null;
  status: string;
  dueDay: number | null;
  paymentType: string | null;
  isDebt: boolean;
  isCancel: boolean;
}
export interface StatusItem {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  isSettled: boolean;
}
export interface ColorItem {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
}

export type Group = "Overdue" | "This week" | "Later this month" | "Later" | "No due date" | "Settled";
export const GROUP_RANK: Record<Group, number> = {
  Overdue: 0,
  "This week": 1,
  "Later this month": 2,
  Later: 2,
  "No due date": 3,
  Settled: 4,
};
export const PAST_DUE_STATUS = "Past Due";

const pad = (n: number) => String(n).padStart(2, "0");
export const amt = (r: SheetRow) => toNum(r.amount) ?? 0;

/**
 * Everything the month's bill views derive from the statuses and the calendar — what counts as
 * settled, past due, which due-date group a bill falls in. Built once per (statuses, month, today)
 * so the table's cell renderers and the edit sheet share one stable object instead of each
 * closing over the parent component's render.
 */
export function makeBillFacts({ statuses, year, month, today }: { statuses: StatusItem[]; year: number; /** 1-based. */ month: number; /** YYYY-MM-DD */ today: string }) {
  const statusInfo = new Map(statuses.map((s, i) => [s.name, { ...s, order: i }]));
  const mon = MONTH_ABBR[month - 1] ?? "";
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekOut = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();
  const isCurrentMonth = today.slice(0, 7) === `${year}-${pad(month)}`;

  const isSettled = (r: SheetRow) => statusInfo.get(r.status)?.isSettled ?? false;
  const dueIso = (r: SheetRow) => (r.dueDay == null ? null : `${year}-${pad(month)}-${pad(Math.min(r.dueDay, lastDay))}`);
  // Mirrors the nav badge (getNavCounts): explicitly Past Due, or unsettled with the due day behind us
  // and not already in flight (Pending / Autopay Pending).
  const isPastDue = (r: SheetRow) => {
    if (r.status === PAST_DUE_STATUS) return true;
    if (isSettled(r) || /pending/i.test(r.status)) return false;
    const d = dueIso(r);
    return d != null && d < today;
  };
  const groupOf = (r: SheetRow): Group => {
    if (isSettled(r)) return "Settled";
    if (isPastDue(r)) return "Overdue";
    const d = dueIso(r);
    if (d == null) return "No due date";
    if (d < weekOut) return "This week";
    return isCurrentMonth ? "Later this month" : "Later";
  };
  // The status the quick "Paid" action writes: the seeded Paid/Purchased if it exists, otherwise the
  // first settled status that reads as paid, otherwise any settled one.
  const paidStatus =
    statuses.find((s) => s.name === "Paid/Purchased")?.name ??
    statuses.find((s) => s.isSettled && /paid/i.test(s.name))?.name ??
    statuses.find((s) => s.isSettled)?.name ??
    null;

  return { statusInfo, mon, lastDay, isSettled, isPastDue, groupOf, paidStatus };
}
export type BillFacts = ReturnType<typeof makeBillFacts>;

/** An edit shown before the server confirms it (useOptimistic reducer input). */
export type RowEdit = { ids: number[]; patch: Partial<SheetRow> } | { remove: number };

/** Applies an edit, keeping every untouched row the same object so only edited rows re-render. */
export function applyRowEdit(rows: SheetRow[], edit: RowEdit): SheetRow[] {
  if ("remove" in edit) return rows.filter((r) => r.id !== edit.remove);
  const ids = new Set(edit.ids);
  return rows.map((r) => (ids.has(r.id) ? { ...r, ...edit.patch } : r));
}

/** What a saved InstancePatch will look like on the row once the server has applied it. */
export function rowPatch(patch: InstancePatch): Partial<SheetRow> {
  const out: Partial<SheetRow> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.amount !== undefined) out.amount = patch.amount == null ? null : String(patch.amount);
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.dueDay !== undefined) out.dueDay = patch.dueDay;
  if (patch.paymentType !== undefined) out.paymentType = patch.paymentType || null;
  if (patch.isDebt !== undefined) out.isDebt = patch.isDebt;
  if (patch.isCancel !== undefined) out.isCancel = patch.isCancel;
  return out;
}

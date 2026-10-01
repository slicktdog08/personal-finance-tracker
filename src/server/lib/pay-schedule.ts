// Pure payday date math. Everything in/out is an ISO `YYYY-MM-DD` string parsed by parts —
// never `new Date(iso)` (that reads as UTC midnight and shifts a day in western timezones).
// See src/server/lib/period.ts for the same discipline.
//
// Deliberate rule: paydays are NOT shifted off weekends/holidays. The user confirmed they want
// the countdown to target the nominal date (the 7th is the 7th, even on a Sunday). If that ever
// changes, adjust only `clampToMonth` callers here — nothing downstream knows about the rule.

import type { PayFrequency } from "@/constants/enums";

export interface PayScheduleInput {
  frequency: PayFrequency;
  /** Semi-monthly / monthly: day-of-month. `dayTwo` unused when monthly. */
  dayOne: number | null;
  dayTwo: number | null;
  /** Weekly / biweekly: any known past or future payday; the cadence is counted off this. */
  anchorDate: string | null;
}

export interface PayCountdown {
  /** ISO date of the next payday (today counts as "next" when today IS payday). */
  next: string;
  /** ISO date of the payday before `next` — the start of the current pay period. */
  previous: string;
  /** Calendar days from today until `next`. 0 means payday is today. */
  daysUntil: number;
  /** How far through the current pay period we are, 0–100. Payday itself is 100. */
  progressPct: number;
  /** Days in the current pay period — 7, 14, or ~15/30 for date-driven schedules. */
  periodLength: number;
}

const DAY_MS = 86_400_000;

/** Today as an ISO date in the server's local timezone. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** ISO → epoch ms at UTC midnight. Parsed by parts so there is no timezone shift. */
export function isoToUtc(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function utcToIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Whole calendar days from `a` to `b` (negative when b is before a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((isoToUtc(b) - isoToUtc(a)) / DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day 31 in a 30-day month lands on the 30th; day 31 in February lands on the 28th/29th. */
export function clampToMonth(year: number, month: number, day: number): string {
  const d = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/** The paydays that fall in one month, ascending, for a day-of-month driven schedule. */
function monthPaydays(year: number, month: number, days: number[]): string[] {
  return [...new Set(days.map((d) => clampToMonth(year, month, d)))].sort();
}

/**
 * Resolve the schedule into the payday on/after `today` and the one before it.
 * Returns null when the schedule isn't configured well enough to project (no anchor, no days).
 */
export function resolvePaydays(
  schedule: PayScheduleInput,
  today: string,
): { next: string; previous: string } | null {
  if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
    const anchor = schedule.anchorDate;
    if (!anchor || Number.isNaN(isoToUtc(anchor))) return null;
    const step = schedule.frequency === "weekly" ? 7 : 14;
    const offset = daysBetween(anchor, today);
    // Count whole cadences from the anchor to today, rounding UP so today-is-payday stays "next".
    // Works for anchors in the future too (offset negative → ceil pulls back correctly).
    const cycles = Math.ceil(offset / step);
    const next = utcToIso(isoToUtc(anchor) + cycles * step * DAY_MS);
    const previous = utcToIso(isoToUtc(next) - step * DAY_MS);
    return { next, previous };
  }

  // Date-driven: semi-monthly uses both days, monthly just the first.
  const days = (
    schedule.frequency === "monthly"
      ? [schedule.dayOne]
      : [schedule.dayOne, schedule.dayTwo]
  ).filter((d): d is number => d != null && d >= 1 && d <= 31);
  if (!days.length) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);

  // Walk the previous, current and next month so the first payday on/after today is always
  // found even when today sits past the last payday of its own month.
  const window: string[] = [];
  for (const delta of [-1, 0, 1]) {
    const ym = addMonths(year, month, delta);
    window.push(...monthPaydays(ym.year, ym.month, days));
  }
  window.sort();

  const idx = window.findIndex((d) => d >= today);
  if (idx <= 0) return null; // idx 0 would leave no previous payday in the window
  return { next: window[idx], previous: window[idx - 1] };
}

/** Full countdown for the dashboard widget. Null when the schedule can't be projected. */
export function payCountdown(
  schedule: PayScheduleInput,
  today: string = todayIso(),
): PayCountdown | null {
  const resolved = resolvePaydays(schedule, today);
  if (!resolved) return null;

  const daysUntil = daysBetween(today, resolved.next);
  const periodLength = daysBetween(resolved.previous, resolved.next);
  const elapsed = daysBetween(resolved.previous, today);
  const progressPct =
    periodLength > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / periodLength) * 100))) : 0;

  return { ...resolved, daysUntil, progressPct, periodLength };
}

/** "4 days" / "Tomorrow" / "Today" — the headline string for the countdown. */
export function countdownLabel(daysUntil: number): string {
  if (daysUntil <= 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `${daysUntil} days`;
}

/** Rough number of paychecks a year — used to project monthly/annual take-home. */
export function paychecksPerYear(frequency: PayFrequency): number {
  switch (frequency) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    case "monthly":
      return 12;
  }
}

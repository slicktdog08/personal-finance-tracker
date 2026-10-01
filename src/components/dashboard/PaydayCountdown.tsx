import Link from "next/link";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import {
  payCountdown,
  paychecksPerYear,
  type PayScheduleInput,
} from "@/server/lib/pay-schedule";
import { PAY_FREQUENCY_META } from "@/constants/enums";

export interface PaydayCountdownProps {
  schedule: (PayScheduleInput & { takeHome: number | null }) | null;
  /** Today from the page, so the countdown can't drift between server components. */
  today: string;
}

// Tone shifts as payday approaches — the closer it gets, the warmer the card. Payday itself goes
// emerald and celebratory; the long middle of a pay period stays calm indigo so the card reads as
// "hold the line" rather than "spend it".
function toneFor(daysUntil: number) {
  if (daysUntil <= 0) {
    return {
      wrap: "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40",
      accent: "text-emerald-700 dark:text-emerald-400",
      bar: "bg-emerald-500",
      label: "Payday",
    };
  }
  if (daysUntil <= 2) {
    return {
      wrap: "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40",
      accent: "text-amber-700 dark:text-amber-400",
      bar: "bg-amber-500",
      label: "Almost there",
    };
  }
  return {
    wrap: "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30",
    accent: "text-indigo-700 dark:text-indigo-300",
    bar: "bg-indigo-500",
    label: "Next payday",
  };
}

/**
 * Payday countdown. Always speaks about right now, never about the month being viewed — so the
 * dashboard renders it only while the current month is selected, and hides it otherwise rather
 * than showing a "next paycheck" that has nothing to do with the month on screen.
 */
export function PaydayCountdown({ schedule, today }: PaydayCountdownProps) {
  const countdown = schedule ? payCountdown(schedule, today) : null;

  // Unconfigured (or unprojectable) → a quiet prompt, not a loud empty card.
  if (!schedule || !countdown) {
    return (
      <Link
        href="/settings/pay-schedule"
        className="block rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4 hover:border-blue-400 transition-colors"
      >
        <div className="text-sm font-medium">⚡ Set up your pay schedule</div>
        <div className="text-xs text-neutral-500 mt-0.5">
          Add your payday and take-home to see a countdown to the next paycheck here.
        </div>
      </Link>
    );
  }

  const tone = toneFor(countdown.daysUntil);
  const meta = PAY_FREQUENCY_META[schedule.frequency];
  const net = schedule.takeHome;
  const monthly = net != null ? (net * paychecksPerYear(schedule.frequency)) / 12 : null;

  return (
    <section className={`rounded-xl border p-5 ${tone.wrap}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">⚡ {tone.label}</div>
        <Link
          href="/settings/pay-schedule"
          className="text-xs text-neutral-500 hover:text-blue-600"
          title={meta.blurb}
        >
          {meta.label} · edit
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        {/* The number carries the weight; the word after it is just the unit. */}
        <div className="flex items-baseline gap-3">
          <span className={`text-5xl font-bold tabular-nums leading-none ${tone.accent}`}>
            {countdown.daysUntil <= 0 ? "🎉" : countdown.daysUntil}
          </span>
          <span className={`text-2xl font-semibold ${tone.accent}`}>
            {countdown.daysUntil <= 0
              ? "It's payday"
              : countdown.daysUntil === 1
                ? "day to go"
                : "days to go"}
          </span>
        </div>

        {net != null && (
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              +{formatMoney(net)}
            </div>
            <div className="text-xs text-neutral-500">incoming</div>
          </div>
        )}
      </div>

      {/* The countdown made visual — how far through this pay period you are. */}
      <div className="mt-4 h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full ${tone.bar}`} style={{ width: `${countdown.progressPct}%` }} />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>
          {formatDate(countdown.next)}
          {countdown.daysUntil > 0 && (
            <> · day {countdown.periodLength - countdown.daysUntil} of {countdown.periodLength}</>
          )}
        </span>
        {monthly != null && <span className="tabular-nums">≈ {formatMoney(monthly)}/month</span>}
      </div>
    </section>
  );
}

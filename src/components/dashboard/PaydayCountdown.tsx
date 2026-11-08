import Link from "next/link";
import { Card, Icon, Money, ProgressBar, StatTile } from "@/components/ds";
import { payCountdown, paychecksPerYear, type PayScheduleInput } from "@/server/lib/pay-schedule";
import { PAY_FREQUENCY_META } from "@/constants/enums";
import { weekdayLabel } from "./kit";

export interface PaydayCountdownProps {
  schedule: (PayScheduleInput & { takeHome: number | null }) | null;
  /** Today from the page, so the countdown can't drift between server components. */
  today: string;
}

/**
 * Payday countdown. Always speaks about right now, never about the month being viewed — so the
 * dashboard renders it only while the current month is selected, and hides it otherwise rather
 * than showing a "next paycheck" that has nothing to do with the month on screen.
 *
 * MiPlata cards are never tinted by status, so the old warm-as-it-approaches card is gone; the
 * progress bar filling up says the same thing quietly.
 */
export function PaydayCountdown({ schedule, today }: PaydayCountdownProps) {
  const countdown = schedule ? payCountdown(schedule, today) : null;

  // Unconfigured (or unprojectable) → a quiet prompt, not a loud empty card.
  if (!schedule || !countdown) {
    return (
      <Card>
        <StatTile label="Next payday" icon="calendar-heart" value={<span className="text-fg-3">—</span>} sub="Add your payday and take-home to count down to the next paycheck." />
        <Link href="/settings/pay-schedule" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
          Set up pay schedule <Icon name="chevron-right" size={14} />
        </Link>
      </Card>
    );
  }

  const meta = PAY_FREQUENCY_META[schedule.frequency];
  const net = schedule.takeHome;
  const monthly = net != null ? (net * paychecksPerYear(schedule.frequency)) / 12 : null;
  const isToday = countdown.daysUntil <= 0;
  const day = countdown.periodLength - countdown.daysUntil;

  return (
    <Card>
      <StatTile
        label="Next payday"
        icon="calendar-heart"
        value={
          isToday ? (
            <span>It&apos;s payday</span>
          ) : (
            <span>
              {countdown.daysUntil} <span className="font-sans text-base font-medium text-fg-2">{countdown.daysUntil === 1 ? "day" : "days"}</span>
            </span>
          )
        }
        sub={
          <>
            {weekdayLabel(countdown.next)}
            {net != null && (
              <>
                {" · "}
                <Money value={net} kind="income" sign="always" />
              </>
            )}
          </>
        }
      />
      <ProgressBar
        value={isToday ? countdown.periodLength : day}
        max={countdown.periodLength}
        size="sm"
        className="mt-3.5"
        label="How far through this pay period"
        legendLeft={isToday ? "Pay period complete" : `Day ${day} of ${countdown.periodLength}`}
        legendRight={
          <Link href="/settings/pay-schedule" className="hover:text-accent-text" title={meta.blurb}>
            {meta.label}
          </Link>
        }
      />
      {monthly != null && (
        <div className="mt-2 text-xs text-fg-3">
          About <Money value={monthly} kind="neutral" whole /> a month take-home
        </div>
      )}
    </Card>
  );
}

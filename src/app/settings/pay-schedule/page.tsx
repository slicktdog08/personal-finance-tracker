import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { SetupNotice } from "@/components/SetupNotice";
import { PayScheduleForm } from "@/components/settings/PayScheduleForm";
import { getPaySchedule } from "@/server/queries";
import { todayIso } from "@/server/lib/pay-schedule";

export const dynamic = "force-dynamic";

export default async function PaySchedulePage() {
  let schedule;
  try {
    schedule = await getPaySchedule();
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="space-y-5">
      {/* Not SettingsHeader — that one ends with a drag-to-reorder tip that doesn't apply here. */}
      <div className="space-y-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-blue-600"
        >
          <ArrowLeftIcon /> Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Pay Schedule ⚡</h1>
        <p className="text-sm text-neutral-500">
          Tell the app when your paycheck lands and roughly how much of it survives taxes. The
          dashboard turns that into a countdown so you always know how long the money has to last.
        </p>
      </div>

      <PayScheduleForm
        initial={
          schedule && {
            frequency: schedule.frequency,
            dayOne: schedule.dayOne,
            dayTwo: schedule.dayTwo,
            anchorDate: schedule.anchorDate,
            takeHome: schedule.takeHome,
            depositWindowDays: schedule.depositWindowDays,
            depositMatch: schedule.depositMatch,
          }
        }
        today={todayIso()}
      />
    </div>
  );
}

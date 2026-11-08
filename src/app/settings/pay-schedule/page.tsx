import { SettingsHeader } from "@/components/settings/SettingsHeader";
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
    return <SetupNotice error={e} />;
  }

  return (
    <div className="space-y-5">
      {/* No reorder hint: nothing on this page drags. */}
      <SettingsHeader
        reorder={false}
        title="Pay schedule"
        description="Tell the app when your paycheck lands and roughly how much of it survives taxes. The dashboard turns that into a countdown so you always know how long the money has to last."
      />

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

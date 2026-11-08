import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { EmptyState, buttonClass } from "@/components/ds";
import { getPeriods } from "@/server/queries";
import { defaultPeriod } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { ensureCurrentPeriods } from "@/server/periods";

export const dynamic = "force-dynamic";

// The nav's "Bills" entry: a stable URL that lands on the month we're living in (created on
// demand, like /dashboard and /budget do), falling back to the newest month on record.
export default async function MonthsIndex() {
  let periods;
  try {
    await ensureCurrentPeriods();
    periods = await getPeriods(); // newest first
  } catch (e) {
    return <SetupNotice error={e} />;
  }
  if (!periods.length) {
    return (
      <EmptyState
        icon="calendar"
        title="No months yet"
        body="Open the dashboard and the current month is created automatically."
        action={
          <Link href="/dashboard" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Open dashboard
          </Link>
        }
      />
    );
  }
  // Outside the try: redirect() works by throwing.
  redirect(`/months/${defaultPeriod(periods, todayIso()).label}`);
}

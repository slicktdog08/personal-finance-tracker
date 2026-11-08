import { SetupNotice } from "@/components/SetupNotice";
import { TransfersManager } from "@/components/transfers/TransfersManager";
import { getTransfersData, getPeriods } from "@/server/queries";
import { prettyPeriod } from "@/server/lib/period";
import { PageHeader } from "@/components/ds";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const period = one(sp.period) || "";

  let data, periods;
  try {
    [data, periods] = await Promise.all([
      getTransfersData(period || undefined),
      getPeriods(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  return (
    <div className="space-y-4">
      {/* The kit titles every Activity view "Activity"; the sub-tab names the view, and the
          cards below explain what each list is for. */}
      <PageHeader title="Activity" />
      <TransfersManager
        data={data}
        periods={periods.map((p) => ({ label: p.label, pretty: prettyPeriod(p.year, p.month) }))}
        selected={period}
      />
    </div>
  );
}

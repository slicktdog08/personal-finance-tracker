import { SetupNotice } from "@/components/SetupNotice";
import { TransfersManager } from "@/components/transfers/TransfersManager";
import { getTransfersData, getPeriods } from "@/server/queries";
import { prettyPeriod } from "@/server/lib/period";

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
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transfers</h1>
        <p className="text-sm text-neutral-500">
          Link the two sides of internal account-to-account transfers so they don&apos;t count as
          income or spending. Confirm suggested matches, or find the counterpart for transfers
          you&apos;ve flagged.
        </p>
      </div>
      <TransfersManager
        data={data}
        periods={periods.map((p) => ({ label: p.label, pretty: prettyPeriod(p.year, p.month) }))}
        selected={period}
      />
    </div>
  );
}

import { SetupNotice } from "@/components/SetupNotice";
import { CashManager } from "@/components/cash/CashManager";
import { getCashOverview, getPeriods, getWalletAccounts } from "@/server/queries";
import { prettyPeriod, defaultPeriod } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CashPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const requested = one(sp.period);

  let periods, wallets;
  try {
    [periods, wallets] = await Promise.all([getPeriods(), getWalletAccounts()]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  // Default to the current month rather than all of history — cash reconciliation is something
  // you do for the month you're living in. "All months" is still one click away, and picking it
  // sends an empty `?period=`, which is why an explicit request wins even when it's blank.
  const selected = requested ?? defaultPeriod(periods, todayIso())?.label ?? "";
  const overview = await getCashOverview(selected || undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cash</h1>
        <p className="text-sm text-neutral-500 max-w-3xl">
          Money you took out of the bank and money you spent from your pocket are the same
          money. Log a purchase against the withdrawal that funded it and it stops being counted
          twice — whatever a withdrawal can&apos;t explain stays on the books as spending, because
          that cash really did go somewhere.
        </p>
      </div>
      {wallets.length === 0 ? (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
          <p className="font-medium">No cash wallet yet.</p>
          <p className="text-neutral-600 dark:text-neutral-300 mt-1">
            On <a className="underline" href="/accounts">Accounts</a>, set the account you record
            cash spending on (the 9999 &ldquo;Cash&rdquo; one) to type <strong>Cash</strong>. Its
            purchases then become offsettable against ATM withdrawals.
          </p>
        </div>
      ) : (
        <CashManager
          overview={overview}
          periods={periods.map((p) => ({
            label: p.label,
            pretty: prettyPeriod(p.year, p.month),
          }))}
          selected={selected}
          wallet={{
            id: wallets[0].id,
            label: wallets[0].label,
            accountNumber: wallets[0].accountNumber,
          }}
        />
      )}
    </div>
  );
}

import { SetupNotice } from "@/components/SetupNotice";
import { CashManager } from "@/components/cash/CashManager";
import { getCashOverview, getPeriods, getWalletAccounts } from "@/server/queries";
import { prettyPeriod, defaultPeriod } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/ds";

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
    return <SetupNotice error={e} />;
  }

  // Default to the current month rather than all of history — cash reconciliation is something
  // you do for the month you're living in. "All months" is still one click away, and picking it
  // sends an empty `?period=`, which is why an explicit request wins even when it's blank.
  const selected = requested ?? defaultPeriod(periods, todayIso())?.label ?? "";
  const overview = await getCashOverview(selected || undefined);

  return (
    <div className="space-y-4">
      {/* The kit titles every Activity view "Activity"; the sub-tab names the view. */}
      <PageHeader title="Activity" />
      <Notice tone="info">
        Cash you took out of the bank and cash you spent from your pocket are the same money.
        Log a purchase against the withdrawal that funded it and it stops being counted twice.
        Whatever a withdrawal can&apos;t explain stays on the books as spending, because that
        cash really did go somewhere.
      </Notice>
      {wallets.length === 0 ? (
        <Notice tone="warn" title="No cash wallet yet">
          On <Link className="font-medium text-accent-text underline" href="/accounts">Accounts</Link>,
          set the account you record cash spending on (the 9999 &ldquo;Cash&rdquo; one) to type{" "}
          <strong>Cash</strong>. Its purchases then become offsettable against ATM withdrawals.
        </Notice>
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

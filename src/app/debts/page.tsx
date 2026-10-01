import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { DebtCard } from "@/components/debts/DebtCard";
import { AddDebt } from "@/components/debts/AddDebt";
import {
  getLiabilityAccounts,
  getLiabilityLedger,
  getLiabilityPaymentTotals,
  getBillNames,
  getAccountUsageCounts,
  getAccountLastTxnDates,
} from "@/server/queries";
import { formatMoney, toNum } from "@/server/lib/money";
import { monthlyInterest } from "@/server/lib/debt";
import { isSnowballDebt } from "@/server/lib/budget";
import { SNOWBALL_MIN_APR } from "@/constants/enums";

export const dynamic = "force-dynamic";

export default async function DebtsPage() {
  let debts, ledger, payments, billNames, usage, lastTxn;
  try {
    [debts, ledger, payments, billNames, usage, lastTxn] = await Promise.all([
      getLiabilityAccounts(),
      getLiabilityLedger(),
      getLiabilityPaymentTotals(),
      getBillNames(),
      getAccountUsageCounts(),
      getAccountLastTxnDates(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  // Bills the user can adopt as a new liability's name (type-ahead in "Add debt").
  const promotableBills = billNames.map((b) => b.name);
  const usageMap = new Map(usage.map((u) => [u.accountId, Number(u.c)]));

  // Group ledger rows by accountId.
  const byAccount = new Map<number, typeof ledger>();
  for (const r of ledger) {
    const list = byAccount.get(r.accountId) ?? [];
    list.push(r);
    byAccount.set(r.accountId, list);
  }

  // Roll-ups across all liabilities (latest snapshot each).
  let totalOwed = 0;
  let totalMonthlyInterest = 0;
  let totalMinPayment = 0;
  let totalOriginal = 0;
  let anyBalance = false;
  // The debt actually being attacked: everything over the snowball's APR line.
  let hotOwed = 0;
  let hotInterest = 0;
  let hotCount = 0;
  for (const d of debts) {
    const bal = toNum(d.balance);
    if (bal != null) {
      anyBalance = true;
      totalOwed += Math.max(0, bal);
      if (isSnowballDebt({ apr: toNum(d.apr), balance: bal })) {
        hotOwed += bal;
        hotInterest += monthlyInterest(bal, toNum(d.apr)) ?? 0;
        hotCount += 1;
      }
    }
    const mi = monthlyInterest(bal, toNum(d.apr));
    if (mi != null) totalMonthlyInterest += mi;
    totalMinPayment += toNum(d.minPayment) ?? 0;
    totalOriginal += toNum(d.originalPrincipal) ?? 0;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Debts</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Everything you owe — credit cards and loans. This is the same ledger as{" "}
            <Link href="/accounts" className="text-blue-600 hover:underline">
              Accounts
            </Link>{" "}
            (any Credit or Loan account), shown through a debt lens: balance, APR, minimum
            payment, interest cost, and payoff over time. Record a balance here or on Accounts —
            it&apos;s one place, so the two never disagree.
          </p>
        </div>
        <AddDebt existingBills={promotableBills} />
      </div>

      {/* Roll-up summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total owed" value={anyBalance ? formatMoney(totalOwed) : "—"} tone="orange" />
        <Stat
          label={`High-interest (>${SNOWBALL_MIN_APR}%)`}
          value={hotCount > 0 ? formatMoney(hotOwed) : "—"}
          sub={
            hotCount > 0
              ? `${hotCount} debt${hotCount === 1 ? "" : "s"} · ${formatMoney(hotInterest)}/mo interest · ${anyBalance && totalOwed > 0 ? Math.round((hotOwed / totalOwed) * 100) : 0}% of owed`
              : undefined
          }
          tone="red"
        />
        <Stat
          label="Interest / month"
          value={totalMonthlyInterest > 0 ? formatMoney(totalMonthlyInterest) : "—"}
          sub={totalMonthlyInterest > 0 ? `${formatMoney(totalMonthlyInterest * 12)}/yr` : undefined}
          tone="amber"
        />
        <Stat
          label="Min payments / month"
          value={totalMinPayment > 0 ? formatMoney(totalMinPayment) : "—"}
        />
        <Stat
          label="Paid off so far"
          value={totalOriginal > 0 ? formatMoney(Math.max(0, totalOriginal - totalOwed)) : "—"}
          tone="green"
        />
      </div>

      <div className="space-y-4">
        {debts.map((d) => (
          <DebtCard
            key={d.id}
            debt={d}
            ledger={byAccount.get(d.id) ?? []}
            payments={payments.get(d.id) ?? null}
            txnCount={usageMap.get(d.id) ?? 0}
            lastTxn={lastTxn.get(d.id) ?? null}
          />
        ))}
        {debts.length === 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center text-sm text-neutral-500">
            No debts yet. Use <strong>+ Add debt</strong> above to create a credit card or loan, or
            set an existing account&apos;s type to <strong>Credit</strong> or <strong>Loan</strong>{" "}
            on{" "}
            <Link href="/accounts" className="text-blue-600 hover:underline">
              Accounts
            </Link>
            .
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "orange" | "amber" | "green" | "red";
}) {
  const tones: Record<string, string> = {
    red: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
    orange: "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30",
    amber: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    green: "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30",
  };
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone ? tones[tone] : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

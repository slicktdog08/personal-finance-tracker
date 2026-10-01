import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { AccountCard } from "@/components/accounts/AccountCard";
import { AddAccount } from "@/components/accounts/AddAccount";
import { LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import {
  getAccounts,
  getAccountBalances,
  getAccountUsageCounts,
  getAccountLastTxnDates, getAccountSyncInfo } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  let accounts, balances, usage, lastTxn, syncInfo;
  try {
    [accounts, balances, usage, lastTxn, syncInfo] = await Promise.all([
      getAccounts(),
      getAccountBalances(),
      getAccountUsageCounts(),
      getAccountLastTxnDates(),
      getAccountSyncInfo(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  const byAccount = new Map<
    number,
    {
      id: number;
      balance: string;
      creditLimit: string | null;
      apr: string | null;
      minPayment: string | null;
      asOf: string;
      note: string | null;
    }[]
  >();
  for (const b of balances) {
    const list = byAccount.get(b.accountId) ?? [];
    list.push({
      id: b.id,
      balance: b.balance,
      creditLimit: b.creditLimit,
      apr: b.apr,
      minPayment: b.minPayment,
      asOf: b.asOf,
      note: b.note,
    });
    byAccount.set(b.accountId, list);
  }
  const usageMap = new Map(usage.map((u) => [u.accountId, Number(u.c)]));

  // Cash & other accounts only. Credit/Loan accounts are liabilities — they live on Debts, so
  // nothing appears in two places.
  const cashAccounts = accounts.filter((a) => !LIABILITY_ACCOUNT_TYPES.includes(a.accountType ?? ""));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <AddAccount />
      </div>
      <p className="text-sm text-neutral-500">
        Your cash accounts. Set type to <strong>Checking</strong>/<strong>Savings</strong> to track
        cash-on-hand over time (manually recorded snapshots). Credit cards and loans live on{" "}
        <Link href="/debts" className="underline hover:text-neutral-700 dark:hover:text-neutral-300">
          Debts
        </Link>
        {" "}— set an account&apos;s type to <strong>Credit</strong> or <strong>Loan</strong> and it
        moves there.
      </p>

      {/* Two cards per row on desktop; the history inside each is collapsed by default. */}
      <div className="grid gap-4 md:grid-cols-2">
        {cashAccounts.map((a) => (
          <AccountCard
            key={a.id}
            account={{
              id: a.id,
              accountNumber: a.accountNumber,
              label: a.label,
              institution: a.institution,
              accountType: a.accountType,
              originalPrincipal: a.originalPrincipal,
              openedOn: a.openedOn,
            }}
            balances={byAccount.get(a.id) ?? []}
            txnCount={usageMap.get(a.id) ?? 0}
            lastTxn={lastTxn.get(a.id) ?? null}
            sync={
              syncInfo.get(a.id)
                ? {
                    provider: syncInfo.get(a.id)!.provider,
                    enabled: syncInfo.get(a.id)!.enabled,
                    lastSyncedAt: syncInfo.get(a.id)!.lastSyncedAt?.toISOString() ?? null,
                    enrollmentStatus: syncInfo.get(a.id)!.enrollmentStatus,
                  }
                : null
            }
          />
        ))}
        {cashAccounts.length === 0 && (
          <p className="text-sm text-neutral-500">
            No cash accounts yet. Add one above, or find your cards and loans on{" "}
            <Link href="/debts" className="underline">
              Debts
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}

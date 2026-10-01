import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { BillSheet } from "@/components/bills/BillSheet";
import { MonthTransactions } from "@/components/transactions/MonthTransactions";
import {
  getPeriodByLabel,
  getInstances,
  getStatusRows,
  getPaymentTypeRows,
  getBillNames,
  getTransactions,
  getCategoryOptionsRich,
  getCategoryRules,
} from "@/server/queries";
import { prettyPeriod } from "@/server/lib/period";

export const dynamic = "force-dynamic";

export default async function MonthPage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;
  const label = decodeURIComponent(period);

  let p, instances, statuses, payments, billNames, txns, categoryOptions, rules;
  try {
    p = await getPeriodByLabel(label);
    if (!p) {
      return (
        <div className="space-y-3">
          <p className="text-neutral-500">
            No month <code>{label}</code> yet.
          </p>
          <Link href="/dashboard" className="text-blue-600 hover:underline">
            ← Dashboard
          </Link>
        </div>
      );
    }
    [instances, statuses, payments, billNames, txns, categoryOptions, rules] = await Promise.all([
      getInstances(p.id),
      getStatusRows(),
      getPaymentTypeRows(),
      getBillNames(),
      getTransactions({ periodLabel: label, limit: 1000 }),
      getCategoryOptionsRich(),
      getCategoryRules(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  const rows = instances.map((i) => ({
    id: i.id,
    billId: i.billId,
    name: i.name,
    amount: i.amount,
    status: i.status,
    dueDay: i.dueDay,
    paymentType: i.paymentType,
    isDebt: i.isDebt,
    isCancel: i.isCancel,
  }));
  const monthStart = p.startDate ?? `${p.label}-01`;

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/dashboard?period=${label}`} className="text-sm text-neutral-500 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{prettyPeriod(p.year, p.month)}</h1>
      </div>

      <BillSheet
        periodId={p.id}
        path={`/months/${label}`}
        rows={rows}
        statuses={statuses.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          emoji: s.emoji,
          isSettled: s.isSettled,
        }))}
        payments={payments.map((pt) => ({
          id: pt.id,
          name: pt.name,
          color: pt.color,
          emoji: pt.emoji,
        }))}
        billNames={billNames}
      />

      <MonthTransactions
        periodId={p.id}
        path={`/months/${label}`}
        monthStart={monthStart}
        transactions={txns.map((t) => ({
          id: t.id,
          txnDate: t.txnDate,
          description: t.description,
          notes: t.notes,
          category: t.category,
          categoryRuleId: t.categoryRuleId,
          amount: t.amount,
          direction: t.direction,
          accountNumber: t.accountNumber,
          accountLabel: t.accountLabel,
          splits: t.splits,
          pending: t.pending,
          source: t.source,
        }))}
        categoryOptions={categoryOptions}
        rules={rules}
      />
    </div>
  );
}

import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { SetupNotice } from "@/components/SetupNotice";
import { RecurringSuggestions } from "@/components/bills/RecurringSuggestions";
import {
  getBills,
  getAllInstancesWithPeriod,
  getStatusConfig,
  getRecurringSuggestions,
  getBillNames,
} from "@/server/queries";
import { formatMoney, toNum } from "@/server/lib/money";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  let bills, instances, statusConfig, suggestions, billNames;
  try {
    [bills, instances, statusConfig, suggestions, billNames] = await Promise.all([
      getBills(),
      getAllInstancesWithPeriod(),
      getStatusConfig(),
      getRecurringSuggestions(),
      getBillNames(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  const settled = new Set(statusConfig.filter((s) => s.isSettled).map((s) => s.name));
  type Stat = { months: number; timesPaid: number; billed: number; paid: number };
  const stats = new Map<number, Stat>();
  for (const i of instances) {
    if (i.billId == null) continue;
    const s = stats.get(i.billId) ?? { months: 0, timesPaid: 0, billed: 0, paid: 0 };
    s.months += 1;
    const amt = toNum(i.amount) ?? 0;
    s.billed += amt;
    if (settled.has(i.status)) {
      s.timesPaid += 1;
      s.paid += amt;
    }
    stats.set(i.billId, s);
  }

  const sorted = [...bills].sort((a, b) => {
    const sa = stats.get(a.id)?.paid ?? 0;
    const sb = stats.get(b.id)?.paid ?? 0;
    return sb - sa;
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-blue-600">
          <ArrowLeftIcon /> Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Bills</h1>
        <p className="text-sm text-neutral-500">
          Recurring bill definitions across all months. Click a bill for its full history and to
          consolidate duplicates. Each month&apos;s sheet is created automatically from the previous
          one — edit a month from the dashboard.
        </p>
      </div>

      <RecurringSuggestions suggestions={suggestions} bills={billNames} />

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Bill</th>
              <th className="px-3 py-2 font-medium text-center">Debt</th>
              <th className="px-3 py-2 font-medium text-right">Months</th>
              <th className="px-3 py-2 font-medium text-right">Times paid</th>
              <th className="px-3 py-2 font-medium text-right">Total billed</th>
              <th className="px-3 py-2 font-medium text-right">Total paid</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const s = stats.get(b.id) ?? { months: 0, timesPaid: 0, billed: 0, paid: 0 };
              return (
                <tr key={b.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-1.5">
                    <Link href={`/settings/bills/${b.id}`} className="text-blue-600 hover:underline font-medium">
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-center">{b.isDebt ? "💳" : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.months}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.timesPaid}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(s.billed)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(s.paid)}</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No bills yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { ColorBadge } from "@/components/ColorBadge";
import { BillMerge } from "@/components/bills/BillMerge";
import { BillRename } from "@/components/bills/BillRename";
import { BillTransactions } from "@/components/bills/BillTransactions";
import {
  getBillById,
  getBillHistory,
  getBillTransactions,
  getStatusConfig,
  getPaymentTypeConfig,
  getBillNames,
} from "@/server/queries";
import { formatMoney, toNum } from "@/server/lib/money";
import { prettyPeriod } from "@/server/lib/period";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const billId = Number(id);

  let bill, history, linked, statuses, payments, allBills;
  try {
    bill = await getBillById(billId);
    if (!bill) {
      return (
        <div className="space-y-3">
          <p className="text-neutral-500">Bill not found.</p>
          <Link href="/settings/bills" className="text-blue-600 hover:underline">
            ← Back to bills (Settings)
          </Link>
        </div>
      );
    }
    [history, linked, statuses, payments, allBills] = await Promise.all([
      getBillHistory(billId),
      getBillTransactions(billId),
      getStatusConfig(),
      getPaymentTypeConfig(),
      getBillNames(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  const statusColor = new Map(statuses.map((s) => [s.name, s.color]));
  const statusEmoji = new Map(statuses.map((s) => [s.name, s.emoji]));
  const paymentColor = new Map(payments.map((p) => [p.name, p.color]));
  const paymentEmoji = new Map(payments.map((p) => [p.name, p.emoji]));
  const settled = new Set(statuses.filter((s) => s.isSettled).map((s) => s.name));

  const billed = history.reduce((s, h) => s + (toNum(h.amount) ?? 0), 0);
  const paidRows = history.filter((h) => settled.has(h.status));
  const paid = paidRows.reduce((s, h) => s + (toNum(h.amount) ?? 0), 0);
  const others = allBills.filter((b) => b.id !== billId);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/bills" className="text-sm text-neutral-500 hover:underline">
          ← Bills
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {bill.name}
            {bill.isDebt ? <span title="Debt">💳</span> : null}
          </h1>
          <BillRename id={billId} name={bill.name} />
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          This is the bill&apos;s general name. Monthly line items can keep their own, more
          detailed names — renaming here doesn&apos;t change past line items.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Months tracked" value={String(history.length)} />
        <Stat label="Times paid" value={String(paidRows.length)} />
        <Stat label="Total billed" value={formatMoney(billed)} />
        <Stat label="Total paid" value={formatMoney(paid)} accent />
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-100 dark:bg-neutral-900 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.instanceId} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-1.5">
                    <Link href={`/months/${h.label}`} className="text-blue-600 hover:underline">
                      {prettyPeriod(h.year, h.month)}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(h.amount)}</td>
                  <td className="px-3 py-1.5">
                    <ColorBadge
                      label={h.status}
                      color={statusColor.get(h.status)}
                      emoji={statusEmoji.get(h.status)}
                    />
                  </td>
                  <td className="px-3 py-1.5">{h.dueDay ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {h.paymentType ? (
                      <ColorBadge
                        label={h.paymentType}
                        color={paymentColor.get(h.paymentType)}
                        emoji={paymentEmoji.get(h.paymentType)}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                    No history.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BillTransactions billId={billId} billName={bill.name} rows={linked} others={others} />

      <BillMerge currentId={billId} currentName={bill.name} others={others} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        accent
          ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

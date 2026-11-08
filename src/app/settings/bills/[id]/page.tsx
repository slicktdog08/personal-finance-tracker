import { Badge, Card, DataTable, EmptyState, Glyph, Icon, Money, PageHeader, StatTile, buttonClass, type VarStyle } from "@/components/ds";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { BillMerge } from "@/components/bills/BillMerge";
import { BillRename } from "@/components/bills/BillRename";
import { BillCategory } from "@/components/bills/BillCategory";
import { BillTransactions } from "@/components/bills/BillTransactions";
import {
  getBillById,
  getBillHistory,
  getBillTransactions,
  getStatusConfig,
  getPaymentTypeConfig,
  getBillNames,
  getCategoryOptionsRich,
  getBillGuessedCategory,
} from "@/server/queries";
import { formatMoney, toNum } from "@/server/lib/money";
import { MONTH_ABBR, prettyPeriod } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { billIcon } from "@/components/bills/billGlyph";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const billId = Number(id);

  let bill, history, linked, statuses, payments, allBills, categoryNames;
  try {
    bill = await getBillById(billId);
    if (bill)
      [history, linked, statuses, payments, allBills, categoryNames] = await Promise.all([
        getBillHistory(billId),
        getBillTransactions(billId),
        getStatusConfig(),
        getPaymentTypeConfig(),
        getBillNames(),
        getCategoryOptionsRich(),
      ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }
  if (!bill || !history || !linked || !statuses || !payments || !allBills || !categoryNames) {
    return (
      <EmptyState
        icon="receipt"
        title="Bill not found"
        body="It may have been merged into another bill."
        action={
          <Link href="/settings/bills" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Back to recurring bills
          </Link>
        }
      />
    );
  }

  const statusColor = new Map(statuses.map((s) => [s.name, s.color]));
  const paymentColor = new Map(payments.map((p) => [p.name, p.color]));
  const settled = new Set(statuses.filter((s) => s.isSettled).map((s) => s.name));

  const amountOf = (h: (typeof history)[number]) => toNum(h.amount) ?? 0;
  const billed = history.reduce((s, h) => s + amountOf(h), 0);
  const paidRows = history.filter((h) => settled.has(h.status));
  const paid = paidRows.reduce((s, h) => s + amountOf(h), 0);
  const latest = history[0] ?? null; // newest first
  const recent = history.slice(0, 6);
  const avg6 = recent.length ? recent.reduce((s, h) => s + amountOf(h), 0) / recent.length : 0;
  const thisYear = Number(todayIso().slice(0, 4));
  const paidThisYear = paidRows.filter((h) => h.year === thisYear);
  const others = allBills.filter((b) => b.id !== billId);
  // What the old transaction-majority guess produces, shown so "unset" is never a mystery.
  const guessedCategory = await getBillGuessedCategory(billId);
  // Oldest → newest for the chart, last twelve months on record.
  const chart = history.slice(0, 12).reverse();
  const chartMax = Math.max(1, ...chart.map(amountOf));

  return (
    <div className="space-y-6">
      <PageHeader
        showTitleOnMobile
        eyebrow={
          <Link href="/settings/bills" className="inline-flex items-center gap-1 hover:text-accent-text">
            <Icon name="arrow-left" size={14} /> Recurring bills
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <Glyph icon={billIcon(bill.name, bill.isDebt)} color={latest ? statusColor.get(latest.status) : undefined} size="lg" />
            {bill.name}
            {bill.isDebt ? <Badge label="Debt" variant="outline" size="sm" dot={false} /> : null}
          </span>
        }
        description="This is the bill's general name. Monthly line items can keep their own, more detailed names — renaming here doesn't change past line items."
        actions={<BillRename id={billId} name={bill.name} />}
      />

      <Card>
        <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as VarStyle}>
          <StatTile
            label="Latest"
            value={latest ? amountOf(latest) : "—"}
            sub={
              latest ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {prettyPeriod(latest.year, latest.month)}
                  <Badge label={latest.status} color={statusColor.get(latest.status)} variant="solid" size="sm" />
                </span>
              ) : (
                "No months yet"
              )
            }
          />
          <StatTile label="6-month average" value={avg6} sub={`Over ${recent.length} month${recent.length === 1 ? "" : "s"}`} />
          <StatTile label="Paid this year" value={paidThisYear.reduce((s, h) => s + amountOf(h), 0)} sub={`${paidThisYear.length} payment${paidThisYear.length === 1 ? "" : "s"} in ${thisYear}`} />
          <StatTile label="Total paid" value={paid} kind="income" sub={`${paidRows.length} of ${history.length} months paid`} />
        </div>
        <div className="mt-3 text-sm text-fg-2">
          <Money value={billed} kind="neutral" /> billed across {history.length} month{history.length === 1 ? "" : "s"} tracked.
        </div>
      </Card>

      <Card title="Budget envelope">
        <BillCategory
          id={billId}
          category={bill.category ?? null}
          inherited={guessedCategory}
          options={categoryNames.filter((c) => c.active)}
        />
      </Card>

      <Card title="History" meta={history.length ? `${history.length}` : undefined} padded={false}>
        {chart.length > 1 && (
          // Answers "is this bill creeping up?" — amounts per month, the newest in the accent.
          <div className="px-5 pb-2 pt-4 max-md:px-3.5" aria-label="Amount by month" role="img">
            <div className="grid h-[104px] items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${chart.length}, minmax(0, 1fr))` }}>
              {chart.map((h, i) => (
                <div key={h.instanceId} className="flex h-full flex-col items-center justify-end gap-1" title={`${prettyPeriod(h.year, h.month)}: ${formatMoney(h.amount)} · ${h.status}`}>
                  <div
                    className={`w-full max-w-10 rounded-[6px] ${i === chart.length - 1 ? "bg-accent" : settled.has(h.status) ? "bg-accent-soft-2" : "bg-line-2"}`}
                    style={{ height: `${Math.max(2, (amountOf(h) / chartMax) * 80)}px` }}
                  />
                  <span className="text-[11px] text-fg-3">{MONTH_ABBR[h.month - 1]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <DataTable
          rows={history}
          rowKey={(h) => h.instanceId}
          columns={[
            {
              key: "month",
              header: "Month",
              render: (h) => (
                <Link href={`/months/${h.label}`} className="font-medium text-accent-text hover:underline">
                  {prettyPeriod(h.year, h.month)}
                </Link>
              ),
            },
            { key: "amount", header: "Amount", num: true, render: (h) => <Money value={h.amount} kind="neutral" /> },
            { key: "status", header: "Status", render: (h) => <Badge label={h.status} color={statusColor.get(h.status)} variant="solid" /> },
            { key: "due", header: "Due", shrink: true, render: (h) => <span className="tnum text-fg-2">{h.dueDay != null ? `${MONTH_ABBR[h.month - 1]} ${h.dueDay}` : "—"}</span> },
            { key: "payment", header: "Payment", render: (h) => <Badge label={h.paymentType} color={h.paymentType ? paymentColor.get(h.paymentType) : undefined} /> },
          ]}
          mobile={{
            title: (h) => (
              <Link href={`/months/${h.label}`} className="hover:text-accent-text">
                {prettyPeriod(h.year, h.month)}
              </Link>
            ),
            sub: (h) => (
              <>
                <Badge label={h.status} color={statusColor.get(h.status)} variant="solid" size="sm" />
                {h.dueDay != null && <span className="tnum">Due {MONTH_ABBR[h.month - 1]} {h.dueDay}</span>}
              </>
            ),
            amount: (h) => <Money value={h.amount} kind="neutral" />,
            meta: (h) => h.paymentType ?? "",
          }}
          empty={<EmptyState compact icon="history" title="No history yet" body="This bill hasn't been on a month yet." />}
        />
      </Card>

      <BillTransactions billId={billId} billName={bill.name} rows={linked} others={others} />

      <BillMerge currentId={billId} currentName={bill.name} others={others} />
    </div>
  );
}

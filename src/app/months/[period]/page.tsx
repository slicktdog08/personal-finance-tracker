import { EmptyState, PageHeader, buttonClass } from "@/components/ds";
import { MonthNav } from "@/components/dashboard/MonthNav";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { BillSheet } from "@/components/bills/BillSheet";
import { AddBillButton } from "@/components/bills/AddBillButton";
import { TransactionsTable } from "@/components/transactions/TransactionsTable";
import { AddTransaction } from "@/components/transactions/AddTransaction";
import { DeleteMonthButton } from "@/components/months/DeleteMonthButton";
import {
  getPeriodByLabel,
  getPeriods,
  getInstances,
  getStatusRows,
  getPaymentTypeRows,
  getBillNames,
  getTransactionsPage,
  getAccounts,
  getOpenWithdrawals,
  getCategoryOptionsRich,
  getCategoryRules,
} from "@/server/queries";
import { prettyPeriod } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams?: Promise<SP>;
}) {
  const { period } = await params;
  const label = decodeURIComponent(period);
  const sp = (await searchParams) ?? {};
  // The month's transactions are the Activity table itself, scoped to this month — same rows,
  // same controls. Sort and paging live in this page's own query string.
  const txQuery = {
    periodLabels: [label],
    sort: one(sp.sort) || "date",
    dir: (one(sp.dir) === "asc" ? "asc" : "desc") as "asc" | "desc",
    page: one(sp.page) ? Number(one(sp.page)) : 1,
    pageSize: one(sp.size) ? Number(one(sp.size)) : 50,
  };

  let p, data;
  try {
    p = await getPeriodByLabel(label);
    data = p
      ? await Promise.all([
          getInstances(p.id),
          getStatusRows(),
          getPaymentTypeRows(),
          getBillNames(),
          getTransactionsPage(txQuery),
          getCategoryOptionsRich(),
          getCategoryRules(),
          getPeriods(),
          getAccounts(),
          getOpenWithdrawals(),
        ])
      : null;
  } catch (e) {
    return <SetupNotice error={e} />;
  }
  if (!p || !data) {
    return (
      <EmptyState
        icon="calendar"
        title={`No month ${label} yet`}
        body="Months are created automatically as you reach them."
        action={
          <Link href="/months" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Go to this month
          </Link>
        }
      />
    );
  }
  const [instances, statuses, payments, billNames, txPage, categoryOptions, rules, allPeriods, accounts, openWithdrawals] = data;
  const { rows: txRows, total: txTotal, page: txPageNo, pageSize: txPageSize, pages: txPages, sumDebit, sumCredit, sumNet } = txPage;
  const navPeriods = allPeriods.map((x) => ({ label: x.label, pretty: prettyPeriod(x.year, x.month) })).reverse(); // oldest -> newest

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
  const today = todayIso();
  const pretty = prettyPeriod(p.year, p.month);
  const path = `/months/${label}`;

  return (
    <div className="space-y-8">
      {/* The kit's layout: month as eyebrow, "Bills" as title. On phones the top bar already says
          Bills and the MonthNav names the month, so the title row hides. */}
      <PageHeader
        eyebrow={pretty}
        title="Bills"
        actions={
          <>
            <MonthNav periods={navPeriods} current={label} basePath="/months" mode="path" />
            <AddBillButton periodId={p.id} path={path} billNames={billNames} />
          </>
        }
      />

      <BillSheet
        path={path}
        year={p.year}
        month={p.month}
        today={today}
        dashboardHref={`/dashboard?period=${label}`}
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
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Transactions this month</h2>
          <div className="flex items-center gap-2">
            <Link href={`/transactions?period=${label}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
              Open in Activity
            </Link>
            <AddTransaction
              accounts={accounts.map((a) => ({ id: a.id, accountNumber: a.accountNumber, label: a.label, accountType: a.accountType }))}
              categoryOptions={categoryOptions}
              openWithdrawals={openWithdrawals}
              path={`/months/${label}`}
              defaultDate={today.startsWith(label) ? today : monthStart}
            />
          </div>
        </div>
        <TransactionsTable
          basePath={`/months/${label}`}
          rows={txRows.map((t) => ({
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
            billId: t.billId,
            accountType: t.accountType,
            allocated: t.allocated,
            covered: t.covered,
            pending: t.pending,
            splits: t.splits,
            source: t.source,
          }))}
          categoryOptions={categoryOptions}
          accounts={accounts.map((a) => ({ id: a.id, accountNumber: a.accountNumber, label: a.label }))}
          bills={billNames}
          rules={rules}
          page={txPageNo}
          pages={txPages}
          pageSize={txPageSize}
          sort={txQuery.sort}
          dir={txQuery.dir}
          summary={{
            total: txTotal,
            from: txTotal === 0 ? 0 : (txPageNo - 1) * txPageSize + 1,
            to: Math.min(txTotal, txPageNo * txPageSize),
            sumDebit,
            sumCredit,
            sumNet,
          }}
        />
      </section>

      {/* Rare and destructive, so it lives at the foot of the month rather than in the header. */}
      <div className="flex justify-end border-t border-line pt-4">
        <DeleteMonthButton periodId={p.id} pretty={pretty} billCount={instances.length} txnCount={txTotal} />
      </div>
    </div>
  );
}

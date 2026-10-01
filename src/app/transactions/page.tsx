import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { TransactionsTable } from "@/components/transactions/TransactionsTable";
import { AddTransaction } from "@/components/transactions/AddTransaction";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { PendingReview } from "@/components/transactions/PendingReview";
import { formatMoney } from "@/server/lib/money";
import {
  getTransactionsPage,
  getAccounts,
  getCategoryOptionsRich,
  getPeriods,
  getUncategorizedCount,
  getBillNames,
  getOpenWithdrawals,
  getCategoryRules,
  getPendingReview,
  type TxQuery,
} from "@/server/queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
// Repeated params (?account=1&account=2) arrive as an array; a single value as a
// string. Normalize either to a string[] for the multi-select filters.
const many = (v: string | string[] | undefined): string[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).filter((s) => s !== "");

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const periodLabels = many(sp.period);
  const accountIds = many(sp.account)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const categories = many(sp.category);
  const q: TxQuery = {
    periodLabels: periodLabels.length ? periodLabels : undefined,
    accountIds: accountIds.length ? accountIds : undefined,
    categories: categories.length ? categories : undefined,
    direction: one(sp.direction) || undefined,
    search: one(sp.q) || undefined,
    uncategorized: one(sp.uncat) === "1",
    pending: one(sp.pending) === "1",
    sort: one(sp.sort) || "date",
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    page: one(sp.page) ? Number(one(sp.page)) : 1,
    pageSize: one(sp.size) ? Number(one(sp.size)) : 50,
  };

  let result, accounts, catOptions, periods, uncategorized, billOptions, openWithdrawals, rules,
    pendingReview;
  try {
    [
      result,
      accounts,
      catOptions,
      periods,
      uncategorized,
      billOptions,
      openWithdrawals,
      rules,
      pendingReview,
    ] =
      await Promise.all([
        getTransactionsPage(q),
        getAccounts(),
        getCategoryOptionsRich(),
        getPeriods(),
        getUncategorizedCount(),
        getBillNames(),
        // Withdrawals that still hold cash, so a wallet purchase can be offset as it's entered.
        getOpenWithdrawals(),
        getCategoryRules(),
        // Hand-entered pending charges, each with the imported row it likely posted as.
        getPendingReview(),
      ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  const { rows, total, page, pageSize, pages, sumDebit, sumCredit, sumNet } = result;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  // When exactly one account is filtered, default the "Add transaction" form to it.
  const filteredAccount =
    accountIds.length === 1 ? accounts.find((a) => a.id === accountIds[0]) : undefined;

  return (
    // The shared <main> caps pages at max-w-7xl, which squeezes this eight-column table.
    // Negative margins (a share of the slack between the cap and the viewport) let the page
    // spread to 96rem on wide screens without ever exceeding the viewport.
    <div className="space-y-5 xl:mx-[calc((100%_-_min(100vw_-_2rem,96rem))/2)]">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-neutral-500">
            {uncategorized} uncategorized
          </span>
          <AddTransaction
            accounts={accounts.map((a) => ({
              id: a.id,
              accountNumber: a.accountNumber,
              label: a.label,
              accountType: a.accountType,
            }))}
            categoryOptions={catOptions}
            defaultAccountNumber={filteredAccount?.accountNumber}
            openWithdrawals={openWithdrawals}
          />
          <Link
            href="/transactions/categorize"
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Mass categorize →
          </Link>
        </div>
      </div>

      {/* Filters apply live (debounced) via client-side navigation — no submit button. */}
      <TransactionFilters
        periods={periods.map((p) => ({ label: p.label }))}
        accounts={accounts.map((a) => ({
          id: a.id,
          accountNumber: a.accountNumber,
          label: a.label,
        }))}
        categoryOptions={catOptions}
        initial={{
          periodLabels,
          accountIds: accountIds.map(String),
          categories,
          direction: q.direction ?? "",
          search: q.search ?? "",
          uncategorized: q.uncategorized ?? false,
          pending: q.pending ?? false,
        }}
      />

      <PendingReview items={pendingReview} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-neutral-500">
          Showing {from}–{to} of {total.toLocaleString()}
        </span>
        {total > 0 && (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-neutral-500">
              Out{" "}
              <span className="font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                {formatMoney(sumDebit)}
              </span>
            </span>
            <span className="text-neutral-500">
              In{" "}
              <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatMoney(sumCredit)}
              </span>
            </span>
            <span className="text-neutral-500">
              Net{" "}
              <span
                className={`font-semibold tabular-nums ${
                  sumNet < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {formatMoney(sumNet)}
              </span>
            </span>
          </span>
        )}
      </div>

      <TransactionsTable
        rows={rows.map((t) => ({
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
        categoryOptions={catOptions}
        accounts={accounts.map((a) => ({
          id: a.id,
          accountNumber: a.accountNumber,
          label: a.label,
        }))}
        bills={billOptions}
        rules={rules}
        page={page}
        pages={pages}
        pageSize={pageSize}
        sort={q.sort ?? "date"}
        dir={q.dir ?? "desc"}
      />
    </div>
  );
}

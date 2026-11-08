import { MarkTransactionsSeen } from "@/components/transactions/MarkTransactionsSeen";
import { PageHeader, buttonClass, Icon } from "@/components/ds";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { TransactionsTable } from "@/components/transactions/TransactionsTable";
import { AddTransaction } from "@/components/transactions/AddTransaction";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { PendingReview } from "@/components/transactions/PendingReview";
import { prettyPeriod } from "@/server/lib/period";
import {
  getTransactionsPage,
  getLatestTransactionId,
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
    billLinked: one(sp.bill) === "1",
    sort: one(sp.sort) || "date",
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    page: one(sp.page) ? Number(one(sp.page)) : 1,
    pageSize: one(sp.size) ? Number(one(sp.size)) : 50,
  };

  // Each filter chip's count: what the page would hold with that chip on, everything else as
  // is. Reuses the page query (one row, totals only) so the counts can't drift from the list.
  const chipCount = (extra: Partial<TxQuery>) =>
    getTransactionsPage({ ...q, ...extra, page: 1, pageSize: 1 }).then((r) => r.total);

  let result, accounts, catOptions, periods, uncategorized, billOptions, openWithdrawals, rules,
    pendingReview, latestId, uncatCount, pendingCount, billCount;
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
      latestId,
      uncatCount,
      pendingCount,
      billCount,
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
        // Opening this page marks everything up to here as seen (the nav "new" badge).
        getLatestTransactionId(),
        q.uncategorized ? null : chipCount({ uncategorized: true }),
        q.pending ? null : chipCount({ pending: true }),
        q.billLinked ? null : chipCount({ billLinked: true }),
      ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  const { rows, total, page, pageSize, pages, sumDebit, sumCredit, sumNet } = result;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  // When exactly one account is filtered, default the "Add transaction" form to it.
  const filteredAccount =
    accountIds.length === 1 ? accounts.find((a) => a.id === accountIds[0]) : undefined;

  return (
    // The shell caps page content at 80rem, which squeezes the wide table. Negative margins
    // (a share of the slack between the cap and the main column) let the page spread to 96rem
    // on wide screens without ever exceeding that column. 100cqw is the main column (the
    // shell's `app` container), not the viewport, so the sidebar is never overlapped.
    <div className="space-y-4 xl:mx-[calc((100%_-_min(100cqw_-_2rem,96rem))/2)]">
      <MarkTransactionsSeen upToId={latestId} />
      <PageHeader
        title="Activity"
        actions={
          <>
            {uncategorized > 0 && (
              <Link
                href="/transactions/categorize"
                className={buttonClass({ variant: "ghost", className: "max-lg:hidden" })}
              >
                <Icon name="tags" size={16} />
                {uncategorized.toLocaleString()} to categorize
              </Link>
            )}
            <Link href="/import" className={buttonClass({ variant: "secondary", className: "max-lg:hidden" })}>
              <Icon name="upload" size={16} />
              Import
            </Link>
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
          </>
        }
      />

      <PendingReview items={pendingReview} />

      {/* Filters apply live (debounced) via client-side navigation — no submit button. */}
      <TransactionFilters
        periods={periods.map((p) => ({ label: p.label, pretty: prettyPeriod(p.year, p.month) }))}
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
          billLinked: q.billLinked ?? false,
        }}
        counts={{
          // With a chip already on, its count is just the current total.
          uncategorized: uncatCount ?? total,
          pending: pendingCount ?? total,
          billLinked: billCount ?? total,
        }}
      />

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
        summary={{ total, from, to, sumDebit, sumCredit, sumNet }}
      />
    </div>
  );
}

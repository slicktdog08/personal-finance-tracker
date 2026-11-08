import Link from "next/link";
import { Card, EmptyState, Glyph, Icon, Money, PageHeader, StatTile, buttonClass } from "@/components/ds";
import { SetupNotice } from "@/components/SetupNotice";
import { AccountCard } from "@/components/accounts/AccountCard";
import { AddAccount } from "@/components/accounts/AddAccount";
import { SyncNowButton } from "@/components/accounts/SyncNowButton";
import { accountGlyph, accountMaskLine } from "@/components/accounts/account-glyph";
import { CASH_ACCOUNT_TYPES, LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import { relativeTime } from "@/lib/sync-format";
import { formatMoney, toNum } from "@/server/lib/money";
import { todayIso } from "@/server/lib/pay-schedule";
import {
  getAccounts,
  getAccountBalances,
  getAccountUsageCounts,
  getAccountLastTxnDates, getAccountSyncInfo } from "@/server/queries";

export const dynamic = "force-dynamic";

const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
    return <SetupNotice error={e} />;
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

  // Ledgers are newest-first, so [0] is the latest snapshot; one on or before a date is the
  // balance as of that date (null when nothing was recorded by then).
  const balanceAsOf = (id: number, date?: string): number | null => {
    const row = (byAccount.get(id) ?? []).find((b) => !date || b.asOf <= date);
    return row ? toNum(row.balance) : null;
  };

  const isLiability = (t: string | null) => LIABILITY_ACCOUNT_TYPES.includes(t ?? "");
  const cashAccounts = accounts.filter((a) => CASH_ACCOUNT_TYPES.includes(a.accountType ?? ""));
  // Non-cash, non-liability accounts (Other / no type yet) still get a full card here.
  const otherAccounts = accounts.filter((a) => !CASH_ACCOUNT_TYPES.includes(a.accountType ?? "") && !isLiability(a.accountType));
  const creditAccounts = accounts.filter((a) => a.accountType === "Credit");
  const loanAccounts = accounts.filter((a) => a.accountType === "Loan");

  // KPIs, summed the way the dashboard sums them: cash = every cash-type account (wallet
  // included); owed = card balances + loan balances (a loan can't be owed below zero).
  const cashAt = (date?: string) => cashAccounts.reduce((s, a) => s + (balanceAsOf(a.id, date) ?? 0), 0);
  const owedAt = (date?: string) =>
    creditAccounts.reduce((s, a) => s + (balanceAsOf(a.id, date) ?? 0), 0) +
    loanAccounts.reduce((s, a) => s + Math.max(0, balanceAsOf(a.id, date) ?? 0), 0);
  const cashOnHand = cashAt();
  const owed = owedAt();
  const netWorth = cashOnHand - owed;

  // Net worth 30 days ago — only when every account counted today already had a balance then,
  // so an account that started being tracked recently doesn't read as a jump.
  const then = new Date(Date.parse(todayIso()) - 30 * 86_400_000).toISOString().slice(0, 10);
  const counted = [...cashAccounts, ...creditAccounts, ...loanAccounts].filter((a) => balanceAsOf(a.id) != null);
  const comparable = counted.length > 0 && counted.every((a) => balanceAsOf(a.id, then) != null);
  const netDelta = comparable ? netWorth - (cashAt(then) - owedAt(then)) : null;

  const syncFor = (id: number) => {
    const s = syncInfo.get(id);
    return s
      ? {
          provider: s.provider,
          enabled: s.enabled,
          lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
          enrollmentStatus: s.enrollmentStatus,
        }
      : null;
  };
  const canSync = [...syncInfo.values()].some((s) => s.enabled && s.enrollmentStatus === "active");

  const card = (a: (typeof accounts)[number]) => (
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
      sync={syncFor(a.id)}
    />
  );

  // Cards and loans are edited on Debts (their one home), so here they're read-only rows that
  // link there — listed so the ledger is whole and the KPIs above add up on screen.
  const liabilityRow = (a: (typeof accounts)[number]) => {
    const list = byAccount.get(a.id) ?? [];
    const bal = balanceAsOf(a.id);
    // Limit / APR change rarely: the freshest non-null value wins (as on Debts).
    const limit = toNum(list.find((b) => b.creditLimit != null)?.creditLimit ?? null);
    const apr = list.find((b) => b.apr != null)?.apr ?? null;
    const s = syncFor(a.id);
    const g = accountGlyph(a.accountType);
    return (
      <Link key={a.id} href="/debts" className="mp-listrow mp-listrow--button">
        <Glyph icon={g.icon} color={g.color} />
        <span className="mp-listrow__main">
          <span className="mp-listrow__title">{a.label || a.institution || `••${a.accountNumber}`}</span>
          <span className="mp-listrow__sub truncate">
            {accountMaskLine(a)}
            {s && s.enabled && s.enrollmentStatus === "active" && ` · synced ${relativeTime(s.lastSyncedAt)}`}
            {!a.active && " · inactive"}
          </span>
        </span>
        <span className="mp-listrow__end">
          {bal != null ? <Money value={bal} kind="owed" /> : <span className="text-fg-3">—</span>}
          {a.accountType === "Credit" && limit != null ? (
            <span className="mp-listrow__sub">of {formatMoney(limit)} limit</span>
          ) : apr != null ? (
            <span className="mp-listrow__sub">{apr}% APR</span>
          ) : null}
        </span>
      </Link>
    );
  };
  const onDebts = (
    <Link href="/debts" className={buttonClass({ variant: "ghost", size: "sm" })}>
      Manage on Debts
      <Icon name="chevron-right" size={15} />
    </Link>
  );
  const count = (n: number) => `${n} account${n === 1 ? "" : "s"}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounts"
        description="Every account in one ledger. Debts and cash share the same balance history."
        actions={
          <>
            {canSync && <SyncNowButton />}
            <AddAccount />
          </>
        }
      />

      <div className="mp-grid mp-grid--keep2" style={{ "--cols": 3 } as React.CSSProperties}>
        <Card>
          <StatTile label="Cash on hand" value={cashOnHand} />
        </Card>
        <Card>
          <StatTile label="Owed" value={owed} kind="owed" />
        </Card>
        {/* Two KPIs per row on phones (kit) — net worth is the third, so it's desktop-only. */}
        <Card className="max-md:hidden">
          <StatTile
            label="Net worth"
            value={<Money value={netWorth} kind="neutral" />}
            delta={
              netDelta != null && Math.round(netDelta) !== 0
                ? {
                    dir: netDelta > 0 ? "up" : "down",
                    label: `${netDelta > 0 ? "+" : "−"}${wholeUsd.format(Math.abs(netDelta))} in 30 days`,
                  }
                : undefined
            }
          />
        </Card>
      </div>

      <Card title="Cash" meta={count(cashAccounts.length)}>
        {cashAccounts.map(card)}
        {cashAccounts.length === 0 && (
          <EmptyState
            compact
            icon="landmark"
            title="No cash accounts yet"
            body="Add your checking, savings or wallet to track cash on hand over time."
          />
        )}
      </Card>

      {otherAccounts.length > 0 && (
        <Card title="Other accounts" meta={count(otherAccounts.length)}>
          {otherAccounts.map(card)}
        </Card>
      )}

      {creditAccounts.length > 0 && (
        <Card title="Credit cards" meta={count(creditAccounts.length)} action={onDebts}>
          {creditAccounts.map(liabilityRow)}
        </Card>
      )}

      {loanAccounts.length > 0 && (
        <Card title="Loans" meta={count(loanAccounts.length)} action={onDebts}>
          {loanAccounts.map(liabilityRow)}
        </Card>
      )}
    </div>
  );
}

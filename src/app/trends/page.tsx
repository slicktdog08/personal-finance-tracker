import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { BarsChart } from "@/components/charts/BarsChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { DeltaBars } from "@/components/charts/DeltaBars";
import { Sparkline } from "@/components/charts/Sparkline";
import { MetricExplorer, type MetricSeries } from "@/components/trends/MetricExplorer";
import { Card, EmptyState, Glyph, Money, PageHeader, StatTile } from "@/components/ds";
import { getAccountBalanceTrends, getBalanceTrends, getCashflowByPeriod, getCategoryRows, getCategorySpend, netWorthOf } from "@/server/queries";
import { formatMoney, toNum } from "@/server/lib/money";
import { currentPeriodLabel, shortMonthLabel } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { cumulativeNet, flowTotals, monthlyLedger, seriesStats, windowStartLabel, type FlowMonth, type TrendMonth } from "@/server/lib/trends";
import { CASH_ACCOUNT_TYPES, RETIREMENT_ACCOUNT_TYPES } from "@/constants/enums";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trends" };

// The window every section covers, as ?range=. Max is everything since the record began.
const RANGES = [
  { value: "3m", label: "3M", months: 3, long: "3 months" },
  { value: "6m", label: "6M", months: 6, long: "6 months" },
  { value: "1y", label: "1Y", months: 12, long: "12 months" },
  { value: "2y", label: "2Y", months: 24, long: "2 years" },
  { value: "max", label: "Max", months: null, long: "all time" },
] as const;
type Range = (typeof RANGES)[number]["value"];
const DEFAULT_RANGE: Range = "max";

const RETIREMENT_COLOR = "#8b5cf6";
const ASSETS_COLOR = "#d97706";

export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range: Range = RANGES.some((r) => r.value === sp.range) ? (sp.range as Range) : DEFAULT_RANGE;
  const rangeDef = RANGES.find((r) => r.value === range)!;
  let balanceTrends, cashflow, catRows;
  try {
    [balanceTrends, cashflow, catRows] = await Promise.all([getBalanceTrends(), getCashflowByPeriod(), getCategoryRows()]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  // Months after today would just repeat the latest snapshots, so the record stops at "now".
  const currentLabel = currentPeriodLabel(todayIso());
  const tracked = balanceTrends.filter((t) => currentLabel == null || t.label <= currentLabel);
  // Months exist as periods long before any balance was recorded in them, and an axis that opens
  // with a year of blank months squeezes the part that has data into a corner — so it starts
  // where the record actually starts.
  const opened = tracked.findIndex((t) => t.cash != null || t.credit != null || t.loans != null || t.retirement !== 0 || t.assets !== 0);
  const recorded = opened < 0 ? [] : tracked.slice(opened);
  // The range toggle trims the window to its last N months (Max keeps the whole record).
  const lastLabel = currentLabel ?? recorded[recorded.length - 1]?.label;
  const cutoff = rangeDef.months != null && lastLabel ? windowStartLabel(lastLabel, rangeDef.months) : null;
  const months: TrendMonth[] = cutoff ? recorded.filter((t) => t.label >= cutoff) : recorded;

  // Same guard as the dashboard: a month only counts once every kind of balance it's made of has
  // been recorded, so the months before debts were tracked don't read as a small positive net
  // worth that "crashes" when the cards first show up.
  const hasCredit = months.some((t) => t.credit != null);
  const hasLoans = months.some((t) => t.loans != null);
  const hasRetirement = months.some((t) => t.retirement !== 0);
  const hasAssets = months.some((t) => t.assets !== 0);
  const comparableNet = (t: TrendMonth) =>
    t.cash == null || (hasCredit && t.credit == null) || (hasLoans && t.loans == null) ? null : netWorthOf(t);
  const labels = months.map((t) => shortMonthLabel(t.label));
  const net = months.map((t, i) => ({ label: labels[i], value: comparableNet(t) }));

  const defined = net.flatMap((p, i) => (p.value == null ? [] : [{ ...p, value: p.value, i }]));
  const latest = defined[defined.length - 1];
  const latestMonth = latest ? months[latest.i] : null;

  if (defined.length < 2) {
    return (
      <div className="space-y-6">
        <Header range={range} />
        <EmptyState
          icon="chart-line"
          title={range === "max" ? "Not enough history yet" : "Not enough history in this range"}
          body={
            range === "max" ? (
              <>
                Trends need balances recorded in at least two months. Record what each account holds on{" "}
                <Link href="/accounts" className="text-accent-text hover:underline">
                  Accounts
                </Link>{" "}
                and this page fills in month by month.
              </>
            ) : (
              <>
                Trends need balances recorded in at least two months of the window.{" "}
                <Link href="/trends" className="text-accent-text hover:underline">
                  Show everything
                </Link>
                .
              </>
            )
          }
        />
      </div>
    );
  }

  // ---- Money in vs money out, from the transaction ledger ----
  // Held to the same window as the balances: the ledger reaches further back than the balance
  // record, but only in months whose import is partial — showing them would draw a collapse in
  // income that never happened.
  const windowStart = months[0].label;
  const flowBy = new Map<string, FlowMonth>();
  for (const r of cashflow) {
    if (r.label < windowStart || (currentLabel != null && r.label > currentLabel)) continue;
    const cur = flowBy.get(r.label) ?? { label: r.label, in: 0, out: 0 };
    const v = toNum(r.total) ?? 0;
    if (r.direction === "Credit") cur.in += v;
    else cur.out += v;
    flowBy.set(r.label, cur);
  }
  const flows = [...flowBy.values()].sort((a, b) => a.label.localeCompare(b.label));
  // The running month is only part-way through, so it can't be judged against finished ones.
  const partialLast = flows.length > 0 && flows[flows.length - 1].label === currentLabel;
  const doneFlows = partialLast ? flows.slice(0, -1) : flows;
  const total = flowTotals(flows);
  const avg = flowTotals(doneFlows);
  const cumulative = cumulativeNet(flows).map((p) => ({ label: shortMonthLabel(p.label), value: p.value }));

  // ---- Per-account history and per-category spend, over the same window ----
  const flowLabels = flows.map((f) => f.label);
  const [accountTrends, spendByMonth] = await Promise.all([
    getAccountBalanceTrends(months.map((t) => t.label)),
    Promise.all(flowLabels.map((l) => getCategorySpend(l))),
  ]);

  // ---- Headline numbers over the window ----
  const now = latest.value;
  const first = defined[0];
  const prev = defined[defined.length - 2];
  const netStats = seriesStats(net.slice(first.i))!;
  const cashSeries = months.map((t) => t.cash);
  const debtSeries = months.map((t) => (t.credit == null && t.loans == null ? null : (t.credit ?? 0) + (t.loans ?? 0)));
  const cashStats = seriesStats(cashSeries.map((v, i) => ({ label: labels[i], value: v })));
  const debtStats = seriesStats(debtSeries.map((v, i) => ({ label: labels[i], value: v })));
  const totalOwedNow = (latestMonth?.credit ?? 0) + (latestMonth?.loans ?? 0);
  const deltaTile = (from: { label: string; value: number }) => ({
    dir: (now - from.value > 0.5 ? "up" : now - from.value < -0.5 ? "down" : "flat") as "up" | "down" | "flat",
    label: `${now - from.value >= 0 ? "+" : "−"}${formatMoney(Math.abs(now - from.value))} vs ${from.label}`,
  });

  // ---- The explorer: every balance series on one switchable chart ----
  const explorer: MetricSeries[] = [
    { key: "net", name: "Net worth", noun: "net worth", color: now < 0 ? "var(--mp-money-owed)" : "var(--mp-accent)", goodWhen: "up", values: net.map((p) => p.value) },
    { key: "cash", name: "Cash on hand", noun: "cash", color: "var(--mp-money-income)", goodWhen: "up", values: cashSeries },
    ...(hasCredit || hasLoans ? [{ key: "debt", name: "Total owed", noun: "debt", color: "var(--mp-money-owed)", goodWhen: "down" as const, values: debtSeries }] : []),
    ...(hasCredit && hasLoans
      ? [
          { key: "cards", name: "Cards", noun: "card", color: "var(--mp-money-owed)", goodWhen: "down" as const, values: months.map((t) => t.credit) },
          { key: "loans", name: "Loans", noun: "loan", color: "var(--mp-money-pending)", goodWhen: "down" as const, values: months.map((t) => t.loans) },
        ]
      : []),
    ...(hasRetirement ? [{ key: "retirement", name: "Retirement", noun: "retirement", color: RETIREMENT_COLOR, goodWhen: "up" as const, values: months.map((t) => (t.retirement === 0 ? null : t.retirement)) }] : []),
    ...(hasAssets ? [{ key: "assets", name: "Assets", noun: "asset", color: ASSETS_COLOR, goodWhen: "up" as const, values: months.map((t) => (t.assets === 0 ? null : t.assets)) }] : []),
  ];

  // ---- Month-over-month change in net worth ----
  const deltas = net.map((p, i) => {
    const prevVal = i > 0 ? net[i - 1].value : null;
    return { label: p.label, value: p.value == null || prevVal == null ? null : p.value - prevVal };
  });
  const deltaSeries = deltas.slice(first.i + 1);
  const upMonths = deltaSeries.filter((d) => d.value != null && d.value > 0.5).length;
  const deltaCount = deltaSeries.filter((d) => d.value != null).length;

  // ---- What it's made of ----
  const compositionSeries = [
    { name: "Cash", color: "var(--mp-accent)", values: months.map((t) => t.cash ?? 0) },
    ...(hasRetirement ? [{ name: "Retirement", color: RETIREMENT_COLOR, values: months.map((t) => t.retirement) }] : []),
    ...(hasAssets ? [{ name: "Assets", color: ASSETS_COLOR, values: months.map((t) => t.assets) }] : []),
    ...(hasCredit ? [{ name: "Cards", color: "var(--mp-money-owed)", values: months.map((t) => t.credit ?? 0) }] : []),
    ...(hasLoans ? [{ name: "Loans", color: "var(--mp-money-pending)", values: months.map((t) => t.loans ?? 0) }] : []),
  ];

  // ---- Spending by category across the window ----
  const catMeta = new Map(catRows.map((c) => [c.name, c]));
  const spendMaps = spendByMonth.map((rows) => new Map(rows.map((r) => [r.category ?? "", toNum(r.total) ?? 0])));
  const catTotals = new Map<string, number>();
  for (const m of spendMaps) for (const [k, v] of m) catTotals.set(k, (catTotals.get(k) ?? 0) + v);
  const catGrand = [...catTotals.values()].reduce((s, v) => s + v, 0);
  const doneCount = partialLast ? flowLabels.length - 1 : flowLabels.length;
  const categories = [...catTotals.entries()]
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([key, totalSpent]) => {
      const values = spendMaps.map((m) => m.get(key) ?? 0);
      const finished = values.slice(0, doneCount);
      const avgMonth = finished.length ? finished.reduce((s, v) => s + v, 0) / finished.length : totalSpent;
      const lastDone = finished.length ? finished[finished.length - 1] : null;
      const meta = key ? catMeta.get(key) : undefined;
      return {
        key: key || "uncat",
        name: key || "Uncategorized",
        emoji: meta?.emoji ?? null,
        color: meta?.color ?? null,
        href: key ? `/transactions?category=${encodeURIComponent(key)}` : "/transactions?uncat=1",
        total: totalSpent,
        share: catGrand > 0 ? (totalSpent / catGrand) * 100 : 0,
        avgMonth,
        lastDone,
        vsAvg: lastDone != null && avgMonth > 0 && finished.length > 1 ? ((lastDone - avgMonth) / avgMonth) * 100 : null,
        // Finished months only — the running month always looks like a sudden drop.
        points: flowLabels.slice(0, doneCount >= 2 ? doneCount : flowLabels.length).map((l, i) => ({ label: shortMonthLabel(l), value: values[i] })),
      };
    });
  const lastDoneLabel = doneCount > 0 ? shortMonthLabel(flowLabels[doneCount - 1]) : null;

  // ---- Accounts: where each one started and ended in the window ----
  const accountRows = accountTrends
    .map((a) => {
      const st = seriesStats(a.values.map((v, i) => ({ label: labels[i], value: v })));
      const lastVal = [...a.values].reverse().find((v) => v != null) ?? null;
      const isDebt = a.accountType === "Credit" || a.accountType === "Loan";
      const group = CASH_ACCOUNT_TYPES.includes(a.accountType)
        ? "Cash"
        : isDebt
          ? "Owed"
          : RETIREMENT_ACCOUNT_TYPES.includes(a.accountType)
            ? "Retirement"
            : "Other";
      return { ...a, st, lastVal, isDebt, group };
    })
    // Closed accounts that sat at zero the whole window are noise.
    .filter((a) => a.lastVal != null && (a.active || a.values.some((v) => v != null && Math.abs(v) >= 0.5)))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || Math.abs(b.lastVal ?? 0) - Math.abs(a.lastVal ?? 0));

  // ---- Month by month ----
  const ledger = monthlyLedger(months, flows, comparableNet).reverse();

  const rangeText = `${first.label} – ${latest.label}`;
  const debtPaid = debtStats ? -debtStats.change : null;

  return (
    <div className="space-y-6">
      <Header range={range} />

      {/* ---- Headline ---- */}
      <Card>
        <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as React.CSSProperties}>
          <StatTile
            size="hero"
            label="Net worth"
            value={<Money value={now} kind={now < 0 ? "over" : "neutral"} />}
            delta={deltaTile(prev)}
            className="col-span-2"
            sub={
              <>
                Cash <Money value={latestMonth?.cash ?? 0} kind="neutral" />
                {(latestMonth?.retirement ?? 0) !== 0 && (
                  <>
                    {" "}
                    · Retirement <Money value={latestMonth!.retirement} kind="neutral" />
                  </>
                )}
                {(latestMonth?.assets ?? 0) !== 0 && (
                  <>
                    {" "}
                    · Assets <Money value={latestMonth!.assets} kind="neutral" />
                  </>
                )}
                {totalOwedNow > 0 && (
                  <>
                    {" "}
                    · Owed <Money value={totalOwedNow} kind="owed" />
                  </>
                )}
              </>
            }
          />
          <StatTile
            label={range === "max" ? "Since the start" : `Over ${rangeDef.long}`}
            value={<Money value={netStats.change} kind={netStats.change < 0 ? "over" : "income"} sign="always" />}
            sub={`since ${first.label}${netStats.changePct != null ? ` · ${pct(netStats.changePct)}` : ""}`}
          />
          <StatTile
            label="Average month"
            value={<Money value={netStats.perMonth} kind={netStats.perMonth < 0 ? "over" : "income"} sign="always" />}
            sub={deltaCount ? `${upMonths} of ${deltaCount} months up` : `over ${netStats.span} months`}
          />
        </div>
      </Card>

      {/* ---- The big picture: everything accumulated over the range ---- */}
      <Card title="The big picture" meta={rangeText}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          <BigStat label="Money in" value={<Money value={total.income} kind="income" />} sub={avg.months ? <>avg <Money value={avg.avgIncome} kind="neutral" /> / mo</> : undefined} />
          <BigStat label="Money out" value={<Money value={total.spending} kind="spend" />} sub={avg.months ? <>avg <Money value={avg.avgSpending} kind="neutral" /> / mo</> : undefined} />
          <BigStat
            label="Kept"
            value={<Money value={total.net} kind={total.net < 0 ? "over" : "income"} sign="always" />}
            sub={total.savingsRate != null ? `${rate(total.savingsRate)} of what came in` : undefined}
          />
          <BigStat
            label="Positive months"
            value={avg.months ? `${avg.positiveMonths} of ${avg.months}` : "—"}
            sub={avg.months ? <>avg kept <Money value={avg.avgNet} kind={avg.avgNet < 0 ? "over" : "income"} sign="always" /> / mo</> : "no finished months yet"}
          />
          <BigStat
            label="Cash on hand"
            value={<Money value={cashStats?.last.value ?? latestMonth?.cash ?? 0} kind="neutral" />}
            sub={cashStats ? <><Money value={cashStats.change} kind={cashStats.change < 0 ? "over" : "income"} sign="always" /> since {cashStats.first.label}</> : undefined}
          />
          <BigStat
            label="Cash range"
            value={cashStats ? <><Money value={cashStats.low.value} kind="neutral" whole /> – <Money value={cashStats.high.value} kind="neutral" whole /></> : "—"}
            sub={cashStats ? `low ${cashStats.low.label} · high ${cashStats.high.label}` : undefined}
          />
          {debtStats && (
            <BigStat
              label="Owed now"
              value={<Money value={debtStats.last.value} kind="owed" />}
              sub={debtStats ? `peak ${formatMoney(debtStats.high.value)} in ${debtStats.high.label}` : undefined}
            />
          )}
          {debtPaid != null && (
            <BigStat
              label={debtPaid >= 0 ? "Debt paid down" : "Debt added"}
              value={<Money value={Math.abs(debtPaid)} kind={debtPaid >= 0 ? "income" : "over"} />}
              sub={`since ${debtStats!.first.label}${debtStats!.changePct != null ? ` · ${Math.abs(debtStats!.changePct).toFixed(0)}% ${debtPaid >= 0 ? "lower" : "higher"}` : ""}`}
            />
          )}
        </div>
        {partialLast && (
          <p className="mt-4 text-xs text-fg-3">
            Totals include {shortMonthLabel(currentLabel!)} so far; monthly averages use finished months only.
          </p>
        )}
      </Card>

      {/* ---- Any balance over time ---- */}
      <Card title="Balances over time" meta="as of each month's end">
        <MetricExplorer labels={labels} series={explorer} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Net worth, month over month"
          meta={
            netStats.bestMove && netStats.worstMove && deltaCount > 1 ? (
              <>
                best {netStats.bestMove.label} <Money value={netStats.bestMove.value} kind="income" sign="always" /> · worst {netStats.worstMove.label}{" "}
                <Money value={netStats.worstMove.value} kind={netStats.worstMove.value < 0 ? "over" : "income"} sign="always" />
              </>
            ) : undefined
          }
        >
          <DeltaBars points={deltaSeries} />
        </Card>

        <Card title="What it's made of" meta="cash and holdings vs what's owed">
          <BarsChart labels={labels} series={compositionSeries} valueFormat="money" />
        </Card>
      </div>

      {flows.length > 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Money in vs money out" meta={avg.months ? `${avg.positiveMonths} of ${avg.months} finished months took in more` : undefined}>
            <BarsChart
              labels={flows.map((f) => shortMonthLabel(f.label))}
              series={[
                { name: "In", color: "var(--mp-money-income)", values: flows.map((f) => f.in) },
                { name: "Out", color: "var(--mp-money-spend)", values: flows.map((f) => f.out) },
              ]}
              valueFormat="money"
            />
          </Card>
          <Card title="Kept, accumulated" meta="running total of in − out">
            <TrendLineChart
              points={cumulative}
              height={170}
              color={total.net < 0 ? "var(--mp-money-over)" : "var(--mp-money-income)"}
              label="Running total of money kept"
            />
          </Card>
        </div>
      )}
      {flows.length > 1 && (
        <p className="-mt-3 text-xs text-fg-3">
          Money in and out come from the transaction ledger, transfers excluded — what moved through the accounts, not the change in net
          worth. Paying a card down is money out here but leaves net worth where it was.
          {partialLast && ` ${shortMonthLabel(currentLabel!)} is still in progress.`}
        </p>
      )}

      {/* ---- Where it went ---- */}
      {categories.length > 0 && (
        <Card title="Spending by category" meta={`${formatMoney(catGrand)} across ${flowLabels.length} month${flowLabels.length === 1 ? "" : "s"}`} padded={false}>
          <div className="overflow-x-auto">
            <table className="mp-table mp-table--dense">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="hidden sm:table-cell">Trend</th>
                  <th className="is-right">Total</th>
                  <th className="is-right">Share</th>
                  <th className="is-right">Avg / mo</th>
                  {lastDoneLabel && <th className="is-right">{lastDoneLabel}</th>}
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <Link href={c.href} className="flex min-w-0 items-center gap-2 hover:underline">
                        <Glyph color={c.color} size="sm" icon={c.emoji ? undefined : "tag"}>
                          {c.emoji ? <span className="text-xs leading-none">{c.emoji}</span> : null}
                        </Glyph>
                        <span className="truncate">{c.name}</span>
                      </Link>
                    </td>
                    <td className="hidden w-32 sm:table-cell">
                      <Sparkline points={c.points} color={c.color || "var(--mp-money-plan)"} />
                    </td>
                    <td className="is-num">
                      <Money value={c.total} kind="neutral" />
                    </td>
                    <td className="is-num text-fg-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-sunken md:inline-block">
                          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, c.share)}%`, backgroundColor: c.color || "var(--mp-money-plan)" }} />
                        </span>
                        {c.share.toFixed(0)}%
                      </span>
                    </td>
                    <td className="is-num">
                      <Money value={c.avgMonth} kind="neutral" />
                    </td>
                    {lastDoneLabel && (
                      <td className="is-num">
                        {c.lastDone != null ? <Money value={c.lastDone} kind="neutral" /> : "—"}
                        {c.vsAvg != null && Math.abs(c.vsAvg) >= 10 && (
                          <span className={`ml-1.5 text-xs ${c.vsAvg > 0 ? "text-over" : "text-income"}`}>
                            {c.vsAvg > 0 ? "+" : "−"}
                            {Math.abs(c.vsAvg).toFixed(0)}%
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---- Accounts ---- */}
      {accountRows.length > 0 && (
        <Card title="Accounts" meta={rangeText} padded={false}>
          <div className="overflow-x-auto">
            <table className="mp-table mp-table--dense">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="hidden sm:table-cell">Trend</th>
                  <th className="is-right">Start</th>
                  <th className="is-right">Now</th>
                  <th className="is-right">Change</th>
                  <th className="is-right hidden md:table-cell">Low – high</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((a, i) => (
                  <AccountRow key={a.id} a={a} labels={labels} groupStart={i === 0 || accountRows[i - 1].group !== a.group} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---- Month by month ---- */}
      <Card title="Month by month" meta="newest first" padded={false}>
        <div className="overflow-x-auto">
          <table className="mp-table mp-table--dense">
            <thead>
              <tr>
                <th>Month</th>
                <th className="is-right">In</th>
                <th className="is-right">Out</th>
                <th className="is-right">Kept</th>
                <th className="is-right">Rate</th>
                <th className="is-right">Cash</th>
                {(hasCredit || hasLoans) && <th className="is-right">Owed</th>}
                <th className="is-right">Net worth</th>
                <th className="is-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.label}>
                  <td className="whitespace-nowrap">
                    {shortMonthLabel(r.label)}
                    {r.label === currentLabel && <span className="ml-1.5 text-xs text-fg-3">so far</span>}
                  </td>
                  <td className="is-num">{r.income != null ? <Money value={r.income} kind="income" /> : "—"}</td>
                  <td className="is-num">{r.spending != null ? <Money value={r.spending} kind="neutral" /> : "—"}</td>
                  <td className="is-num">{r.net != null ? <Money value={r.net} kind={r.net < 0 ? "over" : "income"} sign="always" /> : "—"}</td>
                  <td className="is-num text-fg-3">{r.savingsRate != null ? rate(r.savingsRate) : "—"}</td>
                  <td className="is-num">{r.cash != null ? <Money value={r.cash} kind="neutral" /> : "—"}</td>
                  {(hasCredit || hasLoans) && <td className="is-num">{r.debt != null ? <Money value={r.debt} kind="owed" /> : "—"}</td>}
                  <td className="is-num">{r.netWorth != null ? <Money value={r.netWorth} kind={r.netWorth < 0 ? "over" : "neutral"} /> : "—"}</td>
                  <td className="is-num">
                    {r.netWorthChange != null ? <Money value={r.netWorthChange} kind={r.netWorthChange < 0 ? "over" : "income"} sign="always" /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {flows.length > 1 && (
              <tfoot>
                <tr className="font-medium">
                  <td className="border-t border-line-2">Total</td>
                  <td className="is-num border-t border-line-2">
                    <Money value={total.income} kind="income" />
                  </td>
                  <td className="is-num border-t border-line-2">
                    <Money value={total.spending} kind="neutral" />
                  </td>
                  <td className="is-num border-t border-line-2">
                    <Money value={total.net} kind={total.net < 0 ? "over" : "income"} sign="always" />
                  </td>
                  <td className="is-num border-t border-line-2 text-fg-3">{total.savingsRate != null ? rate(total.savingsRate) : "—"}</td>
                  <td className="border-t border-line-2" colSpan={(hasCredit || hasLoans ? 2 : 1) + 1} />
                  <td className="is-num border-t border-line-2">
                    <Money value={netStats.change} kind={netStats.change < 0 ? "over" : "income"} sign="always" />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

const GROUP_ORDER = ["Cash", "Owed", "Retirement", "Other"];

function AccountRow({
  a,
  labels,
  groupStart,
}: {
  a: { id: number; label: string; institution: string | null; group: string; isDebt: boolean; values: (number | null)[]; lastVal: number | null; st: ReturnType<typeof seriesStats> };
  labels: string[];
  groupStart: boolean;
}) {
  const ch = a.st?.change ?? null;
  const good = ch == null || Math.abs(ch) < 0.5 ? "neutral" : (ch > 0) !== a.isDebt ? "income" : "over";
  return (
    <>
      {groupStart && (
        <tr>
          <td colSpan={6} className="bg-sunken !py-1.5 text-xs font-medium text-fg-3">
            {a.group}
          </td>
        </tr>
      )}
      <tr>
        <td>
          <div className="min-w-0">
            <div className="truncate">{a.label}</div>
            {a.institution && <div className="truncate text-xs text-fg-3">{a.institution}</div>}
          </div>
        </td>
        <td className="hidden w-32 sm:table-cell">
          <Sparkline points={a.values.map((v, i) => ({ label: labels[i], value: v }))} color={a.isDebt ? "var(--mp-money-owed)" : "var(--mp-accent)"} />
        </td>
        <td className="is-num text-fg-2">{a.st ? <Money value={a.st.first.value} kind="neutral" /> : "—"}</td>
        <td className="is-num">
          <Money value={a.lastVal} kind={a.isDebt ? "owed" : "neutral"} />
        </td>
        <td className="is-num">{ch != null ? <Money value={ch} kind={good} sign="always" /> : "—"}</td>
        <td className="is-num hidden text-fg-3 md:table-cell">
          {a.st ? (
            <>
              <Money value={a.st.low.value} kind="neutral" whole /> – <Money value={a.st.high.value} kind="neutral" whole />
            </>
          ) : (
            "—"
          )}
        </td>
      </tr>
    </>
  );
}

function BigStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-fg-3">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-fg-3">{sub}</div>}
    </div>
  );
}

const pct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p) >= 100 ? Math.abs(p).toFixed(0) : Math.abs(p).toFixed(1)}%`;

/** Savings rate as a whole percent, with a real minus and no "-0%". */
const rate = (p: number) => {
  const r = Math.round(p);
  return r < 0 ? `−${-r}%` : `${r}%`;
};

function Header({ range }: { range: Range }) {
  return (
    <PageHeader
      title="Trends"
      actions={
        <nav className="mp-seg" aria-label="Time range">
          {RANGES.map((r) => (
            <Link key={r.value} href={r.value === DEFAULT_RANGE ? "/trends" : `/trends?range=${r.value}`} aria-current={r.value === range ? "true" : undefined} scroll={false}>
              {r.label}
            </Link>
          ))}
        </nav>
      }
      description={
        <>
          The bigger picture across every month on record — balances, what came in and went out, and where it went. The range applies to
          everything below. Balances are the snapshots recorded on{" "}
          <Link href="/accounts" className="text-accent-text hover:underline">
            Accounts
          </Link>
          .
        </>
      }
    />
  );
}

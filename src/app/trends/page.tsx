import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { BarsChart } from "@/components/charts/BarsChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { DeltaBars } from "@/components/charts/DeltaBars";
import { Card, EmptyState, Money, PageHeader, StatTile } from "@/components/ds";
import { getBalanceTrends, getCashflowByPeriod } from "@/server/queries";
import { formatMoney, toNum } from "@/server/lib/money";
import { currentPeriodLabel, shortMonthLabel } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trends" };

// The window the charts cover, as ?range=. Max is everything since the record began.
const RANGES = [
  { value: "3m", label: "3M", months: 3 },
  { value: "6m", label: "6M", months: 6 },
  { value: "1y", label: "1Y", months: 12 },
  { value: "2y", label: "2Y", months: 24 },
  { value: "max", label: "Max", months: null },
] as const;
type Range = (typeof RANGES)[number]["value"];
const DEFAULT_RANGE: Range = "max";

/** "2026-11" minus n months → "2026-08"-style label (n − 1 back, so the window holds n months). */
function windowStartLabel(current: string, months: number): string {
  const [y, m] = current.split("-").map(Number);
  const idx = y * 12 + (m - 1) - (months - 1);
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range: Range = RANGES.some((r) => r.value === sp.range) ? (sp.range as Range) : DEFAULT_RANGE;
  const rangeMonths = RANGES.find((r) => r.value === range)!.months;
  let balanceTrends, cashflow;
  try {
    [balanceTrends, cashflow] = await Promise.all([getBalanceTrends(), getCashflowByPeriod()]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  // Months after today would just repeat the latest snapshots, so the record stops at "now".
  const currentLabel = currentPeriodLabel(todayIso());
  const tracked = balanceTrends.filter((t) => currentLabel == null || t.label <= currentLabel);
  // Months exist as periods long before any balance was recorded in them, and an axis that opens
  // with a year of blank months squeezes the part that has data into a corner — so it starts
  // where the record actually starts.
  const opened = tracked.findIndex((t) => t.cash != null || t.credit != null || t.loans != null);
  const recorded = opened < 0 ? [] : tracked.slice(opened);
  // The range toggle trims the window to its last N months (Max keeps the whole record).
  const lastLabel = currentLabel ?? recorded[recorded.length - 1]?.label;
  const cutoff = rangeMonths != null && lastLabel ? windowStartLabel(lastLabel, rangeMonths) : null;
  const months = cutoff ? recorded.filter((t) => t.label >= cutoff) : recorded;

  // Same guard as the dashboard: a month only counts once every kind of balance it's made of has
  // been recorded, so the months before debts were tracked don't read as a small positive net
  // worth that "crashes" when the cards first show up.
  const hasCredit = months.some((t) => t.credit != null);
  const hasLoans = months.some((t) => t.loans != null);
  const net = months.map((t) => ({
    label: shortMonthLabel(t.label),
    value:
      t.cash == null || (hasCredit && t.credit == null) || (hasLoans && t.loans == null)
        ? null
        : t.cash - (t.credit ?? 0) - (t.loans ?? 0),
  }));

  const defined = net.flatMap((p, i) => (p.value == null ? [] : [{ ...p, value: p.value, i }]));
  const latest = defined[defined.length - 1];
  const latestMonth = latest ? months[latest.i] : null;

  if (defined.length < 2 && range !== "max") {
    return (
      <div className="space-y-6">
        <Header range={range} />
        <EmptyState
          icon="chart-line"
          title="Not enough history in this range"
          body={
            <>
              Trends need balances recorded in at least two months of the window.{" "}
              <Link href="/trends?range=max" className="text-accent-text hover:underline">
                Show everything
              </Link>
              .
            </>
          }
        />
      </div>
    );
  }

  if (defined.length < 2) {
    return (
      <div className="space-y-6">
        <Header range={range} />
        <EmptyState
          icon="chart-line"
          title="Not enough history yet"
          body={
            <>
              Trends need balances recorded in at least two months. Record what each account holds on{" "}
              <Link href="/accounts" className="text-accent-text hover:underline">
                Accounts
              </Link>{" "}
              and this page fills in month by month.
            </>
          }
        />
      </div>
    );
  }

  // ---- Headline numbers ----
  const now = latest.value;
  const prev = defined[defined.length - 2];
  const back3 = defined.length > 3 ? defined[defined.length - 4] : null; // 3 months of change
  const first = defined[0];
  const monthsSpanned = Math.max(1, latest.i - first.i);
  const avgChange = (now - first.value) / monthsSpanned;

  const deltaTile = (from: { label: string; value: number }) => ({
    dir: (now - from.value > 0.5 ? "up" : now - from.value < -0.5 ? "down" : "flat") as "up" | "down" | "flat",
    label: `${now - from.value >= 0 ? "+" : "−"}${formatMoney(Math.abs(now - from.value))} vs ${from.label}`,
  });

  // ---- Month-over-month change (consecutive recorded months only) ----
  const deltas = net.map((p, i) => {
    const prevVal = i > 0 ? net[i - 1].value : null;
    return { label: p.label, value: p.value == null || prevVal == null ? null : p.value - prevVal };
  });
  // Cash is recorded from further back than the cards and loans are, so net worth begins later
  // than the balance record does. These two charts start at their own first value; the
  // composition chart below keeps the cash-only months, which it can honestly show.
  const netSeries = net.slice(first.i);
  const deltaSeries = deltas.slice(first.i + 1);
  const definedDeltas = deltas.filter((d) => d.value != null) as { label: string; value: number }[];
  const best = definedDeltas.reduce((a, b) => (b.value > a.value ? b : a), definedDeltas[0]);
  const worst = definedDeltas.reduce((a, b) => (b.value < a.value ? b : a), definedDeltas[0]);

  // ---- What it's made of: cash against everything owed ----
  const compositionSeries = [
    { name: "Cash", color: "var(--mp-accent)", values: months.map((t) => t.cash ?? 0) },
    ...(hasCredit ? [{ name: "Cards", color: "var(--mp-money-owed)", values: months.map((t) => t.credit ?? 0) }] : []),
    ...(hasLoans ? [{ name: "Loans", color: "var(--mp-money-pending)", values: months.map((t) => t.loans ?? 0) }] : []),
  ];

  // ---- Money in vs money out, from the transaction ledger ----
  // Held to the same window as the charts above: the ledger reaches further back than the balance
  // record, but only in months whose import is partial — showing them would draw a collapse in
  // income that never happened.
  const windowStart = months[0].label;
  const flowBy = new Map<string, { in: number; out: number }>();
  for (const r of cashflow) {
    if (r.label < windowStart || (currentLabel != null && r.label > currentLabel)) continue;
    const cur = flowBy.get(r.label) ?? { in: 0, out: 0 };
    const v = toNum(r.total) ?? 0;
    if (r.direction === "Credit") cur.in += v;
    else cur.out += v;
    flowBy.set(r.label, cur);
  }
  const flowLabels = [...flowBy.keys()].sort();
  const flows = flowLabels.map((l) => flowBy.get(l)!);
  // The running month is only part-way through, so it can't be judged against finished ones.
  const partialLast = flowLabels[flowLabels.length - 1] === currentLabel;
  const doneFlows = partialLast ? flows.slice(0, -1) : flows;
  const inBlack = doneFlows.filter((f) => f.in > f.out).length;

  const totalOwedNow = (latestMonth?.credit ?? 0) + (latestMonth?.loans ?? 0);

  return (
    <div className="space-y-6">
      <Header range={range} />

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
            label="Last 3 months"
            value={back3 ? <Money value={now - back3.value} kind={now - back3.value < 0 ? "over" : "income"} sign="always" /> : "—"}
            sub={back3 ? `since ${back3.label}` : "needs 4 months of history"}
          />
          <StatTile
            label="Average month"
            value={<Money value={avgChange} kind={avgChange < 0 ? "over" : "income"} sign="always" />}
            sub={`since ${first.label}`}
          />
        </div>
      </Card>

      <Card title="Net worth over time" meta={`${first.label} – ${latest.label}`}>
        <TrendLineChart points={netSeries} />
      </Card>

      <Card
        title="Month over month"
        meta={
          definedDeltas.length > 1 ? (
            <>
              best {best.label} <Money value={best.value} kind="income" sign="always" /> · worst {worst.label}{" "}
              <Money value={worst.value} kind={worst.value < 0 ? "over" : "income"} sign="always" />
            </>
          ) : undefined
        }
      >
        <DeltaBars points={deltaSeries} />
      </Card>

      <Card title="Cash vs what's owed" meta="as of each month's end">
        <BarsChart labels={months.map((t) => shortMonthLabel(t.label))} series={compositionSeries} valueFormat="money" />
      </Card>

      {flowLabels.length > 1 && (
        <Card
          title="Money in vs money out"
          meta={doneFlows.length ? `${inBlack} of ${doneFlows.length} finished months took in more than went out` : undefined}
        >
          <BarsChart
            labels={flowLabels.map(shortMonthLabel)}
            series={[
              { name: "In", color: "var(--mp-money-income)", values: flows.map((f) => f.in) },
              { name: "Out", color: "var(--mp-money-spend)", values: flows.map((f) => f.out) },
            ]}
            valueFormat="money"
          />
          <p className="mt-3 text-xs text-fg-3">
            From the transaction ledger, transfers excluded. This is what moved through the accounts, not the change in net worth
            above — paying a card down is money out here but leaves net worth where it was.
            {partialLast && ` ${shortMonthLabel(currentLabel!)} is still in progress.`}
          </p>
        </Card>
      )}
    </div>
  );
}

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
          Net worth month by month — whether the plan is working, and what moved it. Balances are the snapshots recorded on{" "}
          <Link href="/accounts" className="text-accent-text hover:underline">
            Accounts
          </Link>
          .
        </>
      }
    />
  );
}

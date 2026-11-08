import Link from "next/link";
import { Card, Money, Notice, StatTile } from "@/components/ds";
import { CashLineChart, type CashLineDay } from "@/components/charts/CashLineChart";
import { formatMoney } from "@/server/lib/money";
import { round2 } from "@/server/lib/budget";
import { monthBounds, parsePeriodLabel, shortMonthLabel } from "@/server/lib/period";
import type { CashProjection } from "@/server/lib/cash-projection";
import type { BudgetLineRow, BudgetView, DailyCashPoint } from "@/server/queries";
import { dayLabel } from "./kit";

const monthName = (label: string) => shortMonthLabel(label).replace(/ '\d\d$/, "");
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "Cash through November": the dashboard's forward look. Three small landmarks (end of this month
 * vs plan, the lowest day ahead, end of next month), then the cash line — recorded so far joined to
 * the projection, against the month as budgeted. Everything the old full-width cash widget said
 * beyond that (missed paydays, money outside the plan, the plan/pace reading, the dated list of
 * what's coming) is kept, but folded below the chart so the card reads at a glance.
 *
 * On a finished month there's no projection; the card falls back to the ledger's line with month
 * start / lowest / month end.
 */
export function CashChartCard({
  daily,
  projection: p,
  periodLabel,
  lines = [],
  unplanned,
  today,
}: {
  daily: DailyCashPoint[];
  projection: CashProjection | null;
  periodLabel: string;
  lines?: BudgetLineRow[];
  unplanned?: BudgetView["unplannedSpend"];
  today: string;
}) {
  const parsed = parsePeriodLabel(periodLabel);
  if (!parsed) return null;
  const { start, end } = monthBounds(parsed.year, parsed.month);
  const projecting = !!p && p.spreadDays > 0;
  const first = daily[0] ?? null;
  const last = daily[daily.length - 1] ?? null;

  if (!first && !projecting) {
    return (
      <Card title="Cash this month">
        <p className="text-sm text-fg-2">
          Record a cash balance on{" "}
          <Link href="/accounts" className="text-accent-text hover:underline">
            Accounts
          </Link>{" "}
          and the month&apos;s cash line appears here.
        </p>
      </Card>
    );
  }

  const nextMonth = projecting ? (p.months[1] ?? null) : null;
  const horizonEnd = projecting ? p.horizonEnd : end;
  const plan = projecting ? (p.plan ?? null) : null;
  const monthStart = first?.total ?? p?.monthStart ?? null;

  // ---- The line: ledger days, then projected days after the last recorded one ----
  const eventsOn = new Map<string, string[]>();
  for (const e of projecting ? p.events : []) {
    const s = `${e.label} ${e.amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(e.amount))}`;
    eventsOn.set(e.date, [...(eventsOn.get(e.date) ?? []), s]);
  }
  const actual: CashLineDay[] = daily.map((d) => ({ date: d.date, balance: d.total, kind: "actual", recorded: d.recorded }));
  const seed: CashLineDay[] =
    !actual.length && projecting ? [{ date: p.asOf < start ? start : p.asOf, balance: p.start, kind: "actual", recorded: false }] : [];
  const lastActual = (actual[actual.length - 1] ?? seed[0])?.date ?? null;
  const projected: CashLineDay[] = projecting
    ? p.days
        .filter((d) => d.date >= start && d.date <= horizonEnd && (lastActual == null || d.date > lastActual))
        .map((d) => ({
          date: d.date,
          balance: d.balance,
          kind: "projected",
          note: [...(eventsOn.get(d.date) ?? []), ...(d.spread > 0 ? [`everyday −${formatMoney(d.spread)}`] : [])].join(" · ") || undefined,
        }))
    : [];
  const days = [...seed, ...actual, ...projected];
  const planPts = plan ? [{ date: start, balance: plan.start }, ...plan.days].filter((d) => d.date >= start && d.date <= horizonEnd) : [];

  // ---- Landmarks ----
  const lowSoFar = daily.reduce<DailyCashPoint | null>((m, d) => (!m || d.total < m.total ? d : m), null);
  const lowAhead = projecting && p.low.date > (last?.date ?? start) ? p.low : null;
  const lowMarker = lowAhead ?? (lowSoFar ? { date: lowSoFar.date, balance: lowSoFar.total } : null);
  const endVsPlan = projecting && plan ? round2(p.endBalance - plan.endBalance) : null;
  const planToday = plan && last ? (plan.days.find((d) => d.date === last.date)?.balance ?? null) : null;
  const vsPlan = planToday != null && last ? round2(last.total - planToday) : null;

  // ---- What used to sit beside the chart, kept below it ----
  const missedPaydays = projecting ? p.paydays.filter((m) => !m.complete && m.date < today) : [];
  const focusMonth = projecting ? p.months[p.focusIndex] : null;
  const unplannedTotal = unplanned?.total ?? 0;
  const savingsLines = lines.filter((l) => l.kind === "savings");
  const savingsPlanned = savingsLines.reduce((s, l) => s + l.planned, 0);
  const savingsActual = savingsLines.reduce((s, l) => s + l.actual, 0);
  const savingsShort = round2(savingsPlanned - savingsActual);
  const spendLines = lines.filter((l) => l.kind === "category");
  const spendPlanned = spendLines.reduce((s, l) => s + l.planned, 0);
  const spendActual = spendLines.reduce((s, l) => s + l.actual, 0);
  const dim = Number(end.slice(8, 10));
  const anchor = today >= start && today <= end ? today : (last?.date ?? null);
  const elapsed = anchor ? Number(anchor.slice(8, 10)) : 0;
  const expected = spendPlanned > 0 && elapsed > 0 ? (spendPlanned * elapsed) / dim : null;
  const paceDelta = expected != null ? spendActual - expected : null;
  const paychecks = projecting ? p.events.filter((e) => e.kind === "paycheck") : [];
  const outgoing = projecting ? p.events.filter((e) => e.kind !== "paycheck") : [];

  const throughLabel = nextMonth ? MONTH_FULL[Number(nextMonth.label.slice(5, 7)) - 1] : MONTH_FULL[parsed.month - 1];

  return (
    <Card
      title={`Cash through ${throughLabel}`}
      meta={plan ? "vs plan" : undefined}
      action={
        <span className="flex items-center gap-3 text-xs text-fg-3">
          <span className="flex items-center gap-1">
            <i className="inline-block h-0.5 w-3.5 bg-accent" />
            cash
          </span>
          {planPts.length > 1 && (
            <span className="flex items-center gap-1">
              <i className="inline-block h-0.5 w-3.5 bg-plan opacity-60" />
              plan
            </span>
          )}
        </span>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {projecting ? (
          <>
            <StatTile
              size="sm"
              label={`End of ${monthName(periodLabel)}`}
              value={p.endBalance}
              kind={p.endBalance < 0 ? "over" : "neutral"}
              sub={
                endVsPlan != null ? (
                  Math.abs(endVsPlan) <= 1 ? (
                    "on plan"
                  ) : (
                    <>
                      <Money value={endVsPlan} kind={endVsPlan < 0 ? "over" : "income"} sign="always" /> vs plan
                    </>
                  )
                ) : monthStart != null ? (
                  <>
                    <Money value={p.endBalance - monthStart} sign="always" kind={p.endBalance - monthStart < 0 ? "over" : "income"} /> vs start
                  </>
                ) : undefined
              }
            />
            <StatTile size="sm" label="Lowest ahead" value={p.low.balance} kind={p.low.balance < 0 ? "over" : "plan"} sub={dayLabel(p.low.date)} />
            {nextMonth && (
              <StatTile
                size="sm"
                label={`End of ${monthName(nextMonth.label)}`}
                value={nextMonth.endBalance}
                kind={nextMonth.endBalance < 0 ? "over" : "neutral"}
                sub={nextMonth.assumed ? "on this month's plan" : "on its own budget"}
                className="max-sm:hidden"
              />
            )}
          </>
        ) : (
          <>
            <StatTile size="sm" label="Month start" value={monthStart ?? 0} sub={first ? dayLabel(first.date) : undefined} />
            {lowSoFar && <StatTile size="sm" label="Lowest" value={lowSoFar.total} kind={lowSoFar.total < 0 ? "over" : "plan"} sub={dayLabel(lowSoFar.date)} />}
            {last && (
              <StatTile
                size="sm"
                label={last.date >= end ? `End of ${monthName(periodLabel)}` : "Latest"}
                value={last.total}
                sub={monthStart != null ? <><Money value={last.total - monthStart} sign="always" kind={last.total - monthStart < 0 ? "over" : "income"} /> vs start</> : undefined}
                className="max-sm:hidden"
              />
            )}
          </>
        )}
      </div>

      <CashLineChart days={days} plan={planPts} low={lowMarker} start={start} end={horizonEnd} />

      {missedPaydays.length > 0 || (focusMonth?.unexpectedIncome ?? 0) > 0 ? (
        <Notice tone="warn" className="mt-4">
          {missedPaydays.map((m) => (
            <p key={m.date}>
              The {dayLabel(m.date)} payday shows {formatMoney(m.arrived)} of {formatMoney(m.expected)} arrived, so {formatMoney(m.residual)} isn&apos;t
              counted ahead. If it did land, its description doesn&apos;t match the payroll pattern on{" "}
              <Link href="/settings/pay-schedule" className="underline">
                Pay schedule
              </Link>
              .
            </p>
          ))}
          {(focusMonth?.unexpectedIncome ?? 0) > 0 && (
            <p>
              {formatMoney(focusMonth!.unexpectedIncome)} of income this month matched no payday — a refund or bonus if that&apos;s expected,
              otherwise payroll the pattern is missing.
            </p>
          )}
        </Notice>
      ) : null}

      {projecting && (
        <details className="group mt-4 text-sm">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg">
            <span className="inline-block text-[10px] transition-transform group-open:rotate-90">▶</span>
            How the plan is tracking
          </summary>
          <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-fg-2">
            <p>
              {plan && vsPlan != null && planToday != null && last ? (
                <>
                  On budget you&apos;d have {formatMoney(planToday)} on {dayLabel(last.date)}; you have {formatMoney(last.total)} —{" "}
                  <strong className={vsPlan >= 0 ? "text-income" : "text-over"}>
                    {Math.abs(vsPlan) <= 1 ? "right on plan" : `${formatMoney(Math.abs(vsPlan))} ${vsPlan > 0 ? "above" : "below"} plan`}
                  </strong>
                  . The budget ends {monthName(periodLabel)} at {formatMoney(plan.endBalance)}.
                  {vsPlan < -1 && " A bill paid before its due day counts against this until that day."}
                </>
              ) : (
                <>Record a balance from before {monthName(periodLabel)} began and this compares today against the budget.</>
              )}
            </p>
            <p>
              {expected != null && paceDelta != null ? (
                <>
                  {formatMoney(spendActual)} spent by day {elapsed}; on plan you&apos;d be at {formatMoney(expected)} —{" "}
                  <strong className={paceDelta > 1 ? "text-over" : "text-income"}>
                    {paceDelta > 1 ? `${formatMoney(paceDelta)} ahead of pace` : paceDelta < -1 ? `${formatMoney(-paceDelta)} under pace` : "right on pace"}
                  </strong>
                  .
                  {(focusMonth?.overspend ?? 0) > 0 && (
                    <> {formatMoney(focusMonth!.overspend)} of that is over-plan on individual envelopes, credited against what&apos;s left.</>
                  )}
                </>
              ) : (
                <>No everyday envelopes to pace against.</>
              )}
            </p>
            {Math.abs(p.envelope.endBalance - p.endBalance) > 1 && (
              <p>
                Spend the whole budget instead of at your pace and {monthName(periodLabel)} ends at {formatMoney(p.envelope.endBalance)}.
              </p>
            )}
            {(focusMonth?.unbudgetedBillTotal ?? 0) > 0 && (
              <p>
                <strong>{formatMoney(focusMonth!.unbudgetedBillTotal)}</strong> of bills draw from no budget envelope (
                {focusMonth!.unbudgetedBills
                  .slice(0, 4)
                  .map((b) => `${b.name} ${formatMoney(b.amount)}`)
                  .join(", ")}
                {focusMonth!.unbudgetedBills.length > 4 && `, +${focusMonth!.unbudgetedBills.length - 4} more`}). Each is counted on its due day and
                again in whatever envelope spreads it — set the bill&apos;s envelope in Settings → Bills to net them.
              </p>
            )}
            {unplannedTotal > 0 && (
              <p>
                <strong>{formatMoney(unplannedTotal)}</strong> spent in categories with no budget line (
                {unplanned!.categories
                  .slice(0, 4)
                  .map((c) => `${c.category ?? "uncategorized"} ${formatMoney(c.amount)}`)
                  .join(", ")}
                {unplanned!.categories.length > 4 && `, +${unplanned!.categories.length - 4} more`}). The projection only spreads what a line planned, so this
                comes straight off month-end.
              </p>
            )}
            {savingsShort > 0.5 && (
              <p>
                Savings is {formatMoney(savingsActual)} of {formatMoney(savingsPlanned)} funded — <strong className="text-warn">{formatMoney(savingsShort)}</strong>{" "}
                short. Month-end cash above still counts that as spendable.
              </p>
            )}
          </div>
        </details>
      )}

      {projecting && (
        <details className="group mt-2 text-sm">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg">
            <span className="inline-block text-[10px] transition-transform group-open:rotate-90">▶</span>
            What&apos;s coming — {paychecks.length} paycheck{paychecks.length === 1 ? "" : "s"}, {outgoing.length} payment{outgoing.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
            <ul className="space-y-1">
              {paychecks.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-fg-3">{dayLabel(e.date)}</span> {e.label}
                  </span>
                  <Money value={e.amount} />
                </li>
              ))}
              {paychecks.length === 0 && <li className="text-fg-3">No paydays left on the horizon.</li>}
            </ul>
            <ul className="space-y-1">
              {outgoing.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-fg-3">{dayLabel(e.date)}</span> {e.label}
                    {e.overdue && <span className="ml-1 text-over">· past due</span>}
                  </span>
                  <Money value={e.amount} className="shrink-0" />
                </li>
              ))}
              {p.months.map(
                (m) =>
                  m.spreadTotal > 0 && (
                    <li key={m.label} className="flex justify-between gap-2 text-fg-3">
                      <span>
                        Everyday, {monthName(m.label)} · ~{formatMoney(m.spreadDaily)}/day
                        {m.pacedFromHistory && m.paceWeight >= 1 ? " · your pace" : m.pacedFromHistory ? " · pace, blended with the plan" : " · the plan"}
                      </span>
                      <Money value={-m.spreadTotal} kind="muted" className="shrink-0" />
                    </li>
                  ),
              )}
            </ul>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-fg-3">
            Solid line: the balance ledger day by day. Dashed: the projection from {dayLabel(p.asOf)} — unpaid bills leave on their due day, debt
            payments are what the plan still owes, everyday spending drains at the pace this month has run. The thin sky line is the month exactly as
            budgeted; it holds still, so the gap to the cash line is how far above or below plan you are.
          </p>
        </details>
      )}
    </Card>
  );
}

import Link from "next/link";
import { formatMoney } from "@/server/lib/money";
import { round2 } from "@/server/lib/budget";
import { formatDate, monthBounds, parsePeriodLabel, shortMonthLabel } from "@/server/lib/period";
import type { CashProjection } from "@/server/lib/cash-projection";
import type { DailyCashPoint, BudgetLineRow, BudgetView } from "@/server/queries";
import { CashMonthChart } from "@/components/budget/CashMonthChart";
import { Stat } from "@/components/budget/Stat";
import { Icon, Notice } from "@/components/ds";

/**
 * Cash across the horizon: the chart carries the story, a row of quiet numbers gives the
 * landmarks, one short paragraph says how the plan is tracking, and the dated events sit in a
 * closed disclosure for when you want them. No tiles.
 */
export function CashMonthWidget({
  daily,
  projection: p,
  periodLabel,
  lines = [],
  unplanned,
  today,
  showSpendable = true,
}: {
  daily: DailyCashPoint[];
  projection: CashProjection | null;
  periodLabel: string;
  lines?: BudgetLineRow[];
  unplanned?: BudgetView["unplannedSpend"];
  today?: string;
  /** Off where the page already shows the spendable figures (the dashboard's Safe-to-spend tile). */
  showSpendable?: boolean;
}) {
  const parsed = parsePeriodLabel(periodLabel);
  if (!parsed) return null;
  const { start, end } = monthBounds(parsed.year, parsed.month);
  const first = daily[0] ?? null;
  const last = daily[daily.length - 1] ?? null;
  if (!first && !p) {
    return (
      <section className="rounded-card border border-dashed border-line-strong p-5 text-sm text-fg-3">
        Record a cash balance on{" "}
        <Link href="/accounts" className="underline hover:text-accent-text">
          Accounts
        </Link>{" "}
        and the month&apos;s cash line appears here.
      </section>
    );
  }
  const lowSoFar = daily.reduce<DailyCashPoint | null>((m, d) => (!m || d.total < m.total ? d : m), null);
  const monthStart = first?.total ?? p?.monthStart ?? null;
  const now = last?.total ?? p?.start ?? null;
  const projecting = !!p && p.spreadDays > 0;
  const horizonEnd = projecting ? p.horizonEnd : end;
  const nextMonth = projecting ? p.months[1] ?? null : null;
  const endDelta = projecting && monthStart != null ? p.endBalance - monthStart : null;
  const lowAll = projecting ? p.low : null;
  const lowIsProjected = !!lowAll && lowAll.date > (last?.date ?? start) && (!lowSoFar || lowAll.balance < lowSoFar.total);
  const low = lowIsProjected ? { balance: lowAll!.balance, date: lowAll!.date, projected: true } : lowSoFar ? { balance: lowSoFar.total, date: lowSoFar.date, projected: false } : null;
  const paychecks = p?.events.filter((e) => e.kind === "paycheck") ?? [];
  const outgoing = p?.events.filter((e) => e.kind !== "paycheck") ?? [];

  // Above/below plan: the last recorded balance against where the budgeted path put that same
  // day. The plan is fixed for the month (`planMonth`), so unlike the projection this only moves
  // when money does.
  const plan = projecting ? p.plan ?? null : null;
  const planToday = plan && last ? (plan.days.find((d) => d.date === last.date)?.balance ?? null) : null;
  const vsPlan = planToday != null && last ? round2(last.total - planToday) : null;
  // A payday whose nominal date has passed but which never matched a deposit: either the money
  // genuinely didn't arrive, or its description doesn't match the payroll pattern. Both are worth
  // saying out loud, because the projection stops counting on it either way.
  const missedPaydays = projecting ? p.paydays.filter((m) => !m.complete && m.date < (today ?? p.asOf)) : [];
  const focusMonth = projecting ? p.months[p.focusIndex] : null;
  const planDrawn = !!plan && plan.days.length > 0;
  // Money that left with no envelope behind it. The projection is blind to it by construction —
  // it only ever spreads what a line planned — so it comes straight off month-end every month.
  const unplannedTotal = unplanned?.total ?? 0;
  // The savings line is a deliberate carry into next month (rent lands on the 1st, before the
  // month's own pay), so an unfunded one means month-end cash above is counting money that is
  // supposed to be already spoken for.
  const savingsLines = lines.filter((l) => l.kind === "savings");
  const savingsPlanned = savingsLines.reduce((s, l) => s + l.planned, 0);
  const savingsActual = savingsLines.reduce((s, l) => s + l.actual, 0);
  const savingsShort = round2(savingsPlanned - savingsActual);
  const overspend = focusMonth?.overspend ?? 0;
  const sp = projecting ? p.spendable : null;
  const reserved = sp?.reserved ?? 0;
  const spendLines = lines.filter((l) => l.kind === "category");
  const spendPlanned = spendLines.reduce((s, l) => s + l.planned, 0);
  const spendActual = spendLines.reduce((s, l) => s + l.actual, 0);
  const dim = Number(end.slice(8, 10));
  const anchor = today && today >= start && today <= end ? today : last?.date ?? null;
  const elapsed = anchor ? Number(anchor.slice(8, 10)) : 0;
  const expected = spendPlanned > 0 && elapsed > 0 ? (spendPlanned * elapsed) / dim : null;
  const paceDelta = expected != null ? spendActual - expected : null;

  return (
    <section className="mp-card p-5 max-md:p-3.5 md:p-6 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Cash{nextMonth ? ` through ${shortMonthLabel(nextMonth.label)}` : ` through ${shortMonthLabel(periodLabel)}`}
        </h2>
        <span className="text-xs text-fg-3">
          {projecting ? `recorded through ${formatDate(last?.date ?? p.asOf)}, projected after` : last ? `through ${formatDate(last.date)}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-5">
        <Stat label="Month start" value={monthStart != null ? formatMoney(monthStart) : "—"} />
        <Stat
          label="Now"
          value={now != null ? formatMoney(now) : "—"}
          hint={
            vsPlan != null ? (
              <span className={vsPlan >= 0 ? "text-income" : "text-over"}>
                {vsPlan >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(vsPlan))} vs plan
              </span>
            ) : monthStart != null && now != null ? (
              <span className={now - monthStart >= 0 ? "text-income" : "text-over"}>
                {now - monthStart >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(now - monthStart))}
              </span>
            ) : undefined
          }
        />
        {projecting && (
          <Stat
            label={`End of ${shortMonthLabel(periodLabel)}`}
            value={formatMoney(p.endBalance)}
            hint={
              <>
                {plan ? (
                  <span className={p.endBalance - plan.endBalance >= 0 ? "text-income" : "text-over"}>
                    {p.endBalance - plan.endBalance >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(p.endBalance - plan.endBalance))} vs plan
                  </span>
                ) : (
                  endDelta != null && (
                    <span className={endDelta >= 0 ? "text-income" : "text-over"}>
                      {endDelta >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(endDelta))} vs start
                    </span>
                  )
                )}
                {/* The conservative bookend. Only worth saying when it actually differs — early in
                    a month, or with nothing spent yet, the two are the same number. */}
                {Math.abs(p.envelope.endBalance - p.endBalance) > 1 && (
                  <span className="block text-fg-3">{formatMoney(p.envelope.endBalance)} if you spend the whole budget</span>
                )}
              </>
            }
          />
        )}
        {nextMonth && <Stat label={`End of ${shortMonthLabel(nextMonth.label)}`} value={formatMoney(nextMonth.endBalance)} hint={nextMonth.assumed ? "on this month's plan" : "on its own budget"} tone={nextMonth.endBalance < 0 ? "bad" : undefined} />}
        {low && <Stat label={low.projected ? "Lowest ahead" : "Lowest so far"} value={formatMoney(low.balance)} hint={formatDate(low.date)} tone={low.balance < 0 ? "bad" : low.projected ? "accent" : undefined} />}
      </div>

      {/* Reserved cash is inside every number above. Spending it would clear at the bank, which is
          exactly why the headline figures need a companion that says what's actually free. */}
      {showSpendable && reserved > 0 && sp && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-5 rounded-panel bg-sunken px-4 py-4">
          <Stat label="Reserved" value={formatMoney(reserved)} hint="savings goals" />
          <Stat label="Spendable now" value={formatMoney(sp.now)} tone={sp.now < 0 ? "bad" : undefined} />
          <Stat label={`Spendable end of ${shortMonthLabel(periodLabel)}`} value={formatMoney(sp.end)} tone={sp.end < 0 ? "bad" : undefined} />
          <Stat
            label="Spendable at the low"
            value={formatMoney(sp.low.balance)}
            hint={formatDate(sp.low.date)}
            tone={sp.low.balance < 0 ? "bad" : sp.low.balance < 500 ? "accent" : undefined}
          />
        </div>
      )}

      <CashMonthChart daily={daily} projection={projecting ? p : null} monthStart={start} horizonEnd={horizonEnd} />

      {(missedPaydays.length > 0 || (focusMonth?.unexpectedIncome ?? 0) > 0) && (
        <Notice tone="warn">
          <div className="space-y-1 text-xs">
          {missedPaydays.map((m) => (
            <p key={m.date}>
              The {formatDate(m.date)} payday shows {formatMoney(m.arrived)} of {formatMoney(m.expected)} arrived, so{" "}
              {formatMoney(m.residual)} isn&apos;t counted in the projection. If it did land, its description
              doesn&apos;t match the payroll pattern on{" "}
              <Link href="/settings/pay-schedule" className="underline hover:text-accent-text">
                Pay Schedule
              </Link>
              .
            </p>
          ))}
          {(focusMonth?.unexpectedIncome ?? 0) > 0 && (
            <p>
              {formatMoney(focusMonth!.unexpectedIncome)} of income this month matched no payday — a refund or bonus
              if that&apos;s expected, otherwise payroll the pattern is missing.
            </p>
          )}
          </div>
        </Notice>
      )}

      {(unplannedTotal > 0 || savingsShort > 0.5 || (focusMonth?.unbudgetedBillTotal ?? 0) > 0) && (
        // Collapsed by default: the summary line carries the totals, the paragraphs explain them. On a
        // phone the open version is a screenful of prose.
        <details className="group rounded-panel border border-line px-4 py-3 text-xs leading-relaxed">
          <summary className="cursor-pointer select-none list-none flex items-center gap-1.5 text-fg-2">
            <Icon name="chevron-right" size={12} className="transition-transform group-open:rotate-90 text-fg-3" />
            <span className="font-medium text-fg-2">Outside the plan</span>
            <span className="tabular-nums">
              {[
                (focusMonth?.unbudgetedBillTotal ?? 0) > 0 && `${formatMoney(focusMonth!.unbudgetedBillTotal)} bills without an envelope`,
                unplannedTotal > 0 && `${formatMoney(unplannedTotal)} unplanned spend`,
                savingsShort > 0.5 && `savings ${formatMoney(savingsShort)} short`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </summary>
          <div className="mt-2 space-y-2">
          {(focusMonth?.unbudgetedBillTotal ?? 0) > 0 && (
            <p>
              <strong className="tabular-nums">{formatMoney(focusMonth!.unbudgetedBillTotal)}</strong> of bills draw
              from no budget envelope{" "}
              <span className="text-fg-3">
                ({focusMonth!.unbudgetedBills
                  .slice(0, 4)
                  .map((b) => `${b.name} ${formatMoney(b.amount)}`)
                  .join(", ")}
                {focusMonth!.unbudgetedBills.length > 4 && `, +${focusMonth!.unbudgetedBills.length - 4} more`})
              </span>
              . Each leaves cash on its due day while whatever envelope plans for it is ALSO spread across the
              month, so the same money is counted twice. Set the envelope on the bill (Settings → Bills → the bill
              → Budget envelope) and the projection nets them.
            </p>
          )}
          {unplannedTotal > 0 && (
            <p>
              <strong className="tabular-nums">{formatMoney(unplannedTotal)}</strong> spent in categories with no
              budget line{" "}
              <span className="text-fg-3">
                ({unplanned!.categories
                  .slice(0, 4)
                  .map((c) => `${c.category ?? "uncategorized"} ${formatMoney(c.amount)}`)
                  .join(", ")}
                {unplanned!.categories.length > 4 && `, +${unplanned!.categories.length - 4} more`})
              </span>
              . The projection only spreads what a line planned, so this never appears in the
              forecast — it just comes off month-end. Give it a line to bring it inside the plan.
            </p>
          )}
          {savingsShort > 0.5 && (
            <p>
              Savings is <strong className="tabular-nums">{formatMoney(savingsActual)}</strong> of{" "}
              <strong className="tabular-nums">{formatMoney(savingsPlanned)}</strong> funded —{" "}
              <strong className="tabular-nums text-warn">{formatMoney(savingsShort)}</strong>{" "}
              short. That buffer is what carries into next month, so month-end cash above still counts it as
              spendable when it isn&apos;t.
            </p>
          )}
          </div>
        </details>
      )}

      {planDrawn && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke="var(--mp-accent)" strokeWidth="2" />
            </svg>
            cash recorded
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke="var(--mp-accent)" strokeWidth="2" strokeDasharray="5 4" strokeOpacity="0.8" />
            </svg>
            projected from here
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke="var(--mp-money-plan)" strokeWidth="1.5" strokeOpacity="0.75" />
            </svg>
            {shortMonthLabel(periodLabel)} as budgeted
          </span>
        </div>
      )}

      {projecting && (
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm leading-relaxed">
          <p>
            {plan && vsPlan != null && planToday != null && last ? (
              <>
                On budget you&apos;d have {formatMoney(planToday)} on {formatDate(last.date)}; you have{" "}
                {formatMoney(last.total)} —{" "}
                <strong className={vsPlan >= 0 ? "text-income" : "text-over"}>
                  {Math.abs(vsPlan) <= 1 ? "right on plan" : `${formatMoney(Math.abs(vsPlan))} ${vsPlan > 0 ? "above" : "below"} plan`}
                </strong>
                . The budget ends {shortMonthLabel(periodLabel)} at {formatMoney(plan.endBalance)}.
                {vsPlan < -1 && (
                  <span className="text-fg-3"> A bill paid before its due day counts against this until that day.</span>
                )}
              </>
            ) : (
              <span className="text-fg-3">
                Record a balance from before {shortMonthLabel(periodLabel)} began and this compares today against the budget.
              </span>
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
                {overspend > 0 && (
                  <> {formatMoney(overspend)} of that is over-plan on individual envelopes, credited against what&apos;s left.</>
                )}
              </>
            ) : (
              <span className="text-fg-3">No everyday envelopes to pace against.</span>
            )}
          </p>
        </div>
      )}

      {projecting && (
        <details className="group text-sm">
          <summary className="cursor-pointer select-none text-fg-3 hover:text-fg list-none flex items-center gap-1.5">
            <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
            What&apos;s coming — {paychecks.length} paycheck{paychecks.length === 1 ? "" : "s"}, {outgoing.length} payment{outgoing.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-3">
            <ul className="space-y-1">
              {paychecks.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="text-fg-3 tabular-nums">{formatDate(e.date)}</span> {e.label}
                  </span>
                  <span className="tabular-nums text-income">+{formatMoney(e.amount)}</span>
                </li>
              ))}
              {paychecks.length === 0 && <li className="text-fg-3">No paydays left on the horizon.</li>}
            </ul>
            <ul className="space-y-1">
              {outgoing.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-fg-3 tabular-nums">{formatDate(e.date)}</span> {e.label}
                    {e.overdue && <span className="ml-1 text-xs text-over">past due</span>}
                  </span>
                  <span className="tabular-nums shrink-0">−{formatMoney(Math.abs(e.amount))}</span>
                </li>
              ))}
              {p.months.map(
                (m) =>
                  m.spreadTotal > 0 && (
                    <li key={m.label} className="flex justify-between gap-2 text-fg-3">
                      <span>
                        Everyday, {shortMonthLabel(m.label)} · ~{formatMoney(m.spreadDaily)}/day
                        {m.pacedFromHistory && m.paceWeight >= 1
                          ? ` · your pace (${formatMoney(m.observedSpend)} over ${m.elapsedDays} days)`
                          : m.pacedFromHistory
                            ? " · pace, still blended with the plan"
                            : " · the plan, nothing spent yet to measure"}
                        {m.assumed && " · this month's plan"}
                      </span>
                      <span className="tabular-nums shrink-0">−{formatMoney(m.spreadTotal)}</span>
                    </li>
                  ),
              )}
            </ul>
          </div>
          <p className="mt-4 text-xs text-fg-3 leading-relaxed">
            Solid line: the balance ledger day by day. Dashed: the plan from {formatDate(p.asOf)} — unpaid bills leave on their due day, debt payments are what the plan still owes, everyday spending drains evenly. Next month uses its own budget if it has one, otherwise this one.
            {planDrawn && (
              <>
                {" "}
                The thin blue line is the month exactly as budgeted, from the balance it opened
                with — every paycheck in full on its day, every bill on its due day, every envelope
                spent evenly. It ignores what actually happened, so it holds still: the gap between
                it and the green line is how far above or below plan you are.
              </>
            )}
            {" "}
            Scheduled paydays are netted against the payroll that actually landed near them, so a
            split direct deposit isn&apos;t counted twice. Everyday spending is carried forward at
            the rate this month has actually run at, not at &ldquo;whatever budget is left ÷ days
            left&rdquo; — that version accelerates as the month closes and drops the entire unspent
            remainder on the last day, which is arithmetic rather than a plan. The full-budget
            figure stays above as the conservative bookend.
          </p>
        </details>
      )}
    </section>
  );
}

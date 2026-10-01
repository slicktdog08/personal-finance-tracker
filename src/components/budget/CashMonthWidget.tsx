import Link from "next/link";
import { formatMoney } from "@/server/lib/money";
import { round2 } from "@/server/lib/budget";
import { formatDate, monthBounds, parsePeriodLabel, shortMonthLabel } from "@/server/lib/period";
import type { CashProjection } from "@/server/lib/cash-projection";
import type { DailyCashPoint, BudgetLineRow, BudgetView } from "@/server/queries";
import { CashMonthChart } from "@/components/budget/CashMonthChart";
import { Stat } from "@/components/budget/Stat";

/**
 * Cash across the horizon: the chart carries the story, a row of quiet numbers gives the
 * landmarks, one short paragraph says how the plan is tracking, and the dated events sit in a
 * closed disclosure for when you want them. No tiles.
 */
export function CashMonthWidget({ daily, projection: p, periodLabel, lines = [], unplanned, today }: { daily: DailyCashPoint[]; projection: CashProjection | null; periodLabel: string; lines?: BudgetLineRow[]; unplanned?: BudgetView["unplannedSpend"]; today?: string }) {
  const parsed = parsePeriodLabel(periodLabel);
  if (!parsed) return null;
  const { start, end } = monthBounds(parsed.year, parsed.month);
  const first = daily[0] ?? null;
  const last = daily[daily.length - 1] ?? null;
  if (!first && !p) {
    return (
      <section className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 text-sm text-neutral-500">
        Record a cash balance on{" "}
        <Link href="/accounts" className="underline hover:text-indigo-600">
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

  const tr = projecting ? p.trend : null;
  const ref = tr?.weekAgo ?? tr?.first ?? null;
  const trendDelta = ref && p ? p.endBalance - ref.endBalance : null;
  // A payday whose nominal date has passed but which never matched a deposit: either the money
  // genuinely didn't arrive, or its description doesn't match the payroll pattern. Both are worth
  // saying out loud, because the projection stops counting on it either way.
  const missedPaydays = projecting ? p.paydays.filter((m) => !m.complete && m.date < (today ?? p.asOf)) : [];
  const focusMonth = projecting ? p.months[p.focusIndex] : null;
  // The same window the chart draws the forecast line in. Viewing a future month, every snapshot
  // was taken before that month began, so there is no line — and no legend entry for one.
  const forecastDrawn = projecting
    ? (p.trend?.series ?? []).filter((s) => s.takenOn >= start && s.takenOn <= horizonEnd).length > 1
    : false;
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
    <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 md:p-6 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Cash{nextMonth ? ` through ${shortMonthLabel(nextMonth.label)}` : ` through ${shortMonthLabel(periodLabel)}`}
        </h2>
        <span className="text-xs text-neutral-500">
          {projecting ? `recorded through ${formatDate(last?.date ?? p.asOf)}, projected after` : last ? `through ${formatDate(last.date)}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-5">
        <Stat label="Month start" value={monthStart != null ? formatMoney(monthStart) : "—"} />
        <Stat label="Now" value={now != null ? formatMoney(now) : "—"} hint={monthStart != null && now != null ? <span className={now - monthStart >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}>{now - monthStart >= 0 ? "+" : "−"}{formatMoney(Math.abs(now - monthStart))}</span> : undefined} />
        {projecting && <Stat label={`End of ${shortMonthLabel(periodLabel)}`} value={formatMoney(p.endBalance)} hint={endDelta != null ? <span className={endDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}>{endDelta >= 0 ? "+" : "−"}{formatMoney(Math.abs(endDelta))} vs start</span> : undefined} />}
        {nextMonth && <Stat label={`End of ${shortMonthLabel(nextMonth.label)}`} value={formatMoney(nextMonth.endBalance)} hint={nextMonth.assumed ? "on this month's plan" : "on its own budget"} tone={nextMonth.endBalance < 0 ? "bad" : undefined} />}
        {low && <Stat label={low.projected ? "Lowest ahead" : "Lowest so far"} value={formatMoney(low.balance)} hint={formatDate(low.date)} tone={low.balance < 0 ? "bad" : low.projected ? "accent" : undefined} />}
      </div>

      {/* Reserved cash is inside every number above. Spending it would clear at the bank, which is
          exactly why the headline figures need a companion that says what's actually free. */}
      {reserved > 0 && sp && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-5 rounded-xl bg-neutral-50 dark:bg-neutral-800/40 px-4 py-4">
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
        <div className="rounded-lg border border-amber-300/70 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-xs space-y-1">
          {missedPaydays.map((m) => (
            <p key={m.date}>
              The {formatDate(m.date)} payday shows {formatMoney(m.arrived)} of {formatMoney(m.expected)} arrived, so{" "}
              {formatMoney(m.residual)} isn&apos;t counted in the projection. If it did land, its description
              doesn&apos;t match the payroll pattern on{" "}
              <Link href="/settings/pay-schedule" className="underline hover:text-indigo-600">
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
      )}

      {(unplannedTotal > 0 || savingsShort > 0.5) && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-4 py-3 text-xs leading-relaxed space-y-2">
          <div className="uppercase tracking-wide text-[10px] text-neutral-500">Outside the plan</div>
          {unplannedTotal > 0 && (
            <p>
              <strong className="tabular-nums">{formatMoney(unplannedTotal)}</strong> spent in categories with no
              budget line{" "}
              <span className="text-neutral-500">
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
              <strong className="tabular-nums text-amber-700 dark:text-amber-500">{formatMoney(savingsShort)}</strong>{" "}
              short. That buffer is what carries into next month, so month-end cash above still counts it as
              spendable when it isn&apos;t.
            </p>
          )}
        </div>
      )}

      {forecastDrawn && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke="#059669" strokeWidth="2" />
            </svg>
            cash recorded
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke="#059669" strokeWidth="2" strokeDasharray="5 4" strokeOpacity="0.8" />
            </svg>
            projected from here
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke="#6366f1" strokeWidth="1.5" />
              <circle cx="9" cy="4" r="1.8" fill="#6366f1" />
            </svg>
            what each day forecast for {shortMonthLabel(periodLabel)} month-end
          </span>
        </div>
      )}

      {projecting && (
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm leading-relaxed">
          <p>
            {ref && trendDelta != null ? (
              <>
                On {formatDate(ref.takenOn)} this month looked like ending at {formatMoney(ref.endBalance)}. Today it&apos;s{" "}
                <strong className={trendDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                  {formatMoney(p.endBalance)}
                </strong>
                {trendDelta < -1 ? " — running below plan." : trendDelta > 1 ? " — running ahead of plan." : " — on plan."}
              </>
            ) : (
              <span className="text-neutral-500">First projection recorded today; tomorrow this compares against it.</span>
            )}
          </p>
          <p>
            {expected != null && paceDelta != null ? (
              <>
                {formatMoney(spendActual)} spent by day {elapsed}; on plan you&apos;d be at {formatMoney(expected)} —{" "}
                <strong className={paceDelta > 1 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                  {paceDelta > 1 ? `${formatMoney(paceDelta)} ahead of pace` : paceDelta < -1 ? `${formatMoney(-paceDelta)} under pace` : "right on pace"}
                </strong>
                .
                {overspend > 0 && (
                  <> {formatMoney(overspend)} of that is over-plan on individual envelopes, credited against what&apos;s left.</>
                )}
              </>
            ) : (
              <span className="text-neutral-500">No everyday envelopes to pace against.</span>
            )}
          </p>
        </div>
      )}

      {projecting && (
        <details className="group text-sm">
          <summary className="cursor-pointer select-none text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 list-none flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90 text-xs">▶</span>
            What&apos;s coming — {paychecks.length} paycheck{paychecks.length === 1 ? "" : "s"}, {outgoing.length} payment{outgoing.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-3">
            <ul className="space-y-1">
              {paychecks.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="text-neutral-500 tabular-nums">{formatDate(e.date)}</span> {e.label}
                  </span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+{formatMoney(e.amount)}</span>
                </li>
              ))}
              {paychecks.length === 0 && <li className="text-neutral-500">No paydays left on the horizon.</li>}
            </ul>
            <ul className="space-y-1">
              {outgoing.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-neutral-500 tabular-nums">{formatDate(e.date)}</span> {e.label}
                    {e.overdue && <span className="ml-1 text-[10px] uppercase text-amber-600">past due</span>}
                  </span>
                  <span className="tabular-nums shrink-0">−{formatMoney(Math.abs(e.amount))}</span>
                </li>
              ))}
              {p.months.map(
                (m) =>
                  m.spreadTotal > 0 && (
                    <li key={m.label} className="flex justify-between gap-2 text-neutral-500">
                      <span>
                        Everyday, {shortMonthLabel(m.label)} · ~{formatMoney(m.spreadDaily)}/day{m.assumed && " · this month's plan"}
                      </span>
                      <span className="tabular-nums shrink-0">−{formatMoney(m.spreadTotal)}</span>
                    </li>
                  ),
              )}
            </ul>
          </div>
          <p className="mt-4 text-xs text-neutral-400 leading-relaxed">
            Solid line: the balance ledger day by day. Dashed: the plan from {formatDate(p.asOf)} — unpaid bills leave on their due day, debt payments are what the plan still owes, everyday spending drains evenly. Next month uses its own budget if it has one, otherwise this one.
            {forecastDrawn && (
              <>
                {" "}
                The thin indigo line is plotted against the day each forecast was made, not the day
                the money moves: flat means the plan is holding, and it meets the dashed line at
                month end.
              </>
            )}
            {" "}
            Scheduled paydays are netted against the payroll that actually landed near them, so a
            split direct deposit isn&apos;t counted twice.
          </p>
        </details>
      )}
    </section>
  );
}

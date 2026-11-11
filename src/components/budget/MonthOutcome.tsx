"use client";

import { useState, useTransition } from "react";
import { finalizeBudget, reopenBudget } from "@/server/actions/budget";
import type { BudgetOutcome } from "@/server/lib/budget-outcome";
import { formatDate } from "@/server/lib/period";
import { Button, Card, Icon, Money, Notice, cx } from "@/components/ds";
import { Stat } from "@/components/budget/Stat";

/**
 * How a finished month went. One number (the outcome), the sweep that produced it as a short
 * ledger — the plan's leftover, every envelope's unspent money swept in, overspending and
 * unplanned spending taken out, debt paid vs. due, then interest net of rewards — and the
 * balances beside it as the reality check. Before the month is finalized it's a live preview with
 * the Finalize button; after, it's the frozen report and the plan above it is read-only.
 */
export function MonthOutcome({
  budgetId,
  pretty,
  outcome: o,
  finalizedAt,
}: {
  budgetId: number;
  pretty: string;
  outcome: BudgetOutcome;
  finalizedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      setConfirm(false);
    });

  const good = o.outcome >= 0;
  const monthName = pretty.replace(/ \d{4}$/, "");
  const rows: { label: string; value: number; note?: React.ReactNode; strong?: boolean }[] = [
    { label: "Left unassigned in the plan", value: o.unallocated },
    ...(o.income.planned != null && Math.abs(o.income.variance) >= 0.5 ? [{ label: o.income.variance >= 0 ? "Income above plan" : "Income below plan", value: o.income.variance }] : []),
    { label: "Swept from unspent envelopes", value: o.everyday.swept },
    { label: "Envelopes over plan", value: -o.everyday.overspent },
    ...(o.unplanned.total > 0.5 ? [{ label: "Spending with no envelope", value: -o.unplanned.total }] : []),
    ...(Math.abs(o.debt.variance) >= 0.5 ? [{ label: o.debt.variance >= 0 ? "Debt paid under plan" : "Debt paid beyond plan", value: o.debt.variance }] : []),
    { label: "Left over", value: o.leftover, strong: true },
    ...(o.debt.interest > 0 ? [{ label: "Interest charged on debt", value: -o.debt.interest }] : []),
    ...(o.debt.rewards > 0 ? [{ label: "Rewards & credits", value: o.debt.rewards }] : []),
  ];
  const worst = o.everyday.lines.filter((l) => l.variance < -0.5).slice(0, 3);
  const best = [...o.everyday.lines].reverse().filter((l) => l.variance > 0.5).slice(0, 3);

  return (
    <Card className={cx(finalizedAt ? "" : "border-dashed")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-fg-3">
            <Icon name={finalizedAt ? "lock" : "flag"} size={13} />
            {finalizedAt ? <>Finalized {formatDate(finalizedAt.slice(0, 10))}</> : <>{monthName} is over. Preview, not finalized yet</>}
          </div>
          <h2 className="mt-2 font-display text-lg font-semibold tracking-tight">How {monthName} went</h2>
          <div className="mt-3 flex items-baseline gap-3">
            <Money value={o.outcome} kind={good ? "income" : "over"} sign="auto" style={{ font: "var(--mp-type-money-lg)" }} />
            <span className="text-sm text-fg-3">{good ? "came out ahead of the plan" : "came in short of the plan"}, after interest</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {finalizedAt ? (
            <Button size="sm" variant="ghost" icon="lock-open" disabled={pending} onClick={() => act(() => reopenBudget(budgetId))}>
              Reopen month
            </Button>
          ) : confirm ? (
            <>
              <Button size="sm" icon="lock" disabled={pending} onClick={() => act(() => finalizeBudget(budgetId))}>
                Finalize {monthName}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Not yet
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" icon="lock" onClick={() => setConfirm(true)}>
              Finalize month
            </Button>
          )}
        </div>
      </div>
      {confirm && !finalizedAt && (
        <p className="mt-3 text-sm text-fg-3">
          Finalizing locks every envelope and keeps this report as it stands. Transactions that land later won&apos;t change it. You can reopen the month any time.
        </p>
      )}

      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* By the plan: the sweep, top to bottom. */}
        <div>
          <div className="text-xs font-medium text-fg-3 mb-2">By the plan</div>
          <dl className="text-sm">
            {rows.map((r) => (
              <div key={r.label} className={cx("flex items-baseline justify-between gap-4 py-1.5", r.strong && "border-t border-line mt-1 pt-2.5 font-semibold")}>
                <dt className={r.strong ? "" : "text-fg-2"}>{r.label}</dt>
                <dd className="tabular-nums">
                  <Money value={r.value} kind={r.strong ? (r.value >= 0 ? "income" : "over") : "neutral"} sign={r.strong ? "auto" : "always"} />
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-line-strong mt-1 pt-2.5 font-semibold">
              <dt>Outcome</dt>
              <dd className="tabular-nums">
                <Money value={o.outcome} kind={good ? "income" : "over"} sign="auto" />
              </dd>
            </div>
          </dl>
        </div>

        {/* By the balances: what cash and debt actually did. */}
        <div>
          <div className="text-xs font-medium text-fg-3 mb-3">By the balances</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Stat
              label="Cash on hand"
              value={o.savings.cashChange != null ? <Money value={o.savings.cashChange} kind={o.savings.cashChange >= 0 ? "income" : "over"} sign="always" whole /> : "—"}
              hint={
                o.savings.cashStart != null && o.savings.cashEnd != null ? (
                  <>
                    <Money value={o.savings.cashStart} kind="neutral" whole /> → <Money value={o.savings.cashEnd} kind="neutral" whole />
                    {o.savings.planned > 0 && (
                      <>
                        {" "}
                        · savings plan <Money value={o.savings.planned} kind="neutral" whole />
                      </>
                    )}
                  </>
                ) : (
                  "balances not recorded"
                )
              }
            />
            <Stat
              label="Debt"
              value={o.debt.change != null ? <Money value={o.debt.change} kind={o.debt.change <= 0 ? "income" : "over"} sign="always" whole /> : "—"}
              hint={
                o.debt.balanceStart != null && o.debt.balanceEnd != null ? (
                  <>
                    <Money value={o.debt.balanceStart} kind="neutral" whole /> → <Money value={o.debt.balanceEnd} kind="neutral" whole />
                  </>
                ) : (
                  "balances not recorded"
                )
              }
            />
            <Stat
              label="Debt payments"
              value={<Money value={o.debt.paidTotal} kind="neutral" whole />}
              hint={
                <>
                  <Money value={o.debt.paidToward} kind="neutral" whole /> toward <Money value={o.debt.planned} kind="neutral" whole /> due
                </>
              }
            />
            <Stat
              label="Net change"
              value={o.netChange != null ? <Money value={o.netChange} kind={o.netChange >= 0 ? "income" : "over"} sign="always" whole /> : "—"}
              hint="cash change minus debt change"
            />
          </div>
          {(worst.length > 0 || best.length > 0) && (
            <div className="mt-5 text-xs text-fg-3 space-y-1 border-t border-line pt-4">
              {worst.length > 0 && (
                <p>
                  <span className="text-over font-medium">Over:</span>{" "}
                  {worst.flatMap((l, i) => [i ? " · " : "", <span key={l.label}>{l.label} <Money value={-l.variance} kind="neutral" whole /></span>])}
                </p>
              )}
              {best.length > 0 && (
                <p>
                  <span className="text-income font-medium">Under:</span>{" "}
                  {best.flatMap((l, i) => [i ? " · " : "", <span key={l.label}>{l.label} <Money value={l.variance} kind="neutral" whole /></span>])}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {err && (
        <Notice tone="danger" className="mt-4">
          {err}
        </Notice>
      )}
    </Card>
  );
}

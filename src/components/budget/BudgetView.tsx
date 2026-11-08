"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  updateBudget,
  deleteBudget,
  addBudgetLine,
  updateBudgetLine,
  deleteBudgetLine,
  setBudgetTarget,
  setBudgetLinePlanned,
} from "@/server/actions/budget";
import { SAVINGS_CATEGORY, type DebtStrategy } from "@/constants/enums";
import { formatMoney } from "@/server/lib/money";
import { formatDate, monthBounds } from "@/server/lib/period";
import { EXCESS_THRESHOLD, budgetExcess, isSnowballDebt, orderDebts, type DebtInput, type PayoffProjection } from "@/server/lib/budget";
import type { BudgetView as BudgetViewData, BudgetLineRow, CategoryOption } from "@/server/queries";
import { Button, Card, Icon, IconButton, Input, Money, Notice, PageHeader, Segmented, StatTile, Switch, buttonClass, cx } from "@/components/ds";
import { ColorSelect } from "@/components/ColorSelect";
import { Envelope } from "@/components/budget/Envelope";
import { FlowBar } from "@/components/budget/FlowBar";
import { BalanceDock } from "@/components/budget/BalanceDock";
import { AmountControl } from "@/components/budget/AmountControl";
import { PayoffCallout } from "@/components/budget/PayoffCallout";
import { PLAN_COLORS as COLORS } from "@/components/budget/colors";

type Run = (fn: () => Promise<{ ok: boolean; error?: string } | void>) => void;
type Mode = DebtStrategy | "manual";

/** "Oct 21, 2026" → "Oct 21": the year is noise in a sentence about this month. */
const shortDate = (iso: string) => formatDate(iso).replace(/, \d{4}$/, "");

/**
 * The month as a board of envelopes. A hero card says what's coming in and where it goes (one
 * split bar); four KPI cards say how the month is running; then the envelopes, grouped. Tap an
 * envelope to open it and change the amount — open envelopes trade with each other, or with the
 * target when only one is open. "Adjust" opens every everyday envelope at once; "Done" (header or
 * dock) locks them all again.
 */
export function BudgetView({
  view,
  pretty,
  nav,
  projection,
  projectionBudget,
  categories,
  cashWidget,
  projectedEndCash = null,
  today,
  nextPaycheck = null,
}: {
  view: BudgetViewData;
  pretty: string;
  /** Month picker + links for the header (server-built). */
  nav?: React.ReactNode;
  projection: PayoffProjection | null;
  projectionBudget: number;
  categories: CategoryOption[];
  cashWidget?: React.ReactNode;
  projectedEndCash?: number | null;
  /** YYYY-MM-DD; drives the "on pace today" tick on the everyday envelopes. */
  today?: string;
  /** Date of the next scheduled payday on the projection horizon, if any. */
  nextPaycheck?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const run: Run = (fn) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (r && !r.ok) {
        setErr(r.error ?? "Failed");
        router.refresh();
      }
    });
  const setPlanned = (line: BudgetLineRow, v: number) =>
    start(async () => {
      setErr(null);
      const r = await setBudgetLinePlanned(view.id, line.id, v);
      if (!r.ok) {
        setErr(r.error ?? "Failed");
        router.refresh();
      }
      else setNote(r.absorbed?.length ? r.absorbed.map((a) => `${a.label} ${formatMoney(a.from)} → ${formatMoney(a.to)}`).join(" · ") : null);
    });
  const toggle = (l: BudgetLineRow) => run(() => updateBudgetLine(l.id, { locked: !l.locked }));
  const lockAll = () =>
    start(async () => {
      for (const l of view.lines.filter((x) => !x.locked)) await updateBudgetLine(l.id, { locked: true });
      setNote(null);
    });

  const debtLines = view.lines.filter((l) => l.kind === "debt");
  const spendLines = view.lines.filter((l) => l.kind === "category");
  const savingsLines = view.lines.filter((l) => l.kind === "savings");
  const target = debtLines.find((l) => l.isTarget) ?? null;
  const isSink = (l: BudgetLineRow) => view.autoRebalance && l.isTarget;

  // "Adjust" opens every everyday envelope so they trade with each other (the pool rule below);
  // the target and the debt lines stay as they were.
  const adjustAll = () =>
    start(async () => {
      for (const l of spendLines.filter((x) => x.locked)) await updateBudgetLine(l.id, { locked: false });
    });

  const sum = (ls: BudgetLineRow[], k: "planned" | "actual") => ls.reduce((s, l) => s + l[k], 0);
  const income = view.plannedIncome;
  const debtPlanned = sum(debtLines, "planned");
  const spendPlanned = sum(spendLines, "planned");
  const spendActual = sum(spendLines, "actual");
  const savingsPlanned = sum(savingsLines, "planned");
  const minimums = debtLines.reduce((s, l) => s + Math.min(l.planned, l.minimum ?? l.minPayment ?? l.planned), 0);
  const extra = Math.max(0, debtPlanned - minimums);
  const plannedTotal = debtPlanned + spendPlanned + savingsPlanned;
  const spent = sum(debtLines, "actual") + spendActual;
  const free = income != null ? income - plannedTotal : null;
  const cashProjected = view.cash.start != null && projectedEndCash != null ? projectedEndCash - view.cash.start : null;

  // Where you'd be on pace today: plan × days elapsed ÷ days in month. Only inside the month —
  // a finished month has no "today", and a future one hasn't started.
  const { start: mStart, end: mEnd } = monthBounds(view.year, view.month);
  const inMonth = !!today && today >= mStart && today <= mEnd;
  const paceFrac = inMonth ? Number(today!.slice(8, 10)) / Number(mEnd.slice(8, 10)) : null;
  const finished = !!today && today > mEnd;
  const excess = budgetExcess({
    cashStart: view.cash.start,
    cashEnd: projectedEndCash,
    savingsPlanned,
    plannedIncome: income,
    plannedTotal,
    actualIncome: view.actualIncome,
  });

  // Strategy: which debt gets the extra. Snowball / avalanche pick the target by rule; Manual is
  // whatever you pointed at. Shown as Manual whenever the target isn't the rule's pick, so the
  // control never claims an order the plan isn't following.
  const debtInputs: (DebtInput & { line: BudgetLineRow })[] = debtLines
    .filter((l) => l.accountId != null && l.balance != null)
    .map((l) => ({ accountId: l.accountId!, label: l.label, balance: l.balance!, apr: l.apr, minPayment: l.minPayment, line: l }));
  const pickFor = (s: DebtStrategy) => {
    const first = orderDebts(debtInputs, s).find(isSnowballDebt);
    return first ? debtInputs.find((d) => d.accountId === first.accountId)!.line : null;
  };
  const saved = view.strategy === "snowball" || view.strategy === "avalanche" ? (view.strategy as DebtStrategy) : null;
  const mode: Mode = saved && (!target || pickFor(saved)?.id === target.id) ? saved : "manual";
  const setMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "manual") return run(() => updateBudget(view.id, { strategy: null }));
    const pick = pickFor(m);
    run(async () => {
      await updateBudget(view.id, { strategy: m });
      if (pick && !pick.isTarget) return setBudgetTarget(view.id, pick.id);
    });
  };

  // The open envelopes = the pool. The dock says where the next change lands.
  const open = view.lines.filter((l) => !l.locked && !isSink(l));
  const dock =
    open.length === 0
      ? null
      : open.length === 1
        ? {
            message: `${open[0].label} is open.`,
            detail:
              view.autoRebalance && target ? `Changes flow to ${target.label}'s payment. Open a second envelope to trade between them.` : "Changes move Unallocated. Open a second envelope to trade between them.",
          }
        : { message: `${open.map((l) => l.label).join(" ↔ ")}`, detail: note ?? `What you add to one comes out of the other${open.length > 2 ? "s, in proportion" : ""}.` };

  const controlFor = (l: BudgetLineRow, min: number, max: number, color: string) => (
    <AmountControl value={l.planned} min={min} max={max} step={25} sliderStep={5} color={color} disabled={pending} ariaLabel={`Planned for ${l.label}`} onCommit={(v) => setPlanned(l, v)} />
  );

  return (
    <div className="space-y-8 pb-24">
      <PageHeader
        eyebrow={pretty}
        title="Budget"
        actions={
          <>
            {nav}
            {open.length > 0 ? (
              <Button icon="check" onClick={lockAll} disabled={pending}>
                Done
              </Button>
            ) : (
              <Button variant="secondary" icon="sliders-horizontal" onClick={adjustAll} disabled={pending || spendLines.length === 0} title="Open every everyday envelope so they trade with each other">
                Adjust
              </Button>
            )}
          </>
        }
      />

      {/* ---- The month at a glance ---- */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <IncomeTile
            value={income}
            sub={
              <>
                <Money value={view.actualIncome} kind="neutral" /> landed so far
                {nextPaycheck && <> · next paycheck {shortDate(nextPaycheck)}</>}
              </>
            }
            onCommit={(v) => run(() => updateBudget(view.id, { plannedIncome: v }))}
          />
          <div className="grid gap-2.5 justify-items-start sm:justify-items-end min-w-0">
            {debtLines.length > 0 && (
              <Segmented<Mode>
                label="Debt strategy"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "snowball", label: "Snowball" },
                  { value: "avalanche", label: "Avalanche" },
                  { value: "manual", label: "Manual" },
                ]}
              />
            )}
            <Switch
              label={`Auto-rebalance extra to ${target ? target.label : "the target"}`}
              checked={view.autoRebalance}
              disabled={pending || !target}
              onChange={(e) => run(() => updateBudget(view.id, { autoRebalance: e.target.checked }))}
            />
          </div>
        </div>
        <FlowBar
          className="mt-5"
          total={income ?? plannedTotal}
          segments={[
            { label: "Debt minimums", value: minimums, color: COLORS.debt },
            { label: "Extra to debt", value: extra, color: COLORS.extra },
            { label: "Everyday", value: spendPlanned, color: COLORS.spend },
            { label: "Savings", value: savingsPlanned, color: COLORS.savings },
            ...(free != null && free > 0.5 ? [{ label: "Unallocated", value: free, color: COLORS.free, muted: true }] : []),
            ...(free != null && free < -0.5 ? [{ label: "Over income", value: -free, color: COLORS.over }] : []),
          ]}
        />
        <ExcessLine excess={excess} finished={finished} />
      </Card>

      <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as React.CSSProperties}>
        <Card>
          <StatTile
            size="sm"
            label="Spent so far"
            value={spent}
            kind={spent > debtPlanned + spendPlanned ? "over" : "neutral"}
            sub={
              <>
                of <Money value={debtPlanned + spendPlanned} kind="neutral" whole /> planned
              </>
            }
          />
        </Card>
        <Card>
          <StatTile size="sm" label="Left to spend" value={Math.max(0, spendPlanned - spendActual)} sub="everyday envelopes" />
        </Card>
        <Card>
          <StatTile size="sm" label="Extra to debt" value={extra} kind="owed" sub={target ? `→ ${target.label}` : "no target"} />
        </Card>
        <Card>
          <StatTile
            size="sm"
            label="Cash by month end"
            value={projectedEndCash != null ? projectedEndCash : "—"}
            kind="plan"
            sub={
              cashProjected != null ? (
                <>
                  <Money value={cashProjected} kind={cashProjected >= savingsPlanned ? "income" : "over"} sign="always" /> vs month start
                  {savingsPlanned > 0 && (cashProjected >= savingsPlanned ? " · savings on track" : " · short of savings")}
                </>
              ) : (
                "record a balance to project"
              )
            }
          />
        </Card>
      </div>

      {cashWidget}

      {/* ---- Debts ---- */}
      <Group
        title="Debts"
        total={debtPlanned}
        note={
          view.unassignedDebtPayments > 0 ? (
            <Notice
              tone="warn"
              action={
                <Link href={`/transactions?period=${view.periodLabel}&category=Debt+Repayment`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                  Link them
                </Link>
              }
            >
              <Money value={view.unassignedDebtPayments} kind="neutral" /> of Debt Repayment isn&apos;t linked to a bill yet.
            </Notice>
          ) : undefined
        }
      >
        {debtLines.map((l) => {
          const min = l.minimum ?? l.minPayment ?? 0;
          const parked = l.balance != null && !isSnowballDebt({ apr: l.apr, balance: l.balance });
          const moved = l.balance != null && l.balanceStart != null && l.balance !== l.balanceStart ? l.balance - l.balanceStart : null;
          const lineExtra = Math.max(0, l.planned - min);
          const note =
            l.rebalance > 0 ? (
              // Payments that only covered this month's new charges rebalance the card — that
              // spending is already in its categories, so it isn't payoff.
              <span className="text-fg-3">
                <Money value={l.paid} kind="neutral" /> paid · <Money value={l.rebalance} kind="neutral" /> covered new
                charges
              </span>
            ) : lineExtra > 0 ? (
              <span className="text-owed">
                +<Money value={lineExtra} kind="owed" sign="none" /> extra
              </span>
            ) : parked ? (
              <span className="text-fg-3">Minimum only</span>
            ) : l.linkedBillId == null ? (
              <span className="text-warn">No bill linked</span>
            ) : null;
          const behind = l.standing && l.standing.total > 0 ? <CardBehind standing={l.standing} /> : null;
          return (
            <Envelope
              key={l.id}
              icon={l.isTarget ? "flag" : parked ? "clock-3" : "credit-card"}
              title={l.label}
              subtitle={
                <>
                  {l.balance != null ? (
                    <>
                      <Money value={l.balance} kind="owed" /> owed
                    </>
                  ) : (
                    "balance not recorded"
                  )}
                  {l.apr != null && ` · ${l.apr.toFixed(1)}%`}
                  {moved != null && (
                    <>
                      {" · "}
                      <Money value={moved} kind={moved < 0 ? "income" : "over"} sign="always" />
                    </>
                  )}
                </>
              }
              color={COLORS.debt}
              tone="pay"
              planned={l.planned}
              used={l.actual}
              usedLabel="paid off"
              aside={
                note || behind ? (
                  <>
                    {note}
                    {behind}
                  </>
                ) : undefined
              }
              open={!l.locked && !isSink(l)}
              auto={isSink(l)}
              pending={pending}
              onToggle={() => toggle(l)}
              onRemove={() => run(() => deleteBudgetLine(l.id))}
              control={
                <div className="space-y-3">
                  {controlFor(l, min, Math.max(500, Math.ceil(Math.max(l.planned * 1.5, l.balance ?? 0) / 50) * 50), COLORS.debt)}
                  {!l.isTarget && !parked && (
                    <Button
                      size="sm"
                      variant="soft"
                      icon="flag"
                      onClick={() =>
                        run(async () => {
                          const r = await setBudgetTarget(view.id, l.id);
                          // Pointing the extra by hand is the Manual strategy.
                          if (r.ok && view.strategy) await updateBudget(view.id, { strategy: null });
                          return r;
                        })
                      }
                    >
                      Make this the target
                    </Button>
                  )}
                </div>
              }
            />
          );
        })}
        <AddEnvelope kind="debt" view={view} categories={categories} pending={pending} run={run} />
      </Group>

      {/* ---- Everyday ---- */}
      <Group
        title="Everyday"
        total={spendPlanned}
        sub={
          <>
            <Money value={spendActual} kind="neutral" /> spent
            {paceFrac != null && <span className="max-sm:hidden"> · thin line = where you&apos;d be on pace today</span>}
          </>
        }
      >
        {spendLines.map((l) => (
          <Envelope
            key={l.id}
            emoji={l.emoji}
            title={l.label}
            href={l.category ? `/transactions?period=${view.periodLabel}&category=${encodeURIComponent(l.category)}` : null}
            color={l.color ?? COLORS.spend}
            planned={l.planned}
            used={l.actual}
            marker={paceFrac != null ? l.planned * paceFrac : null}
            open={!l.locked}
            pending={pending}
            onToggle={() => toggle(l)}
            onRemove={() => run(() => deleteBudgetLine(l.id))}
            control={controlFor(l, 0, Math.max(200, Math.ceil(Math.max(l.planned * 2, l.actual * 1.2) / 50) * 50), l.color ?? COLORS.spend)}
          />
        ))}
        <AddEnvelope kind="category" view={view} categories={categories} pending={pending} run={run} />
      </Group>

      {/* ---- Savings ---- */}
      <Group title="Savings" total={savingsPlanned} sub="money you intend to keep">
        {savingsLines.map((l) => (
          <Envelope
            key={l.id}
            emoji={l.emoji}
            icon="piggy-bank"
            title={l.label}
            subtitle={
              view.cash.start != null ? (
                <>
                  Cash <Money value={view.cash.start} kind="neutral" /> at month start
                </>
              ) : undefined
            }
            color={l.color ?? COLORS.savings}
            tone="save"
            planned={l.planned}
            used={cashProjected != null ? Math.max(0, cashProjected) : null}
            usedLabel="projected kept"
            remainingLabel={
              cashProjected == null ? (
                "record balances to project"
              ) : cashProjected >= l.planned ? (
                <span className="text-income">On track if the plan holds</span>
              ) : (
                <>short if the plan holds</>
              )
            }
            open={!l.locked}
            pending={pending}
            onToggle={() => toggle(l)}
            onRemove={() => run(() => deleteBudgetLine(l.id))}
            control={controlFor(l, 0, Math.max(1000, Math.ceil((l.planned * 2) / 50) * 50), l.color ?? COLORS.savings)}
          />
        ))}
        {savingsLines.length === 0 && <AddEnvelope kind="savings" view={view} categories={categories} pending={pending} run={run} />}
      </Group>

      {/* ---- Payoff ---- */}
      {projection && debtLines.length > 0 && <PayoffCallout projection={projection} monthlyBudget={projectionBudget} />}

      {err && <Notice tone="danger">{err}</Notice>}

      <div className="text-xs text-fg-3">
        {!confirmDel ? (
          <button type="button" onClick={() => setConfirmDel(true)} className="hover:text-over">
            Delete this budget
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span>Delete this month&apos;s budget? Transactions are untouched.</span>
            <Button size="sm" variant="danger" icon="trash-2" onClick={() => run(() => deleteBudget(view.id))}>
              Delete budget
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
              Keep it
            </Button>
          </span>
        )}
      </div>

      {dock && <BalanceDock message={dock.message} detail={dock.detail} onLockAll={lockAll} />}
    </div>
  );
}

// ---- Pieces --------------------------------------------------------------------------------

function Group({ title, total, sub, note, children }: { title: string; total: number; sub?: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        <div className="text-[13px] text-fg-3 text-right">
          {sub && <span className="mr-3">{sub}</span>}
          <Money value={total} kind="neutral" className="font-semibold text-fg" />
        </div>
      </div>
      {note && <div className="mb-3">{note}</div>}
      <div className="mp-grid" style={{ "--cols": 3 } as React.CSSProperties}>
        {children}
      </div>
    </section>
  );
}

/** The hero: income as the page's one 48px number, editable in place. */
function IncomeTile({ value, sub, onCommit }: { value: number | null; sub: React.ReactNode; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  const label = (
    <span className="inline-flex items-center gap-1">
      Income this month
      {text == null && <IconButton icon="pencil-line" size="sm" label="Edit income" className="-my-1.5" onClick={() => setText(value != null ? String(value) : "")} />}
    </span>
  );
  if (text == null) return <StatTile size="hero" label={label} value={value != null ? value : "—"} sub={sub} />;
  return (
    <StatTile
      size="hero"
      label={label}
      sub={sub}
      value={
        <Input
          autoFocus
          money
          aria-label="Income this month"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text.replace(/[$,\s]/g, ""));
            setText(null);
            if (text.trim() === "") onCommit(null);
            else if (!Number.isNaN(n) && n !== value) onCommit(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
          }}
          className="w-52 text-2xl font-semibold"
        />
      }
    />
  );
}

/** A dashed "+" card at the end of each group; opens into a small inline picker. */
function AddEnvelope({ kind, view, categories, pending, run }: { kind: "category" | "debt" | "savings"; view: BudgetViewData; categories: CategoryOption[]; pending: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [planned, setPlanned] = useState(0);
  const usedCats = new Set(view.lines.map((l) => l.category).filter(Boolean));
  const usedAccts = new Set(view.lines.map((l) => l.accountId).filter((x) => x != null));
  const catOptions = categories.filter((c) => c.active && !usedCats.has(c.name) && c.name !== SAVINGS_CATEGORY);
  const debtOptions = view.debts.filter((d) => !usedAccts.has(d.accountId));
  const label = kind === "debt" ? "Add a debt" : kind === "savings" ? "Set a savings amount" : "Add an envelope";
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx("min-h-32 rounded-card border border-dashed border-line-strong text-sm font-medium text-fg-3 transition-colors", "hover:border-accent hover:text-accent-text inline-flex items-center justify-center gap-1.5")}
      >
        <span aria-hidden>+</span> {label}
      </button>
    );
  const submit = () => {
    if (kind === "debt") {
      const d = debtOptions.find((x) => String(x.accountId) === pick);
      if (!d) return;
      run(() => addBudgetLine(view.id, { kind: "debt", label: d.label, accountId: d.accountId, planned: planned || d.minPayment || 0, minimum: d.minPayment }));
    } else if (kind === "savings") {
      run(() => addBudgetLine(view.id, { kind: "savings", label: SAVINGS_CATEGORY, category: SAVINGS_CATEGORY, planned }));
    } else {
      if (!pick) return;
      run(() => addBudgetLine(view.id, { kind: "category", label: pick, category: pick, planned }));
    }
    setOpen(false);
    setPick("");
    setPlanned(0);
  };
  return (
    <div className="mp-card p-4 space-y-3 border-accent ring-2 ring-accent/25 motion-safe:animate-[rise_.2s_ease-out]">
      <div className="text-sm font-medium">{label}</div>
      {kind === "category" && <ColorSelect value={pick} options={catOptions} onSelect={setPick} allowEmpty placeholder="Pick a category" />}
      {kind === "debt" && (
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="mp-select w-full" aria-label="Debt">
          <option value="">Pick a debt…</option>
          {debtOptions.map((d) => (
            <option key={d.accountId} value={d.accountId}>
              {d.label} · {formatMoney(d.balance)}
            </option>
          ))}
        </select>
      )}
      <AmountControl value={planned} max={2000} step={25} sliderStep={5} ariaLabel="Planned amount" onCommit={setPlanned} onPreview={setPlanned} />
      <div className="flex items-center gap-2">
        <Button size="sm" icon="plus" onClick={submit} disabled={pending || (kind !== "savings" && !pick)}>
          {kind === "savings" ? "Set savings" : kind === "debt" ? "Add debt" : "Add envelope"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * "You're behind on this card": the dashboard's card-rebalance figure (balance + pending vs. the
 * month's start, or vs. the plan's balance once the payoff is paid) plus what the plan still expects — server/lib/card-rebalance.ts `cardStanding`.
 * Pending is included, as on the dashboard, and said so.
 */
function CardBehind({ standing: s }: { standing: NonNullable<BudgetLineRow["standing"]> }) {
  const pending =
    s.pending > 0 ? (
      <>
        {" "}
        (incl. <Money value={s.pending} kind="neutral" sign="none" /> pending)
      </>
    ) : null;
  return (
    <div className="flex items-start gap-1.5 text-owed [&:not(:first-child)]:mt-1">
      <Icon name="triangle-alert" size={13} className="mt-px shrink-0" />
      <span>
        {s.toCover > 0 ? (
          <>
            Pay <Money value={s.toCover} kind="owed" sign="none" /> more to cover this month&apos;s spending{pending}
            {s.toPlan > 0 && (
              <>
                {" "}· <Money value={s.toPlan} kind="owed" sign="none" /> more to reach the plan
              </>
            )}
          </>
        ) : (
          <>
            Pay <Money value={s.toPlan} kind="owed" sign="none" /> more to reach this month&apos;s plan{pending}
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Is there money no envelope accounts for? Month-end cash growth beyond the savings lines — the
 * rule and its caveats are in server/lib/budget.ts `budgetExcess`. Always says something, so "no
 * excess" is a statement and not an absence.
 */
function ExcessLine({ excess: x, finished }: { excess: ReturnType<typeof budgetExcess>; finished: boolean }) {
  if (x.excess == null) return null;
  const ends = finished ? "ended" : "is on track to end";
  const sources = [
    x.incomeAbovePlan >= EXCESS_THRESHOLD && (
      <span key="income">
        <Money value={x.incomeAbovePlan} kind="neutral" whole /> income above plan
      </span>
    ),
    x.unallocated >= EXCESS_THRESHOLD && (
      <span key="unallocated">
        <Money value={x.unallocated} kind="neutral" whole /> not in any envelope
      </span>
    ),
  ].filter(Boolean);
  if (x.excess >= EXCESS_THRESHOLD)
    return (
      <div className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-sm">
        <Icon name="piggy-bank" size={16} className="mt-0.5 shrink-0 text-income" />
        <p className="min-w-0">
          <span className="font-medium">
            <Money value={x.excess} kind="income" whole /> unbudgeted
          </span>
          <span className="text-fg-3">
            {" "}
            — the month {ends} with this much more cash than the plan accounts for
            {sources.length > 0 && <> · {sources.flatMap((el, i) => (i ? [" · ", el] : [el]))}</>}. Give it a job: extra to debt or a savings line.
          </span>
        </p>
      </div>
    );
  if (x.excess <= -EXCESS_THRESHOLD)
    return (
      <div className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-sm text-fg-3">
        <Icon name="circle-alert" size={16} className="mt-0.5 shrink-0 text-over" />
        <p className="min-w-0">
          No unbudgeted money — the month {ends} <Money value={-x.excess} kind="over" whole /> short of the plan.
        </p>
      </div>
    );
  return (
    <p className="mt-4 border-t border-line pt-4 text-sm text-fg-3">No unbudgeted money — the plan accounts for every dollar.</p>
  );
}

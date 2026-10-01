"use client";

import { useState, useTransition } from "react";
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
import { SAVINGS_CATEGORY } from "@/constants/enums";
import { formatMoney } from "@/server/lib/money";
import { shortMonthLabel } from "@/server/lib/period";
import { isSnowballDebt, type PayoffProjection } from "@/server/lib/budget";
import { ProjectionSummary } from "@/components/budget/ProjectionSummary";
import type { BudgetView as BudgetViewData, BudgetLineRow, CategoryOption } from "@/server/queries";
import { Envelope } from "@/components/budget/Envelope";
import { FlowBar } from "@/components/budget/FlowBar";
import { Stat } from "@/components/budget/Stat";
import { BalanceDock } from "@/components/budget/BalanceDock";
import { AmountControl } from "@/components/budget/AmountControl";

const COLORS = { debt: "#f97316", spend: "#6366f1", savings: "#10b981", extra: "#0ea5e9", over: "#ef4444", free: "#a3a3a3" };

type Run = (fn: () => Promise<{ ok: boolean; error?: string } | void>) => void;

/**
 * The month as a board of envelopes. One bar says where income goes; a row of quiet numbers
 * says how the month is running; then the envelopes, grouped. Tap an envelope to open it and
 * change the amount — open envelopes trade with each other, or with the target when only one is
 * open. Nothing else competes for attention.
 */
export function BudgetView({
  view,
  projection,
  projectionBudget,
  categories,
  cashWidget,
  projectedEndCash = null,
}: {
  view: BudgetViewData;
  pretty: string;
  projection: PayoffProjection | null;
  projectionBudget: number;
  categories: CategoryOption[];
  cashWidget?: React.ReactNode;
  projectedEndCash?: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const refresh = () => router.refresh();
  const run: Run = (fn) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (r && !r.ok) setErr(r.error ?? "Failed");
      refresh();
    });
  const setPlanned = (line: BudgetLineRow, v: number) =>
    start(async () => {
      setErr(null);
      const r = await setBudgetLinePlanned(view.id, line.id, v);
      if (!r.ok) setErr(r.error ?? "Failed");
      else setNote(r.absorbed?.length ? r.absorbed.map((a) => `${a.label} ${formatMoney(a.from)} → ${formatMoney(a.to)}`).join(" · ") : null);
      refresh();
    });
  const toggle = (l: BudgetLineRow) => run(() => updateBudgetLine(l.id, { locked: !l.locked }));
  const lockAll = () =>
    start(async () => {
      for (const l of view.lines.filter((x) => !x.locked)) await updateBudgetLine(l.id, { locked: true });
      setNote(null);
      refresh();
    });

  const debtLines = view.lines.filter((l) => l.kind === "debt");
  const spendLines = view.lines.filter((l) => l.kind === "category");
  const savingsLines = view.lines.filter((l) => l.kind === "savings");
  const target = debtLines.find((l) => l.isTarget) ?? null;
  const isSink = (l: BudgetLineRow) => view.autoRebalance && l.isTarget;

  const sum = (ls: BudgetLineRow[], k: "planned" | "actual") => ls.reduce((s, l) => s + l[k], 0);
  const income = view.plannedIncome;
  const debtPlanned = sum(debtLines, "planned");
  const spendPlanned = sum(spendLines, "planned");
  const savingsPlanned = sum(savingsLines, "planned");
  const minimums = debtLines.reduce((s, l) => s + Math.min(l.planned, l.minimum ?? l.minPayment ?? l.planned), 0);
  const extra = Math.max(0, debtPlanned - minimums);
  const plannedTotal = debtPlanned + spendPlanned + savingsPlanned;
  const spent = sum(debtLines, "actual") + sum(spendLines, "actual");
  const free = income != null ? income - plannedTotal : null;
  const cashProjected = view.cash.start != null && projectedEndCash != null ? projectedEndCash - view.cash.start : null;

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
    <div className="space-y-12 pb-24">
      {/* ---- The month at a glance ---- */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Income this month</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl md:text-5xl font-semibold tabular-nums tracking-tight">{income != null ? formatMoney(income) : "—"}</span>
              <IncomeEdit value={income} onCommit={(v) => run(() => updateBudget(view.id, { plannedIncome: v }))} />
            </div>
            <div className="mt-1 text-sm text-neutral-500 tabular-nums">{formatMoney(view.actualIncome)} landed so far</div>
          </div>
          <label className="flex items-center gap-3 text-sm select-none cursor-pointer">
            <span className="text-neutral-500">Auto-rebalance to {target ? target.label : "the target"}</span>
            <Switch on={view.autoRebalance} disabled={pending || !target} onChange={(on) => run(() => updateBudget(view.id, { autoRebalance: on }))} />
          </label>
        </div>

        <FlowBar
          total={income ?? plannedTotal}
          segments={[
            { label: "Debt minimums", value: minimums, color: COLORS.debt },
            { label: "Extra to snowball", value: extra, color: COLORS.extra },
            { label: "Everyday", value: spendPlanned, color: COLORS.spend },
            { label: "Savings", value: savingsPlanned, color: COLORS.savings },
            ...(free != null && free > 0.5 ? [{ label: "Unallocated", value: free, color: COLORS.free, muted: true }] : []),
            ...(free != null && free < -0.5 ? [{ label: "Over income", value: -free, color: COLORS.over }] : []),
          ]}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6">
          <Stat label="Spent so far" value={formatMoney(spent)} hint={`of ${formatMoney(debtPlanned + spendPlanned)} planned`} tone={spent > debtPlanned + spendPlanned ? "bad" : undefined} />
          <Stat label="Left to spend" value={formatMoney(Math.max(0, spendPlanned - sum(spendLines, "actual")))} hint="everyday envelopes" />
          <Stat label="Extra to snowball" value={formatMoney(extra)} hint={target ? `on ${target.label}` : "no target"} tone="accent" />
          <Stat
            label="Cash by month end"
            value={projectedEndCash != null ? formatMoney(projectedEndCash) : "—"}
            hint={cashProjected != null ? <span className={cashProjected >= savingsPlanned ? "text-emerald-600 dark:text-emerald-400" : ""}>{cashProjected >= 0 ? "+" : "−"}{formatMoney(Math.abs(cashProjected))} vs month start{savingsPlanned > 0 && (cashProjected >= savingsPlanned ? " · savings on track" : " · short of savings")}</span> : "record a balance to project"}
          />
        </div>
      </section>

      {cashWidget}

      {/* ---- Debts ---- */}
      <Group title="Debts" total={debtPlanned} note={view.unassignedDebtPayments > 0 ? `${formatMoney(view.unassignedDebtPayments)} of Debt Repayment isn't linked to a bill yet` : undefined} noteHref={view.unassignedDebtPayments > 0 ? `/transactions?period=${view.periodLabel}&category=Debt+Repayment` : undefined}>
        {debtLines.map((l) => {
          const min = l.minimum ?? l.minPayment ?? 0;
          const parked = l.balance != null && !isSnowballDebt({ apr: l.apr, balance: l.balance });
          const moved = l.balance != null && l.balanceStart != null && l.balance !== l.balanceStart ? l.balance - l.balanceStart : null;
          const lineExtra = Math.max(0, l.planned - min);
          return (
            <Envelope
              key={l.id}
              emoji={l.isTarget ? "⛄" : parked ? "🧊" : "💳"}
              title={l.label}
              subtitle={
                <>
                  {l.balance != null ? `${formatMoney(l.balance)} owed` : "balance not recorded"}
                  {l.apr != null && ` · ${l.apr.toFixed(1)}%`}
                  {moved != null && <span className={moved < 0 ? " text-emerald-600" : " text-red-600"}> · {moved < 0 ? "−" : "+"}{formatMoney(Math.abs(moved))}</span>}
                </>
              }
              color={l.isTarget ? COLORS.extra : COLORS.debt}
              planned={l.planned}
              used={l.actual}
              usedLabel="paid"
              remainingLabel={l.actual >= l.planned ? "✓ paid" : `${formatMoney(l.planned - l.actual)} to go`}
              aside={
                lineExtra > 0 ? <span className="text-sky-600 dark:text-sky-400 tabular-nums">+{formatMoney(lineExtra)} extra</span> : parked ? <span className="text-neutral-400">minimum only</span> : l.linkedBillId == null ? <span className="text-amber-600">no bill linked</span> : undefined
              }
              open={!l.locked && !isSink(l)}
              auto={isSink(l)}
              pending={pending}
              onToggle={() => toggle(l)}
              onRemove={() => run(() => deleteBudgetLine(l.id))}
              control={
                <div className="space-y-3">
                  {controlFor(l, min, Math.max(500, Math.ceil(Math.max(l.planned * 1.5, l.balance ?? 0) / 50) * 50), l.isTarget ? COLORS.extra : COLORS.debt)}
                  {!l.isTarget && !parked && (
                    <button type="button" onClick={() => run(() => setBudgetTarget(view.id, l.id))} className="text-xs text-indigo-600 hover:underline">
                      Make this the snowball target
                    </button>
                  )}
                </div>
              }
            />
          );
        })}
        <AddEnvelope kind="debt" view={view} categories={categories} pending={pending} run={run} />
      </Group>

      {/* ---- Everyday ---- */}
      <Group title="Everyday" total={spendPlanned} sub={`${formatMoney(sum(spendLines, "actual"))} spent`}>
        {spendLines.map((l) => (
          <Envelope
            key={l.id}
            emoji={l.emoji}
            title={l.label}
            href={l.category ? `/transactions?period=${view.periodLabel}&category=${encodeURIComponent(l.category)}` : null}
            color={l.color ?? COLORS.spend}
            planned={l.planned}
            used={l.actual}
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
            emoji={l.emoji ?? "💴"}
            title={l.label}
            subtitle={view.cash.start != null ? `cash ${formatMoney(view.cash.start)} at month start` : undefined}
            color={l.color ?? COLORS.savings}
            planned={l.planned}
            used={cashProjected != null ? Math.max(0, cashProjected) : null}
            usedLabel="projected kept"
            remainingLabel={
              cashProjected == null ? "record balances to project" : cashProjected >= l.planned ? <span className="text-emerald-600 dark:text-emerald-400">✓ on track if the plan holds</span> : `${formatMoney(l.planned - cashProjected)} short if the plan holds`
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
      {projection && debtLines.length > 0 && (
        <section className="rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 p-6 md:p-8">
          <div className="text-[11px] uppercase tracking-[0.14em] opacity-60">If this plan holds</div>
          <p className="mt-2 text-lg md:text-xl leading-snug max-w-3xl [&_strong]:font-semibold [&_strong]:underline [&_strong]:decoration-sky-400 [&_strong]:decoration-2 [&_strong]:underline-offset-4 [&_span]:opacity-70">
            <ProjectionSummary projection={projection} monthlyBudget={projectionBudget} />
          </p>
          {projection.debtFreeOn && (
            <ol className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              {projection.steps.map((s, i) => (
                <li key={s.accountId} className="flex items-baseline gap-2">
                  <span className="text-xs opacity-50 tabular-nums">{i + 1}</span>
                  <span>{s.label}</span>
                  <span className="opacity-60 tabular-nums">{Number.isFinite(s.monthsToPayoff) ? shortMonthLabel(s.paidOffOn) : "—"}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      <div className="text-xs text-neutral-400">
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} className="hover:text-red-600">
            Delete this budget
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span>Delete this month&apos;s budget? Transactions are untouched.</span>
            <button onClick={() => run(() => deleteBudget(view.id))} className="text-red-600 font-medium hover:underline">
              delete
            </button>
            <button onClick={() => setConfirmDel(false)} className="hover:underline">
              keep
            </button>
          </span>
        )}
      </div>

      {dock && <BalanceDock message={dock.message} detail={dock.detail} onLockAll={lockAll} />}
    </div>
  );
}

// ---- Pieces --------------------------------------------------------------------------------

function Group({ title, total, sub, note, noteHref, children }: { title: string; total: number; sub?: string; note?: string; noteHref?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="text-sm text-neutral-500 tabular-nums">
          {sub && <span className="mr-3">{sub}</span>}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{formatMoney(total)}</span>
        </div>
      </div>
      {note && (
        <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
          {note}
          {noteHref && (
            <>
              {" "}
              <a href={noteHref} className="underline">
                link them →
              </a>
            </>
          )}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-700"}`}>
      <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: on ? "translateX(20px)" : undefined }} />
    </button>
  );
}

function IncomeEdit({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (text == null)
    return (
      <button type="button" onClick={() => setText(value != null ? String(value) : "")} className="text-xs text-neutral-400 hover:text-indigo-600 underline underline-offset-4 decoration-dotted">
        edit
      </button>
    );
  return (
    <input
      autoFocus
      inputMode="decimal"
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
      className="w-36 rounded-lg border border-indigo-400 bg-transparent px-2 py-1 text-lg font-semibold tabular-nums outline-none ring-2 ring-indigo-400/20"
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
      <button type="button" onClick={() => setOpen(true)} className="min-h-32 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
        + {label}
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
  const sel = "h-10 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm";
  return (
    <div className="rounded-2xl border border-indigo-400/70 ring-1 ring-indigo-400/40 bg-white dark:bg-neutral-900 p-4 space-y-3 motion-safe:animate-[rise_.2s_ease-out]">
      <div className="text-sm font-medium">{label}</div>
      {kind === "category" && (
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={sel}>
          <option value="">Pick a category…</option>
          {catOptions.map((c) => (
            <option key={c.name} value={c.name}>
              {c.emoji ? `${c.emoji} ` : ""}
              {c.name}
            </option>
          ))}
        </select>
      )}
      {kind === "debt" && (
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={sel}>
          <option value="">Pick a debt…</option>
          {debtOptions.map((d) => (
            <option key={d.accountId} value={d.accountId}>
              {d.label} · {formatMoney(d.balance)}
            </option>
          ))}
        </select>
      )}
      <AmountControl value={planned} max={2000} step={25} sliderStep={5} ariaLabel="Planned amount" onCommit={setPlanned} onPreview={setPlanned} />
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={pending || (kind !== "savings" && !pick)} className="h-9 rounded-full bg-neutral-900 dark:bg-white px-4 text-sm font-medium text-white dark:text-neutral-900 disabled:opacity-40">
          Add
        </button>
        <button onClick={() => setOpen(false)} className="text-sm text-neutral-500 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBudget } from "@/server/actions/budget";
import { BUDGET_MODES, BUDGET_MODE_META, DEBT_STRATEGIES, DEBT_STRATEGY_META, type BudgetMode, type DebtStrategy } from "@/constants/enums";
import { buildSnowballPlan, suggestSpendingLines, projectPayoff, scaleRowsTo, moveRowKeepingExtra, isSnowballDebt, round2, type PlannedLine, type SliderRow } from "@/server/lib/budget";
import { formatMoney } from "@/server/lib/money";
import { shortMonthLabel } from "@/server/lib/period";
import type { BudgetInputs } from "@/server/queries";
import { Envelope } from "@/components/budget/Envelope";
import { FlowBar } from "@/components/budget/FlowBar";
import { Stat } from "@/components/budget/Stat";
import { BalanceDock } from "@/components/budget/BalanceDock";
import { AmountControl } from "@/components/budget/AmountControl";
import { ProjectionSummary } from "@/components/budget/ProjectionSummary";

const COLORS = { debt: "#f97316", spend: "#6366f1", savings: "#10b981", extra: "#0ea5e9", over: "#ef4444" };
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};
const roundUp10 = (n: number) => Math.ceil(n / 10) * 10;
type Row = SliderRow & { months: number[] };

/**
 * First-run wizard, in the board's language: pick how to start, then the same envelope board
 * you'll live in afterwards — one flow bar, two special envelopes (Extra to snowball, Savings),
 * the everyday envelopes, the debts in order, and one sentence about where it leads. Everything
 * starts locked; open an envelope to change it.
 */
export function BudgetSetup({ periodLabel, pretty, year, month, inputs }: { periodLabel: string; pretty: string; year: number; month: number; inputs: BudgetInputs }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<BudgetMode>("debt_snowball");
  const [strategy, setStrategy] = useState<DebtStrategy>("snowball");
  const [income, setIncome] = useState(inputs.defaultIncome != null ? String(inputs.defaultIncome) : "");
  const [auto, setAuto] = useState(true);
  const [savings, setSavings] = useState(0);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const prev = inputs.previous;
  const [cf, setCf] = useState<PlannedLine[]>(() => (prev ? prev.lines.map((l) => ({ ...l, locked: true })) : []));
  const [cfIncome, setCfIncome] = useState(prev?.plannedIncome != null ? String(prev.plannedIncome) : inputs.defaultIncome != null ? String(inputs.defaultIncome) : "");

  const minimums = round2(inputs.debts.reduce((s, d) => s + (d.balance > 0 ? d.minPayment ?? 0 : 0), 0));
  const incomeN = num(income) ?? 0;
  const pie = Math.max(0, round2(incomeN - minimums - savings));

  const suggestedRows = (): Row[] =>
    suggestSpendingLines(inputs.history.map((h) => h.rows)).map((s) => ({
      category: s.category,
      planned: s.planned,
      locked: true,
      suggested: s.planned,
      max: Math.max(100, roundUp10(Math.max(s.planned * 2, Math.max(...s.months) * 1.1))),
      months: s.months,
    }));
  const [rows, setRows] = useState<Row[]>(() => {
    const r = suggestedRows();
    const total = r.reduce((s, x) => s + x.planned, 0);
    const fitted = total > pie ? (scaleRowsTo(r.map((x) => ({ ...x, locked: false })), pie) as Row[]) : r;
    return fitted.map((x) => ({ ...x, locked: true }));
  });
  const historyLabels = inputs.history.map((h) => shortMonthLabel(h.label));
  const catMeta = new Map(inputs.categories.map((c) => [c.name, c]));

  const spendTotal = rows.reduce((s, r) => s + r.planned, 0);
  const leftover = round2(pie - spendTotal);
  const extra = Math.max(0, leftover);
  const shortfall = Math.max(0, -leftover);
  const openRows = rows.filter((r) => !r.locked);

  const setRow = (i: number, v: number) =>
    setRows((rs) => {
      if (auto) return moveRowKeepingExtra(rs, i, v) as Row[];
      const out = rs.map((r) => ({ ...r }));
      out[i].planned = Math.min(out[i].max, Math.max(0, Math.round(v)));
      return out;
    });
  const setExtra = (e: number) => setRows((rs) => scaleRowsTo(rs, pie - e) as Row[]);
  const toggleRow = (i: number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, locked: !r.locked } : r)));
  const lockAll = () => {
    setRows((rs) => rs.map((r) => ({ ...r, locked: true })));
    setSavingsOpen(false);
    setExtraOpen(false);
  };
  const onIncome = (s: string) => {
    setIncome(s);
    const newPie = Math.max(0, round2((num(s) ?? 0) - minimums - savings));
    if (auto && spendTotal > newPie) setRows((rs) => scaleRowsTo(rs.map((r) => ({ ...r, locked: false })), newPie).map((r, i) => ({ ...r, locked: rs[i].locked })) as Row[]);
  };
  const onSavings = (v: number) => {
    const sv = Math.max(0, Math.round(v));
    setSavings(sv);
    const newPie = Math.max(0, round2(incomeN - minimums - sv));
    if (auto && spendTotal > newPie) setRows((rs) => scaleRowsTo(rs, newPie) as Row[]);
  };

  const spending = rows.filter((r) => r.planned > 0).map((r) => ({ category: r.category, planned: r.planned }));
  const lockedCats = new Set(rows.filter((r) => r.locked).map((r) => r.category));
  const plan = (() => {
    const p = buildSnowballPlan({ income: incomeN, debts: inputs.debts, strategy, spending, savings });
    return { ...p, lines: p.lines.map((l) => ({ ...l, locked: l.kind === "category" && l.category ? lockedCats.has(l.category) : true })) };
  })();
  const debtLines = plan.lines.filter((l) => l.kind === "debt");
  const debtOf = new Map(inputs.debts.map((d) => [d.accountId, d]));
  const isHot = (l: PlannedLine) => {
    const d = debtOf.get(l.accountId!);
    return !!d && isSnowballDebt(d);
  };
  const debtBudget = round2(debtLines.reduce((s, l) => s + l.planned, 0));
  const hotBudget = round2(debtLines.filter(isHot).reduce((s, l) => s + l.planned, 0));
  const target = debtLines.find((l) => l.isTarget) ?? null;
  const projection = debtLines.some(isHot) ? projectPayoff({ debts: inputs.debts, strategy, monthlyBudget: hotBudget, startYear: year, startMonth: month }) : null;

  const create = () => {
    setError(null);
    start(async () => {
      const lines: PlannedLine[] = mode === "debt_snowball" ? plan.lines : mode === "carry_forward" ? cf.filter((l) => l.planned > 0 || l.kind === "debt") : [];
      const res = await createBudget({
        periodLabel,
        mode,
        strategy: mode === "debt_snowball" ? strategy : mode === "carry_forward" ? prev?.strategy ?? null : null,
        plannedIncome: mode === "carry_forward" ? num(cfIncome) : num(income),
        autoRebalance: (mode === "debt_snowball" && auto) || (mode === "carry_forward" && !!prev?.autoRebalance),
        lines,
      });
      if (!res.ok) return setError(res.error ?? "Could not create the budget.");
      router.refresh();
    });
  };

  const openNames = [...(extraOpen ? ["Extra to snowball"] : []), ...(savingsOpen ? ["Savings"] : []), ...openRows.map((r) => r.category)];
  const dock =
    mode !== "debt_snowball" || openNames.length === 0
      ? null
      : openNames.length === 1
        ? { message: `${openNames[0]} is open.`, detail: auto ? "Changes flow to Extra to snowball. Open another envelope to trade between them." : "Changes move the leftover." }
        : { message: openNames.join(" ↔ "), detail: "What you add to one comes out of the others." };

  return (
    <div className="space-y-12 pb-24">
      {/* ---- How to start ---- */}
      <section>
        <div className="grid gap-3 sm:grid-cols-3">
          {BUDGET_MODES.map((m) => {
            const meta = BUDGET_MODE_META[m];
            const on = m === mode;
            const unavailable = m === "carry_forward" && !prev;
            return (
              <button
                key={m}
                type="button"
                disabled={unavailable}
                onClick={() => setMode(m)}
                className={`text-left rounded-2xl border p-4 transition-all disabled:opacity-40 ${on ? "border-indigo-400/70 ring-1 ring-indigo-400/40 bg-white dark:bg-neutral-900 shadow-[0_8px_30px_-12px_rgba(99,102,241,0.45)]" : "border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300"}`}
              >
                <div className="text-2xl" aria-hidden>
                  {meta.emoji}
                </div>
                <div className="mt-2 font-medium">
                  {meta.label}
                  {m === "carry_forward" && prev && <span className="ml-1 font-normal text-neutral-500">· {shortMonthLabel(prev.fromLabel)}</span>}
                </div>
                <div className="mt-1 text-xs text-neutral-500 leading-snug">{unavailable ? "No earlier budget to copy yet." : meta.blurb}</div>
              </button>
            );
          })}
        </div>
      </section>

      {mode === "carry_forward" && prev && <CarryForward prevLabel={prev.fromLabel} lines={cf} setLines={setCf} income={cfIncome} setIncome={setCfIncome} catMeta={catMeta} debts={inputs.debts} pending={pending} />}

      {mode !== "carry_forward" && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Take-home for {pretty}</div>
              <div className="mt-1 relative">
                <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-3xl md:text-4xl font-semibold text-neutral-300">$</span>
                <input inputMode="decimal" value={income} onChange={(e) => onIncome(e.target.value)} placeholder="0" className="w-64 bg-transparent pl-7 text-4xl md:text-5xl font-semibold tabular-nums tracking-tight outline-none border-b-2 border-transparent focus:border-indigo-400" />
              </div>
              <div className="mt-1 text-sm text-neutral-500">
                {inputs.defaultIncome != null ? "From your pay schedule — paychecks landing this month × take-home per check." : "No pay schedule with a take-home yet."}
                {inputs.billsTotal > 0 && ` Bill sheet: ${formatMoney(inputs.billsTotal)}.`}
              </div>
            </div>
            {mode === "debt_snowball" && (
              <label className="flex items-center gap-3 text-sm select-none cursor-pointer">
                <span className="text-neutral-500">Keep the plan balanced</span>
                <Switch on={auto} onChange={setAuto} />
              </label>
            )}
          </div>

          {mode === "debt_snowball" && (
            <>
              <FlowBar
                total={incomeN}
                segments={[
                  { label: "Debt minimums", value: minimums, color: COLORS.debt },
                  { label: "Extra to snowball", value: extra, color: COLORS.extra },
                  { label: "Everyday", value: spendTotal, color: COLORS.spend },
                  { label: "Savings", value: savings, color: COLORS.savings },
                  ...(shortfall > 0 ? [{ label: "Short", value: shortfall, color: COLORS.over }] : []),
                ]}
              />
              {shortfall > 0 && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Everyday spending outruns the month by {formatMoney(shortfall)}. Trim an envelope, or turn on &ldquo;Keep the plan balanced&rdquo; and it fits itself.
                </p>
              )}
              {projection && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6">
                  <Stat label="Toward debt" value={formatMoney(debtBudget)} hint={`${formatMoney(minimums)} minimums`} />
                  <Stat label="Extra" value={formatMoney(extra)} hint={target ? `on ${target.label}` : "no target"} tone="accent" />
                  <Stat label="High-interest gone" value={projection.debtFreeOn ? shortMonthLabel(projection.debtFreeOn) : "—"} hint={projection.debtFreeOn ? `${projection.months} months` : "payments don't outrun interest"} tone={projection.debtFreeOn ? "good" : "bad"} />
                  <Stat label="Interest paid" value={formatMoney(projection.totalInterest)} hint={projection.minimumsOnly ? `vs ${formatMoney(projection.minimumsOnly.totalInterest)} on minimums` : undefined} />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {mode === "debt_snowball" && (
        <>
          {/* ---- The two special envelopes ---- */}
          <section className="grid gap-4 sm:grid-cols-2">
            <Envelope
              emoji="⛄"
              title="Extra to snowball"
              subtitle={target ? `lands on ${target.label} above its ${formatMoney(target.minimum)} minimum` : "no debt with a balance recorded"}
              color={COLORS.extra}
              planned={extra}
              used={null}
              remainingLabel={auto ? (openRows.length ? "draws from the open everyday envelopes" : "open an everyday envelope to draw from it") : "whatever everyday spending leaves over"}
              open={extraOpen}
              onToggle={() => setExtraOpen((o) => !o)}
              control={<AmountControl value={extra} max={pie} step={50} sliderStep={10} color={COLORS.extra} disabled={!auto || pie <= 0 || openRows.length === 0} ariaLabel="Extra to snowball" onCommit={setExtra} onPreview={setExtra} />}
            />
            <Envelope
              emoji="💴"
              title="Savings"
              subtitle="money you intend to keep"
              color={COLORS.savings}
              planned={savings}
              used={null}
              remainingLabel="never counts as spent — the check is whether cash on hand grows"
              open={savingsOpen}
              onToggle={() => setSavingsOpen((o) => !o)}
              control={<AmountControl value={savings} max={Math.max(0, Math.round(incomeN - minimums))} step={25} sliderStep={25} color={COLORS.savings} disabled={incomeN <= 0} ariaLabel="Savings to keep" onCommit={onSavings} onPreview={onSavings} />}
            />
          </section>

          {/* ---- Everyday ---- */}
          <section>
            <div className="flex items-baseline justify-between gap-4 mb-1">
              <h2 className="text-lg font-semibold tracking-tight">Everyday</h2>
              <div className="flex items-center gap-4 text-sm">
                <button type="button" onClick={() => setRows(suggestedRows())} className="text-xs text-neutral-500 hover:text-indigo-600">
                  Reset to averages
                </button>
                <span className="font-medium tabular-nums">{formatMoney(spendTotal)}</span>
              </div>
            </div>
            <p className="text-sm text-neutral-500 mb-4">Your average over {historyLabels.length ? historyLabels.slice().reverse().join(", ") : "past months"}, rounded up. Tap an envelope to change it. An envelope at $0 is left out.</p>
            {rows.length === 0 ? (
              <p className="text-sm text-neutral-500">Nothing to suggest yet — add envelopes after creating.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((r, i) => {
                  const meta = catMeta.get(r.category);
                  return (
                    <Envelope
                      key={r.category}
                      emoji={meta?.emoji}
                      title={r.category}
                      subtitle={r.months.map((v, j) => `${historyLabels[j]} ${formatMoney(v)}`).join(" · ")}
                      color={meta?.color ?? COLORS.spend}
                      planned={r.planned}
                      used={null}
                      remainingLabel={r.planned === 0 ? <span className="text-neutral-400">left out</span> : ""}
                      open={!r.locked}
                      onToggle={() => toggleRow(i)}
                      control={<AmountControl value={r.planned} max={r.max} step={25} sliderStep={5} color={meta?.color ?? COLORS.spend} ariaLabel={`Planned for ${r.category}`} onCommit={(v) => setRow(i, v)} onPreview={(v) => setRow(i, v)} />}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- Debts in order ---- */}
          <section>
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <h2 className="text-lg font-semibold tracking-tight">Debts, in order</h2>
              <select value={strategy} onChange={(e) => setStrategy(e.target.value as DebtStrategy)} className="h-9 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm">
                {DEBT_STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {DEBT_STRATEGY_META[s].label}
                  </option>
                ))}
              </select>
            </div>
            {debtLines.length === 0 ? (
              <p className="text-sm text-neutral-500">No liabilities with a balance recorded. Add cards and loans on Debts first.</p>
            ) : (
              <ol className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                {debtLines.map((l, i) => {
                  const d = debtOf.get(l.accountId!);
                  const lineExtra = round2(l.planned - (l.minimum ?? 0));
                  const parked = !isHot(l);
                  return (
                    <li key={l.accountId} className={`flex items-center gap-4 px-4 py-3 ${parked ? "opacity-60" : ""}`}>
                      <span className="w-5 text-xs text-neutral-400 tabular-nums">{parked ? "—" : i + 1}</span>
                      <span className="text-lg" aria-hidden>
                        {l.isTarget ? "⛄" : parked ? "🧊" : "💳"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{l.label}</div>
                        <div className="text-xs text-neutral-500 tabular-nums">
                          {formatMoney(d?.balance)} owed{d?.apr != null && ` · ${d.apr.toFixed(1)}%`}
                          {parked && " · minimum only"}
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="font-semibold">{formatMoney(l.planned)}</div>
                        <div className={`text-xs ${lineExtra > 0 ? "text-sky-600 dark:text-sky-400" : "text-neutral-400"}`}>{lineExtra > 0 ? `+${formatMoney(lineExtra)} extra` : "minimum"}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {projection && (
              <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300 [&_strong]:font-semibold [&_strong]:text-neutral-900 dark:[&_strong]:text-white">
                <ProjectionSummary projection={projection} monthlyBudget={hotBudget} />
              </p>
            )}
          </section>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="button" onClick={create} disabled={pending} className="h-11 rounded-full bg-neutral-900 dark:bg-white px-6 text-sm font-medium text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-50">
          {pending ? "Creating…" : `Create ${pretty}`}
        </button>
        {mode === "debt_snowball" && auto && <span className="text-xs text-neutral-500">Auto-rebalance stays on afterwards.</span>}
      </div>

      {dock && <BalanceDock message={dock.message} detail={dock.detail} onLockAll={lockAll} />}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-700"}`}>
      <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: on ? "translateX(20px)" : undefined }} />
    </button>
  );
}

/** "Copy last month": the previous envelopes, locked, on the same board. */
function CarryForward({
  prevLabel,
  lines,
  setLines,
  income,
  setIncome,
  catMeta,
  debts,
  pending,
}: {
  prevLabel: string;
  lines: PlannedLine[];
  setLines: (f: (ls: PlannedLine[]) => PlannedLine[]) => void;
  income: string;
  setIncome: (s: string) => void;
  catMeta: Map<string, { emoji: string | null; color: string }>;
  debts: BudgetInputs["debts"];
  pending: boolean;
}) {
  const total = lines.reduce((s, l) => s + l.planned, 0);
  const inc = num(income) ?? 0;
  const left = round2(inc - total);
  const debtOf = new Map(debts.map((d) => [d.accountId, d]));
  const set = (i: number, patch: Partial<PlannedLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));
  const groups: { title: string; kind: PlannedLine["kind"]; color: string }[] = [
    { title: "Debts", kind: "debt", color: COLORS.debt },
    { title: "Everyday", kind: "category", color: COLORS.spend },
    { title: "Savings", kind: "savings", color: COLORS.savings },
  ];
  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Take-home · copied from {shortMonthLabel(prevLabel)}</div>
            <div className="mt-1 relative">
              <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-3xl md:text-4xl font-semibold text-neutral-300">$</span>
              <input inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} className="w-64 bg-transparent pl-7 text-4xl md:text-5xl font-semibold tabular-nums tracking-tight outline-none border-b-2 border-transparent focus:border-indigo-400" />
            </div>
          </div>
          <div className={`text-sm tabular-nums ${left < 0 ? "text-red-600" : "text-neutral-500"}`}>
            {formatMoney(total)} planned · {left >= 0 ? `${formatMoney(left)} unallocated` : `${formatMoney(-left)} over income`}
          </div>
        </div>
        <FlowBar
          total={inc}
          segments={groups.map((g) => ({ label: g.title, value: lines.filter((l) => l.kind === g.kind).reduce((s, l) => s + l.planned, 0), color: g.color }))}
        />
      </section>
      {groups.map((g) => {
        const items = lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind}>
            <h2 className="text-lg font-semibold tracking-tight mb-4">{g.title}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map(({ l, i }) => {
                const meta = l.category ? catMeta.get(l.category) : undefined;
                const d = l.accountId != null ? debtOf.get(l.accountId) : undefined;
                return (
                  <Envelope
                    key={i}
                    emoji={l.kind === "debt" ? (l.isTarget ? "⛄" : "💳") : l.kind === "savings" ? "💴" : meta?.emoji}
                    title={l.label}
                    subtitle={d ? `${formatMoney(d.balance)} owed` : undefined}
                    color={l.kind === "debt" ? (l.isTarget ? COLORS.extra : COLORS.debt) : l.kind === "savings" ? COLORS.savings : meta?.color ?? COLORS.spend}
                    planned={l.planned}
                    used={null}
                    remainingLabel=""
                    open={!l.locked}
                    pending={pending}
                    onToggle={() => set(i, { locked: !l.locked })}
                    onRemove={() => remove(i)}
                    control={<AmountControl value={l.planned} max={Math.max(500, Math.ceil((l.planned * 2) / 50) * 50)} step={25} sliderStep={5} color={meta?.color ?? COLORS.spend} ariaLabel={`Planned for ${l.label}`} onCommit={(v) => set(i, { planned: v })} onPreview={(v) => set(i, { planned: v })} />}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

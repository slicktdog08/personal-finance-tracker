"use client";

import { useState, useTransition } from "react";
import { createBudget } from "@/server/actions/budget";
import { BUDGET_MODES, BUDGET_MODE_META, DEBT_STRATEGIES, DEBT_STRATEGY_META, type BudgetMode, type DebtStrategy } from "@/constants/enums";
import { buildSnowballPlan, suggestSpendingLines, projectPayoff, scaleRowsTo, moveRowKeepingExtra, isSnowballDebt, round2, type PlannedLine, type SliderRow } from "@/server/lib/budget";
import { formatMoney } from "@/server/lib/money";
import { shortMonthLabel } from "@/server/lib/period";
import type { BudgetInputs } from "@/server/queries";
import { Button, Card, Glyph, Money, Notice, Segmented, StatTile, Switch, cx, type IconName } from "@/components/ds";
import { Envelope } from "@/components/budget/Envelope";
import { FlowBar } from "@/components/budget/FlowBar";
import { BalanceDock } from "@/components/budget/BalanceDock";
import { AmountControl } from "@/components/budget/AmountControl";
import { PayoffCallout } from "@/components/budget/PayoffCallout";
import { PLAN_COLORS as COLORS } from "@/components/budget/colors";

// Mode cards carry an icon, not the enum's emoji: no emoji in chrome.
const MODE_ICON: Record<BudgetMode, IconName> = { debt_snowball: "flag", carry_forward: "copy", manual: "pencil-line" };
const STRATEGY_SHORT: Record<DebtStrategy, string> = { snowball: "Snowball", avalanche: "Avalanche" };
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};
const roundUp10 = (n: number) => Math.ceil(n / 10) * 10;
type Row = SliderRow & { months: number[] };

/**
 * First-run wizard, in the board's language: pick how to start, then the same envelope board
 * you'll live in afterwards — one flow bar, two special envelopes (Extra to debt, Savings),
 * the everyday envelopes, the debts in order, and one sentence about where it leads. Everything
 * starts locked; open an envelope to change it.
 */
export function BudgetSetup({ periodLabel, pretty, year, month, inputs }: { periodLabel: string; pretty: string; year: number; month: number; inputs: BudgetInputs }) {
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
    });
  };

  const openNames = [...(extraOpen ? ["Extra to debt"] : []), ...(savingsOpen ? ["Savings"] : []), ...openRows.map((r) => r.category)];
  const dock =
    mode !== "debt_snowball" || openNames.length === 0
      ? null
      : openNames.length === 1
        ? { message: `${openNames[0]} is open.`, detail: auto ? "Changes flow to Extra to debt. Open another envelope to trade between them." : "Changes move the leftover." }
        : { message: openNames.join(" ↔ "), detail: "What you add to one comes out of the others." };

  return (
    <div className="space-y-8 pb-24">
      {/* ---- How to start ---- */}
      <section>
        <div className="mp-grid" style={{ "--cols": 3 } as React.CSSProperties}>
          {BUDGET_MODES.map((m) => {
            const meta = BUDGET_MODE_META[m];
            const on = m === mode;
            const unavailable = m === "carry_forward" && !prev;
            return (
              <button
                key={m}
                type="button"
                disabled={unavailable}
                aria-pressed={on}
                onClick={() => setMode(m)}
                className={cx(
                  "mp-card p-4 text-left transition-[border-color,box-shadow] disabled:opacity-40",
                  on ? "border-accent ring-2 ring-accent/25" : "hover:border-line-2 hover:shadow-hover",
                )}
              >
                <Glyph icon={MODE_ICON[m]} color={on ? "var(--mp-accent)" : undefined} />
                <div className="mt-2.5 font-medium">
                  {meta.label}
                  {m === "carry_forward" && prev && <span className="ml-1 font-normal text-fg-3">· {shortMonthLabel(prev.fromLabel)}</span>}
                </div>
                <div className="mt-1 text-xs text-fg-3 leading-snug">{unavailable ? "No earlier budget to copy yet." : meta.blurb}</div>
              </button>
            );
          })}
        </div>
      </section>

      {mode === "carry_forward" && prev && <CarryForward prevLabel={prev.fromLabel} lines={cf} setLines={setCf} income={cfIncome} setIncome={setCfIncome} catMeta={catMeta} debts={inputs.debts} pending={pending} />}

      {mode !== "carry_forward" && (
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="mp-stat__label">Take-home for {pretty}</div>
              <IncomeInput value={income} onChange={onIncome} />
              <div className="mt-1 text-sm text-fg-3">
                {inputs.defaultIncome != null ? "From your pay schedule — paychecks landing this month × take-home per check." : "No pay schedule with a take-home yet."}
                {inputs.billsTotal > 0 && (
                  <>
                    {" "}
                    Bill sheet: <Money value={inputs.billsTotal} kind="neutral" />.
                  </>
                )}
              </div>
            </div>
            {mode === "debt_snowball" && <Switch label="Keep the plan balanced" checked={auto} onChange={(e) => setAuto(e.target.checked)} />}
          </div>

          {mode === "debt_snowball" && (
            <>
              <FlowBar
                className="mt-5"
                total={incomeN}
                segments={[
                  { label: "Debt minimums", value: minimums, color: COLORS.debt },
                  { label: "Extra to debt", value: extra, color: COLORS.extra },
                  { label: "Everyday", value: spendTotal, color: COLORS.spend },
                  { label: "Savings", value: savings, color: COLORS.savings },
                  ...(shortfall > 0 ? [{ label: "Short", value: shortfall, color: COLORS.over }] : []),
                ]}
              />
              {shortfall > 0 && (
                <Notice tone="warn" className="mt-4" title={<>Everyday spending outruns the month by {formatMoney(shortfall)}</>}>
                  Trim an envelope, or turn on &ldquo;Keep the plan balanced&rdquo; and it fits itself.
                </Notice>
              )}
            </>
          )}
        </Card>
      )}

      {mode === "debt_snowball" && projection && (
        <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as React.CSSProperties}>
          <Card>
            <StatTile size="sm" label="Toward debt" value={debtBudget} kind="owed" sub={<><Money value={minimums} kind="neutral" /> minimums</>} />
          </Card>
          <Card>
            <StatTile size="sm" label="Extra" value={extra} kind="owed" sub={target ? `→ ${target.label}` : "no target"} />
          </Card>
          <Card>
            <StatTile
              size="sm"
              label="High-interest gone"
              value={<span className={projection.debtFreeOn ? "text-income" : "text-over"}>{projection.debtFreeOn ? shortMonthLabel(projection.debtFreeOn) : "—"}</span>}
              sub={projection.debtFreeOn ? `${projection.months} months` : "payments don't outrun interest"}
            />
          </Card>
          <Card>
            <StatTile
              size="sm"
              label="Interest paid"
              value={projection.totalInterest}
              sub={projection.minimumsOnly ? <>vs <Money value={projection.minimumsOnly.totalInterest} kind="neutral" /> on minimums</> : undefined}
            />
          </Card>
        </div>
      )}

      {mode === "debt_snowball" && (
        <>
          {/* ---- The two special envelopes ---- */}
          <section className="mp-grid" style={{ "--cols": 2 } as React.CSSProperties}>
            <Envelope
              icon="flag"
              title="Extra to debt"
              subtitle={target ? <>lands on {target.label} above its <Money value={target.minimum} kind="neutral" /> minimum</> : "no debt with a balance recorded"}
              color={COLORS.debt}
              planned={extra}
              used={null}
              remainingLabel={auto ? (openRows.length ? "draws from the open everyday envelopes" : "open an everyday envelope to draw from it") : "whatever everyday spending leaves over"}
              open={extraOpen}
              onToggle={() => setExtraOpen((o) => !o)}
              control={<AmountControl value={extra} max={pie} step={50} sliderStep={10} color={COLORS.debt} disabled={!auto || pie <= 0 || openRows.length === 0} ariaLabel="Extra to debt" onCommit={setExtra} onPreview={setExtra} />}
            />
            <Envelope
              icon="piggy-bank"
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
              <h2 className="font-display text-lg font-semibold tracking-tight">Everyday</h2>
              <div className="flex items-center gap-2 text-sm">
                <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => setRows(suggestedRows())}>
                  Reset to averages
                </Button>
                <Money value={spendTotal} kind="neutral" className="font-semibold" />
              </div>
            </div>
            <p className="text-sm text-fg-3 mb-4">Your average over {historyLabels.length ? historyLabels.slice().reverse().join(", ") : "past months"}, rounded up. Tap an envelope to change it. An envelope at $0 is left out.</p>
            {rows.length === 0 ? (
              <p className="text-sm text-fg-3">Nothing to suggest yet — add envelopes after creating.</p>
            ) : (
              <div className="mp-grid" style={{ "--cols": 3 } as React.CSSProperties}>
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
                      remainingLabel={r.planned === 0 ? "left out" : ""}
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
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-display text-lg font-semibold tracking-tight">Debts, in order</h2>
              <Segmented<DebtStrategy>
                label="Debt strategy"
                value={strategy}
                onChange={setStrategy}
                options={DEBT_STRATEGIES.map((s) => ({ value: s, label: STRATEGY_SHORT[s] }))}
              />
            </div>
            <p className="text-sm text-fg-3 mb-4">
              {DEBT_STRATEGY_META[strategy].label}. {DEBT_STRATEGY_META[strategy].blurb}
            </p>
            {debtLines.length === 0 ? (
              <p className="text-sm text-fg-3">No liabilities with a balance recorded. Add cards and loans on Debts first.</p>
            ) : (
              <Card padded={false}>
                <ol className="divide-y divide-line">
                  {debtLines.map((l, i) => {
                    const d = debtOf.get(l.accountId!);
                    const lineExtra = round2(l.planned - (l.minimum ?? 0));
                    const parked = !isHot(l);
                    return (
                      <li key={l.accountId} className={cx("flex items-center gap-3 px-4 py-3", parked && "opacity-60")}>
                        <span
                          className={cx(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                            !parked && l.isTarget ? "bg-accent text-accent-ink" : "bg-sunken text-fg-2",
                          )}
                        >
                          {parked ? "–" : i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{l.label}</div>
                          <div className="text-xs text-fg-3">
                            <Money value={d?.balance} kind="owed" /> owed{d?.apr != null && ` · ${d.apr.toFixed(1)}%`}
                            {parked && " · minimum only"}
                            {l.isTarget && " · getting the extra"}
                          </div>
                        </div>
                        <div className="text-right">
                          <Money value={l.planned} kind="neutral" className="font-semibold" />
                          <div className="text-xs">{lineExtra > 0 ? <span className="text-owed">+<Money value={lineExtra} kind="owed" sign="none" /> extra</span> : <span className="text-fg-3">minimum</span>}</div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            )}
            {projection && (
              <div className="mt-4">
                <PayoffCallout projection={projection} monthlyBudget={hotBudget} />
              </div>
            )}
          </section>
        </>
      )}

      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-4">
        <Button size="lg" icon="check" onClick={create} loading={pending}>
          {pending ? "Creating…" : `Create ${pretty}`}
        </Button>
        {mode === "debt_snowball" && auto && <span className="text-xs text-fg-3">Auto-rebalance stays on afterwards.</span>}
      </div>

      {dock && <BalanceDock message={dock.message} detail={dock.detail} onLockAll={lockAll} />}
    </div>
  );
}

/** The take-home figure as a big editable number — the wizard's hero. */
function IncomeInput({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="relative mt-1">
      <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-3xl md:text-4xl font-semibold text-fg-3">$</span>
      <input
        inputMode="decimal"
        aria-label="Take-home"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-60 max-w-full bg-transparent pl-7 text-4xl md:text-5xl font-semibold tabular-nums tracking-tight text-fg outline-none border-b-2 border-transparent focus:border-accent"
      />
    </div>
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
    <div className="space-y-8">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mp-stat__label">Take-home · copied from {shortMonthLabel(prevLabel)}</div>
            <IncomeInput value={income} onChange={setIncome} />
          </div>
          <div className={cx("text-sm", left < 0 ? "text-over" : "text-fg-3")}>
            <Money value={total} kind="neutral" /> planned · {left >= 0 ? <><Money value={left} kind="neutral" /> unallocated</> : <><Money value={-left} kind="over" /> over income</>}
          </div>
        </div>
        <FlowBar
          className="mt-5"
          total={inc}
          segments={groups.map((g) => ({ label: g.title, value: lines.filter((l) => l.kind === g.kind).reduce((s, l) => s + l.planned, 0), color: g.color }))}
        />
      </Card>
      {groups.map((g) => {
        const items = lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind}>
            <h2 className="font-display text-lg font-semibold tracking-tight mb-3">{g.title}</h2>
            <div className="mp-grid" style={{ "--cols": 3 } as React.CSSProperties}>
              {items.map(({ l, i }) => {
                const meta = l.category ? catMeta.get(l.category) : undefined;
                const d = l.accountId != null ? debtOf.get(l.accountId) : undefined;
                return (
                  <Envelope
                    key={i}
                    emoji={l.kind === "category" ? meta?.emoji : null}
                    icon={l.kind === "debt" ? (l.isTarget ? "flag" : "credit-card") : l.kind === "savings" ? "piggy-bank" : undefined}
                    title={l.label}
                    subtitle={d ? <><Money value={d.balance} kind="owed" /> owed</> : undefined}
                    color={l.kind === "debt" ? COLORS.debt : l.kind === "savings" ? COLORS.savings : meta?.color ?? COLORS.spend}
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

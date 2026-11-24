import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { Badge, Card, EmptyState, Money, PageHeader, StatTile, buttonClass } from "@/components/ds";
import { PaceDailyBars } from "@/components/charts/PaceChart";
import { PACE_COLORS } from "@/components/dashboard/PaceCard";
import { RemoveOneOff, TagOneOff } from "@/components/pace/OneOffControls";
import { requireSession } from "@/server/auth/session";
import { computePace } from "@/server/pace";
import { formatMoney } from "@/server/lib/money";
import {
  LEVEL_LABEL,
  addDays,
  categoryBreakdown,
  discretionaryCharges,
  merchantBreakdown,
  paceSentence,
} from "@/server/lib/spending-pace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spending pace" };

/** Charges at least this large are offered a one-off tag on this page. */
const TAG_MIN = 75;

export default async function PacePage() {
  await requireSession();
  let view;
  try {
    view = await computePace();
  } catch (e) {
    return <SetupNotice error={e} />;
  }
  if (!view) return <EmptyState icon="chart-line" title="No transactions yet" body="Spending pace needs a few weeks of transactions to compare against income." />;

  const { config: cfg, today: day, timeline: tl, indicators: ind, inputs } = view;
  const level = view.stale ? "stale" : day.status;
  const long = cfg.windows.long;
  const bars = tl.days.slice(-long).map((d) => ({ date: d.date, value: Math.max(0, d.spend) }));
  const merchants = merchantBreakdown(tl, long);
  const categories = categoryBreakdown(tl, long);
  const longTotal = categories.reduce((s, c) => s + c.amount, 0);
  let overDays = 0;
  for (let k = tl.days.length - 1; k >= 0 && tl.days[k].avgMid > tl.days[k].breakEven; k--) overDays++;
  const sentence = paceSentence(day, ind, overDays);

  const txnById = new Map(inputs.txns.map((t) => [t.id, t]));
  const tagged = new Set(inputs.oneOffs.map((o) => o.txnId));
  const candidates = discretionaryCharges(inputs, cfg, addDays(day.date, -(cfg.baselineDays - 1)), day.date, TAG_MIN)
    .filter((t) => !tagged.has(t.id))
    .slice(0, 12);
  // Recent status changes, newest first.
  const changes = tl.days.filter((d) => d.event).slice(-8).reverse();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Spending pace"
        description="Whether discretionary spending has been running ahead of what income leaves room for — over weeks, not single days."
        actions={
          <Link href="/settings/pace" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Settings
          </Link>
        }
      />

      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge label={LEVEL_LABEL[level]} color={PACE_COLORS[level]} size="lg" />
            <p className="text-sm text-fg-2">{view.stale ? `Bank sync hasn't completed in ${cfg.staleDays}+ days, so today's status isn't computed from incomplete data. The figures below are as recorded.` : sentence}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatTile label={`${cfg.windows.short}-day average`} value={day.avgShort} sub="per day" />
            <StatTile label={`${cfg.windows.mid}-day average`} value={day.avgMid} sub="per day" />
            <StatTile label={`${long}-day average`} value={day.avgLong} sub="per day" />
            <StatTile label="Left today" value={view.remainingToday} kind={view.remainingToday < 0 ? "over" : "neutral"} sub={`of ${formatMoney(day.target)} target`} />
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Daily discretionary spend" meta={`last ${long} days`} className="lg:col-span-2">
          <PaceDailyBars points={bars} target={day.target} breakEven={day.breakEven} highlight={ind.bigNights.map((b) => b.date)} />
        </Card>
        <Card title="Allowance">
          <div className="grid gap-2 text-sm">
            <Row label={`Income (trailing ${cfg.baselineDays}d, per month)`} value={<Money value={day.income} kind="neutral" />} />
            <Row label="Fixed costs" value={<Money value={-day.fixed} kind="muted" />} />
            <Row label="Essentials" value={<Money value={-day.essentials} kind="muted" />} />
            <Row label={`Savings target (${cfg.savingsPct}%)`} value={<Money value={-day.savings} kind="muted" />} />
            <hr className="border-line" />
            <Row strong label="Break-even per day" value={<Money value={day.breakEven} kind="neutral" />} />
            <Row strong label="Target per day" value={<Money value={day.target} kind="neutral" />} />
            <hr className="border-line" />
            <Row label="Projected month-end net" value={<Money value={ind.monthEnd.projectedNet} kind={ind.monthEnd.projectedNet < 0 ? "over" : "income"} />} />
            <Row label={`Cost of carrying debt (${cfg.windows.mid}d)`} value={<Money value={-ind.carryingCost} kind="muted" />} />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Leading indicators" meta="context only — they don't set the status">
          <ul className="grid gap-2.5 text-sm">
            <li>
              <b>Charge frequency:</b> {ind.frequency.recent.toFixed(1)}/day over the last {cfg.windows.short} days vs a norm of {ind.frequency.norm.toFixed(1)}/day
              {ind.frequency.ratio != null ? ` (${ind.frequency.ratio.toFixed(2)}×)` : ""}.
              {ind.frequency.flagged ? ` Above ${cfg.frequencyRatio}× for ${ind.frequency.daysOver} days.` : ""}
            </li>
            <li>
              <b>Merchant streaks:</b>{" "}
              {ind.streaks.length ? ind.streaks.map((s) => `${s.merchant} ${s.count}× (${formatMoney(s.amount)})`).join("; ") : `none (${cfg.merchantStreakCount}+ visits in 7 days)`}
            </li>
            <li>
              <b>Big nights:</b>{" "}
              {ind.bigNights.length ? ind.bigNights.map((b) => `${b.date} ${formatMoney(b.amount)}`).join("; ") : `no day over ${formatMoney(cfg.bigNightThreshold)} in ${cfg.windows.mid} days`}
            </li>
            <li>
              <b>Cards:</b> balances {ind.cards.weekChange >= 0 ? "up" : "down"} {formatMoney(Math.abs(ind.cards.weekChange))} this week, {ind.cards.lastWeekChange >= 0 ? "up" : "down"}{" "}
              {formatMoney(Math.abs(ind.cards.lastWeekChange))} the week before
              {ind.cards.growthWeeks ? `; higher than four weeks earlier for ${ind.cards.growthWeeks} weekly checks in a row` : ""}.
              {ind.cards.unpaidStatements.map((u) => ` ${u.name}: statement of ${formatMoney(u.balance)} (${u.closedOn}) paid ${formatMoney(u.paid)}.`).join("")}
            </li>
            <li>
              <b>Month-end:</b> {formatMoney(ind.monthEnd.spentSoFar)} discretionary so far this month, {ind.monthEnd.daysRemaining} days left at {formatMoney(day.avgMid)}/day.
            </li>
          </ul>
        </Card>
        <Card title="Where it went" meta={`last ${long} days`}>
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div className="grid gap-1.5 content-start">
              <div className="text-xs text-fg-3">By category</div>
              {categories.slice(0, 8).map((c) => (
                <Row key={c.category} label={`${c.category} · ${longTotal ? Math.round((c.amount / longTotal) * 100) : 0}%`} value={<Money value={c.amount} kind="neutral" whole />} />
              ))}
            </div>
            <div className="grid gap-1.5 content-start">
              <div className="text-xs text-fg-3">By merchant</div>
              {merchants.slice(0, 8).map((m) => (
                <Row key={m.merchant} label={`${m.merchant} · ${m.count}×`} value={<Money value={m.amount} kind="neutral" whole />} />
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card title="One-off charges" meta={`excluded, or spread over ${cfg.spreadDays} days`}>
        <div className="grid gap-5 text-sm">
          <p className="text-fg-2">
            A car repair, an annual bill or a planned trip can be tagged so it doesn&apos;t read as a pattern. Nothing is tagged automatically.
          </p>
          <div className="grid gap-2">
            <div className="text-xs text-fg-3">Tagged</div>
            {inputs.oneOffs.length === 0 && <p className="text-fg-3">None yet.</p>}
            {inputs.oneOffs.map((o) => {
              const t = txnById.get(o.txnId);
              return (
                <div key={o.txnId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    {t ? `${t.date} · ${t.description}` : `Transaction #${o.txnId} (outside the window)`} — {o.mode === "spread" ? `spread over ${cfg.spreadDays} days` : "excluded"}
                    {o.note ? ` · ${o.note}` : ""}
                  </span>
                  <span className="flex items-center gap-3">
                    {t && <Money value={t.amount} kind="neutral" />}
                    <RemoveOneOff txnId={o.txnId} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid gap-2">
            <div className="text-xs text-fg-3">Largest discretionary charges, last {cfg.baselineDays} days</div>
            {candidates.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  {t.date} · {t.description} {t.category ? <span className="text-fg-3">· {t.category}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  <Money value={t.amount} kind="neutral" />
                  <TagOneOff txnId={t.id} spreadDays={cfg.spreadDays} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {changes.length > 0 && (
        <Card title="Recent status changes">
          <ul className="grid gap-1.5 text-sm">
            {changes.map((d) => (
              <li key={d.date}>
                {d.date}: {LEVEL_LABEL[d.event!.from]} → {LEVEL_LABEL[d.event!.to]} ({cfg.windows.mid}-day {formatMoney(d.avgMid)}/day vs break-even {formatMoney(d.breakEven)})
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "font-semibold text-fg" : ""}`}>
      <span className={strong ? "" : "text-fg-2"}>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

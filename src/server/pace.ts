import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import { paceLedger, paceSyncFreshness } from "@/server/queries";
import { toNum } from "@/server/lib/money";
import { todayIso } from "@/server/lib/pay-schedule";
import { upsertInsights } from "@/server/lib/advisor/store";
import {
  REPLAY_DAYS,
  addDays,
  buildDigest,
  digestDue,
  escalationNotice,
  normalizePaceConfig,
  paceIndicators,
  paceLookbackDays,
  remainingToday,
  replayPace,
  shouldNotify,
  type CardStatement,
  type OneOffMode,
  type PaceConfig,
  type PaceDay,
  type PaceIndicators,
  type PaceInputs,
  type PaceTimeline,
  type PaceTxn,
} from "@/server/lib/spending-pace";

// The Spending Pace service: loads the ledger, runs the pure engine (lib/spending-pace.ts), and
// owns the two app_settings rows the feature keeps — its config and its notification memory.
// The status itself is never stored: every read replays the last REPLAY_DAYS days, so the card,
// the drill-down, the digest and the escalation notice can't disagree.

export const PACE_CONFIG_KEY = "spending_pace";
export const PACE_STATE_KEY = "spending_pace_state";

export interface PaceState {
  /** Escalations already notified, as "YYYY-MM-DD:level" — never notify the same one twice. */
  notified: string[];
  lastDigestOn: string | null;
}

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.settingKey, key)).limit(1);
  return row?.value ?? null;
}
async function writeSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings).values({ settingKey: key, value }).onDuplicateKeyUpdate({ set: { value } });
}

export async function getPaceConfig(): Promise<PaceConfig> {
  return normalizePaceConfig(await readSetting(PACE_CONFIG_KEY));
}
export async function savePaceConfig(cfg: unknown): Promise<PaceConfig> {
  const value = normalizePaceConfig(cfg);
  await writeSetting(PACE_CONFIG_KEY, value);
  return value;
}

export async function getPaceState(): Promise<PaceState> {
  const raw = (await readSetting(PACE_STATE_KEY)) as Partial<PaceState> | null;
  return {
    notified: Array.isArray(raw?.notified) ? raw.notified.filter((s): s is string => typeof s === "string") : [],
    lastDigestOn: typeof raw?.lastDigestOn === "string" ? raw.lastDigestOn : null,
  };
}
async function savePaceState(s: PaceState): Promise<void> {
  // Keep the memory short; an escalation older than the replay window can't recur.
  await writeSetting(PACE_STATE_KEY, { ...s, notified: s.notified.slice(-50) });
}

/** Ledger rows → engine inputs. */
export async function loadPaceInputs(from: string, to: string): Promise<PaceInputs & { depositMatch: string | null }> {
  const ledger = await paceLedger(from, to);
  const toTxn = (r: (typeof ledger.own)[number]): PaceTxn | null => {
    const amount = toNum(r.amount) ?? 0;
    if (amount <= 0.004) return null;
    return {
      id: r.id,
      date: r.date,
      amount,
      direction: r.direction === "Credit" ? "Credit" : "Debit",
      category: r.category,
      description: r.description,
      accountId: r.accountId,
      accountType: r.accountType,
      billId: r.billId,
      isTransfer: r.transferPartnerId != null,
      pending: !!r.pending,
    };
  };
  const txns = [...ledger.own, ...ledger.pieces].map(toTxn).filter((t): t is PaceTxn => t != null);
  const cardBills = new Set(ledger.cardBillRows.map((r) => r.billId!));
  // A settled status that means "nothing was owed" isn't a cost that month.
  const NO_COST = new Set(["No Balance", "Skipped", "Suspended"]);
  const billAmounts = new Map<string, Map<number, number>>();
  for (const r of ledger.instanceRows) {
    if (r.billId == null || r.isCancel || NO_COST.has(r.status)) continue;
    const amt = toNum(r.amount) ?? 0;
    if (amt <= 0) continue;
    const m = billAmounts.get(r.label) ?? new Map<number, number>();
    m.set(r.billId, (m.get(r.billId) ?? 0) + amt);
    billAmounts.set(r.label, m);
  }
  const statements: CardStatement[] = ledger.statementRows.map((r) => ({
    accountId: r.accountId,
    name: r.label ?? `Card …${r.number}`,
    closedOn: r.asOf,
    balance: toNum(r.balance) ?? 0,
  }));
  return {
    txns,
    bills: ledger.billRows.map((b) => ({ id: b.id, name: b.name, isCardPayment: cardBills.has(b.id) })),
    billAmounts,
    oneOffs: ledger.oneOffRows.map((o) => ({ txnId: o.txnId, mode: (o.mode === "exclude" ? "exclude" : "spread") as OneOffMode, note: o.note })),
    statements,
    historyStart: ledger.firstDate && ledger.firstDate > from ? ledger.firstDate : from,
    depositMatch: ledger.depositMatch,
  };
}

export interface PaceView {
  config: PaceConfig;
  today: PaceDay;
  timeline: PaceTimeline;
  indicators: PaceIndicators;
  /** True when bank sync is on but hasn't completed in `staleDays` — the status isn't trusted. */
  stale: boolean;
  lastSyncAt: string | null;
  syncEnabled: boolean;
  remainingToday: number;
  inputs: PaceInputs;
}

/** Replay the monitor up to `today`. No session check — callers gate (see queries.paceLedger). */
export async function computePace(opts: { today?: string; now?: Date } = {}): Promise<PaceView | null> {
  const cfg = await getPaceConfig();
  const today = opts.today ?? todayIso();
  const evalFrom = addDays(today, -REPLAY_DAYS);
  const from = addDays(evalFrom, -paceLookbackDays(cfg));
  const [inputs, sync] = await Promise.all([loadPaceInputs(from, today), paceSyncFreshness()]);
  if (!inputs.txns.length) return null;
  // Payroll detection falls back to the pay schedule's own deposit match, then the built-in one.
  const effective = !cfg.payrollPattern.trim() && inputs.depositMatch ? { ...cfg, payrollPattern: inputs.depositMatch } : cfg;
  const timeline = replayPace(inputs, effective, evalFrom, today);
  const day = timeline.days[timeline.days.length - 1];
  const now = opts.now ?? new Date();
  const stale = sync.enabled && (!sync.oldest || now.getTime() - sync.oldest.getTime() > cfg.staleDays * 86_400_000);
  return {
    config: effective,
    today: day,
    timeline,
    indicators: paceIndicators(timeline, inputs, effective),
    stale,
    lastSyncAt: sync.oldest ? sync.oldest.toISOString() : null,
    syncEnabled: sync.enabled,
    remainingToday: remainingToday(day),
    inputs,
  };
}

/** Local (server-time) calendar parts, the clock the digest schedule is written in. */
function localParts(now: Date) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { date, weekday: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
}

export interface PaceJobResult {
  status: string;
  notified: string[];
  digest: boolean;
}

/**
 * The scheduled job (server/sync/pace-scheduler.ts): recompute, notify on a fresh escalation to
 * Warning or Alert, and post the weekly digest when it's due. Notices go to the advisor Insights
 * feed — the app's notification channel — keyed so a re-run refreshes rather than duplicates.
 */
export async function runPaceJob(now = new Date()): Promise<PaceJobResult> {
  const local = localParts(now);
  const view = await computePace({ today: local.date, now });
  const out: PaceJobResult = { status: view ? (view.stale ? "stale" : view.today.status) : "no-data", notified: [], digest: false };
  if (!view) return out;
  const state = await getPaceState();

  // Escalations: only fresh ones (the last two evaluations, in case a day's tick was missed), never
  // twice, and never while the data is stale.
  if (!view.stale) {
    for (const d of view.timeline.days.slice(-2)) {
      if (!shouldNotify(d.event)) continue;
      const key = `${d.date}:${d.event.to}`;
      if (state.notified.includes(key)) continue;
      const ind = paceIndicators(view.timeline, view.inputs, view.config, d.date);
      const n = escalationNotice(d, ind, view.config);
      await upsertInsights(null, [
        { key: `pace-escalation-${key}`, title: n.title, body: n.body, category: "spending", severity: "act", period: d.date.slice(0, 7) },
      ]);
      state.notified.push(key);
      out.notified.push(key);
    }
  }

  if (digestDue(local, view.config, state.lastDigestOn)) {
    const dg = buildDigest(view.timeline, view.indicators, view.config, view.stale);
    const sev = view.stale ? "info" : view.today.status === "green" ? "info" : view.today.status === "watch" ? "watch" : "act";
    await upsertInsights(null, [
      { key: `pace-digest-${local.date}`, title: dg.title, body: dg.body, category: "spending", severity: sev, period: local.date.slice(0, 7) },
    ]);
    state.lastDigestOn = local.date;
    out.digest = true;
  }

  if (out.notified.length || out.digest) await savePaceState(state);
  return out;
}

/** The dashboard card's props: plain data only (it crosses into a React tree). */
export function paceCardData(v: PaceView): import("@/components/dashboard/PaceCard").PaceCardData {
  const days = v.timeline.days.slice(-v.config.windows.long);
  return {
    status: v.today.status,
    stale: v.stale,
    avgMid: v.today.avgMid,
    target: v.today.target,
    breakEven: v.today.breakEven,
    remainingToday: v.remainingToday,
    midDays: v.config.windows.mid,
    sparkline: days.map((d) => ({ date: d.date, value: d.avgMid })),
    lastSyncAt: v.lastSyncAt,
  };
}

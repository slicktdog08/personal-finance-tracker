import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PACE_CONFIG,
  INITIAL_STATE,
  addDays,
  allowances,
  buildDigest,
  digestDue,
  dropPostedPending,
  makeClassifier,
  normalizePaceConfig,
  paceIndicators,
  paceSentence,
  remainingToday,
  replayPace,
  shouldNotify,
  smoothedPayroll,
  spreadPerDay,
  stepStatus,
  type DayFacts,
  type MachineState,
  type PaceConfig,
  type PaceInputs,
  type PaceLevel,
  type PaceTxn,
} from "@/server/lib/spending-pace";

// Illustrative numbers only — no real data. A synthetic household: $2,000 biweekly paychecks
// (≈ $4,342.86/month), a $1,200 rent bill, groceries, and a configurable daily spend.

const cfg = DEFAULT_PACE_CONFIG;
let nextId = 1;
const txn = (p: Partial<PaceTxn> & Pick<PaceTxn, "date" | "amount">): PaceTxn => ({
  id: nextId++,
  direction: "Debit",
  category: "Discretionary",
  description: "SAMPLE SHOP",
  accountId: 1,
  accountType: "Credit",
  billId: null,
  isTransfer: false,
  pending: false,
  ...p,
});

const CHECKING = { accountId: 2, accountType: "Checking" } as const;

interface World {
  start: string;
  end: string;
  /** Discretionary spend per day, by date (default `daily`). */
  spend?: (date: string, k: number) => number;
  daily?: number;
  extra?: PaceTxn[];
  oneOffs?: PaceInputs["oneOffs"];
}

function world(w: World): PaceInputs {
  const txns: PaceTxn[] = [];
  const days = Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86_400_000) + 1;
  for (let k = 0; k < days; k++) {
    const date = addDays(w.start, k);
    if (k % 14 === 0)
      txns.push(txn({ date, amount: 2000, direction: "Credit", category: "Deposit", description: "ACME CORP PAYROLL", ...CHECKING }));
    if (date.endsWith("-01")) txns.push(txn({ date, amount: 1200, category: "Housing", description: "SAMPLE PROPERTY MGMT", billId: 10, ...CHECKING }));
    if (k % 7 === 3) txns.push(txn({ date, amount: 70, category: "Food/Groceries", description: "SAMPLE GROCER", ...CHECKING }));
    const amt = w.spend ? w.spend(date, k) : (w.daily ?? 0);
    // Everyday spending on a debit card, so card balances only move when a test says so.
    if (amt > 0) txns.push(txn({ date, amount: amt, description: `SAMPLE CAFE ${k % 5}`, ...CHECKING }));
  }
  return {
    txns: [...txns, ...(w.extra ?? [])],
    bills: [
      { id: 10, name: "Rent", isCardPayment: false },
      { id: 20, name: "Card A", isCardPayment: true },
    ],
    billAmounts: new Map(),
    oneOffs: w.oneOffs ?? [],
    historyStart: w.start,
  };
}

// The synthetic household's own numbers: income 2000 × 30.4/14, fixed 1200/mo (rent bill's
// trailing average), groceries 70/week.
const INCOME = (2000 * 30.4) / 14;

describe("allowance math", () => {
  test("break-even and target per day from monthly figures", () => {
    const a = allowances(9000, 2500, 800, 20);
    assert.equal(a.savings, 1800);
    assert.equal(a.breakEven, Math.round(((9000 - 2500 - 800) / 30.4) * 100) / 100); // 187.5
    assert.equal(a.target, Math.round(((9000 - 2500 - 800 - 1800) / 30.4) * 100) / 100); // 128.29
    assert.ok(a.target < a.breakEven);
  });

  test("savings percentage is configurable; 0% makes target equal break-even", () => {
    const a = allowances(6000, 2000, 500, 0);
    assert.equal(a.target, a.breakEven);
  });

  test("allowances can go negative when fixed costs exceed income", () => {
    assert.ok(allowances(2000, 2500, 300, 20).breakEven < 0);
  });

  test("baselines come from the ledger, not constants: more income raises break-even", () => {
    const base = world({ start: "2026-01-01", end: "2026-05-31", daily: 20 });
    const richer = world({ start: "2026-01-01", end: "2026-05-31", daily: 20 });
    for (const t of richer.txns) if (t.category === "Deposit") t.amount = 3000;
    const a = replayPace(base, cfg, "2026-05-31", "2026-05-31").days[0];
    const b = replayPace(richer, cfg, "2026-05-31", "2026-05-31").days[0];
    assert.ok(Math.abs(a.income - INCOME) < 1, `income ${a.income}`);
    assert.ok(b.breakEven > a.breakEven);
    assert.ok(Math.abs(b.breakEven - a.breakEven - (1000 * 30.4) / 14 / 30.4) < 0.05);
  });

  test("paycheck timing is smoothed: 6 or 7 biweekly checks in the window give the same income", () => {
    const six = [0, 14, 28, 42, 56, 70].map((d) => ({ date: addDays("2026-01-02", d), amount: 2000 }));
    const seven = [0, 14, 28, 42, 56, 70, 84].map((d) => ({ date: addDays("2026-01-02", d), amount: 2000 }));
    assert.equal(smoothedPayroll(six), smoothedPayroll(seven));
    assert.ok(Math.abs(smoothedPayroll(six)! - INCOME) < 0.01);
  });

  test("a split direct deposit counts as one paycheck", () => {
    const split = [0, 14, 28, 42].flatMap((d) => [
      { date: addDays("2026-01-02", d), amount: 1500 },
      { date: addDays("2026-01-03", d), amount: 500 },
    ]);
    assert.ok(Math.abs(smoothedPayroll(split)! - INCOME) < 0.01);
  });

  test("fewer than three paychecks: no smoothing (caller falls back to the plain average)", () => {
    assert.equal(smoothedPayroll([{ date: "2026-01-02", amount: 2000 }]), null);
  });
});

// ---- Hysteresis -------------------------------------------------------------------------

const T = 100; // target
const BE = 150; // break-even
const facts = (mid: number, extra: Partial<DayFacts> = {}): DayFacts => ({
  avgShort: mid,
  avgMid: mid,
  avgLong: mid,
  target: T,
  breakEven: BE,
  cardGrowthWeeks: 0,
  ...extra,
});

function run(seq: DayFacts[], c: PaceConfig = cfg, start: MachineState = INITIAL_STATE) {
  let s = start;
  const statuses: PaceLevel[] = [];
  const events: ReturnType<typeof stepStatus>["event"][] = [];
  for (const f of seq) {
    const r = stepStatus(s, f, c);
    s = r.state;
    statuses.push(s.status);
    events.push(r.event);
  }
  return { statuses, events, state: s };
}

describe("status hysteresis", () => {
  test("at or under target is Green", () => {
    assert.deepEqual(run([facts(100), facts(80)]).statuses, ["green", "green"]);
  });

  test("between target and break-even is Watch, at once", () => {
    assert.equal(run([facts(120)]).statuses[0], "watch");
  });

  test("short average over break-even while the mid average is fine is Watch", () => {
    assert.equal(run([facts(90, { avgShort: 200 })]).statuses[0], "watch");
  });

  test("Warning needs the mid average over break-even for 7 consecutive evaluations", () => {
    const r = run(Array.from({ length: 7 }, () => facts(170)));
    assert.deepEqual(r.statuses, ["watch", "watch", "watch", "watch", "watch", "watch", "warning"]);
  });

  test("one dip below break-even restarts the Warning count", () => {
    const seq = [...Array(6).fill(facts(170)), facts(140), ...Array(6).fill(facts(170))];
    assert.ok(!run(seq).statuses.includes("warning"));
    assert.equal(run([...seq, facts(170)]).statuses.at(-1), "warning");
  });

  test("Alert when the long average exceeds 1.25 × break-even", () => {
    assert.equal(run([facts(120, { avgLong: BE * 1.25 + 1 })]).statuses[0], "alert");
    assert.equal(run([facts(120, { avgLong: BE * 1.25 })]).statuses[0], "watch");
  });

  test("Alert when card balances grew 3+ consecutive weeks", () => {
    assert.equal(run([facts(90, { cardGrowthWeeks: 3 })]).statuses[0], "alert");
    assert.equal(run([facts(90, { cardGrowthWeeks: 2 })]).statuses[0], "green");
  });

  test("de-escalating needs 7 consecutive days below the level", () => {
    const warn = run(Array(7).fill(facts(170))).state;
    const r = run(Array(7).fill(facts(80)), cfg, warn);
    assert.deepEqual(r.statuses, ["warning", "warning", "warning", "warning", "warning", "warning", "green"]);
  });

  test("a single bad day during the cool-down resets it", () => {
    const warn = run(Array(7).fill(facts(170))).state;
    const seq = [...Array(5).fill(facts(80)), facts(170), ...Array(6).fill(facts(80))];
    assert.ok(run(seq, cfg, warn).statuses.every((s) => s === "warning"));
  });

  test("steps down to the highest level seen during the cool-down", () => {
    const warn = run(Array(7).fill(facts(170))).state;
    const seq = [facts(80), facts(80), facts(120), facts(80), facts(80), facts(80), facts(80)];
    assert.equal(run(seq, cfg, warn).statuses.at(-1), "watch");
  });

  test("a big single day doesn't flip-flop the status", () => {
    // Green, one day where the short average spikes, then calm: Watch once, and it lingers rather
    // than bouncing back to Green the next morning.
    const r = run([facts(90), facts(90, { avgShort: 220 }), facts(90), facts(90), facts(90)]);
    assert.deepEqual(r.statuses, ["green", "watch", "watch", "watch", "watch"]);
  });

  test("notifications: never Green → Watch, once on Warning, once on Alert", () => {
    const seq = [facts(120), ...Array(7).fill(facts(170)), ...Array(5).fill(facts(170)), facts(170, { avgLong: 200 }), facts(170, { avgLong: 200 })];
    const r = run(seq);
    const notes = r.events.filter(shouldNotify).map((e) => e!.to);
    assert.deepEqual(notes, ["warning", "alert"]);
    assert.ok(!shouldNotify({ kind: "escalate", from: "green", to: "watch" }));
    assert.ok(!shouldNotify({ kind: "deescalate", from: "alert", to: "warning" }));
  });

  test("escalation and de-escalation days are configurable", () => {
    const c = normalizePaceConfig({ warningDays: 3, deescalateDays: 2 });
    const up = run(Array(3).fill(facts(170)), c);
    assert.equal(up.statuses.at(-1), "warning");
    assert.equal(run([facts(80), facts(80)], c, up.state).statuses.at(-1), "green");
  });
});

// ---- One-offs ---------------------------------------------------------------------------

describe("one-off amortization", () => {
  const repair = () => txn({ date: "2026-05-10", amount: 1800, category: "Transportation", description: "SAMPLE AUTO SHOP" });

  test("spread per day is amount / spread days", () => {
    assert.equal(spreadPerDay(900, 90), 10);
  });

  test("a spread one-off adds amount/90 to each of 90 days and sums back to the amount", () => {
    const r = repair();
    const inp = world({ start: "2026-01-01", end: "2026-09-30", extra: [r], oneOffs: [{ txnId: r.id, mode: "spread", note: "car repair" }] });
    const tl = replayPace(inp, cfg, "2026-05-01", "2026-09-30");
    const byDate = new Map(tl.days.map((d) => [d.date, d.spend]));
    assert.equal(byDate.get("2026-05-09"), 0);
    assert.equal(byDate.get("2026-05-10"), 20);
    assert.equal(byDate.get(addDays("2026-05-10", 89)), 20);
    assert.equal(byDate.get(addDays("2026-05-10", 90)), 0);
    const total = tl.days.reduce((s, d) => s + d.spend, 0);
    assert.ok(Math.abs(total - 1800) < 0.01);
  });

  test("an excluded one-off contributes nothing", () => {
    const r = repair();
    const inp = world({ start: "2026-01-01", end: "2026-06-30", extra: [r], oneOffs: [{ txnId: r.id, mode: "exclude", note: null }] });
    const tl = replayPace(inp, cfg, "2026-05-01", "2026-06-30");
    assert.equal(tl.days.reduce((s, d) => s + d.spend, 0), 0);
  });

  test("untagged, the same charge is a spike; spread, it barely moves the 14-day average", () => {
    const r = repair();
    const plain = replayPace(world({ start: "2026-01-01", end: "2026-05-20", daily: 40, extra: [r] }), cfg, "2026-05-20", "2026-05-20").days[0];
    const r2 = repair();
    const spread = replayPace(
      world({ start: "2026-01-01", end: "2026-05-20", daily: 40, extra: [r2], oneOffs: [{ txnId: r2.id, mode: "spread", note: null }] }),
      cfg,
      "2026-05-20",
      "2026-05-20",
    ).days[0];
    assert.ok(plain.avgMid > 160);
    // 11 of the 14 days carry the $20/day spread: 40 + 20 × 11/14.
    assert.ok(Math.abs(spread.avgMid - (40 + (20 * 11) / 14)) < 0.01, `spread avg ${spread.avgMid}`);
  });

  test("tagging is never automatic: an untagged large charge counts in full", () => {
    const r = repair();
    const tl = replayPace(world({ start: "2026-01-01", end: "2026-05-10", extra: [r] }), cfg, "2026-05-10", "2026-05-10");
    assert.equal(tl.days[0].spend, 1800);
  });
});

// ---- Classification ---------------------------------------------------------------------

describe("what counts as discretionary", () => {
  const classify = makeClassifier(cfg, [
    { id: 10, name: "Rent", isCardPayment: false },
    { id: 20, name: "Card A", isCardPayment: true },
  ]);
  const k = (p: Partial<PaceTxn>) => classify(txn({ date: "2026-01-01", amount: 10, ...p }));

  test("transfers, card payments and debt repayment are not spending", () => {
    assert.equal(k({ isTransfer: true }), "ignore");
    assert.equal(k({ category: "Transfer" }), "ignore");
    assert.equal(k({ category: "Debt Repayment" }), "ignore");
    assert.equal(k({ billId: 20, accountType: "Checking", category: null }), "ignore");
    assert.equal(k({ category: null, accountType: "Checking", description: "CARD A ONLINE PAYMENT" }), "ignore");
    assert.equal(k({ category: null, direction: "Credit", description: "PAYMENT THANK YOU" }), "ignore");
  });

  test("bills in fixed costs, fixed categories and essentials are excluded from discretionary", () => {
    assert.equal(k({ billId: 10, category: "Discretionary" }), "fixed");
    assert.equal(k({ category: "Housing" }), "fixed");
    assert.equal(k({ category: "Food/Groceries" }), "essential");
    assert.equal(k({ category: "Gas" }), "essential");
  });

  test("interest and fees are the cost of carrying debt, not discretionary", () => {
    assert.equal(k({ category: "Interest" }), "carrying");
    assert.equal(k({ category: "Fees" }), "carrying");
  });

  test("refunds net out; uncategorized card purchases count", () => {
    assert.equal(k({ direction: "Credit", category: "Restaurant/Bar" }), "discretionary");
    assert.equal(k({ direction: "Credit", category: null, description: "SAMPLE STORE REFUND" }), "discretionary");
    assert.equal(k({ category: null, description: "SAMPLE TAQUERIA" }), "discretionary");
  });

  test("income is credits in the income categories only", () => {
    assert.equal(k({ direction: "Credit", category: "Deposit", accountType: "Checking" }), "income");
    assert.equal(k({ direction: "Credit", category: null, accountType: "Checking" }), "ignore");
  });

  test("the category lists are configurable", () => {
    const c = makeClassifier(normalizePaceConfig({ essentialsCategories: ["Restaurant/Bar"] }), []);
    assert.equal(c(txn({ date: "2026-01-01", amount: 5, category: "Restaurant/Bar" })), "essential");
    assert.equal(c(txn({ date: "2026-01-01", amount: 5, category: "Food/Groceries" })), "discretionary");
  });

  test("a refund in a later period reduces that day's spend", () => {
    const refund = txn({ date: "2026-05-20", amount: 50, direction: "Credit", category: "Discretionary" });
    const tl = replayPace(world({ start: "2026-01-01", end: "2026-05-20", daily: 30, extra: [refund] }), cfg, "2026-05-20", "2026-05-20");
    assert.equal(tl.days[0].spend, -20);
  });

  test("a pending row is dropped once its posted twin arrives; an unposted one counts", () => {
    const pend = txn({ date: "2026-03-01", amount: 40, pending: true, description: "SQ *SAMPLE GRILL" });
    const post = txn({ date: "2026-03-03", amount: 48, description: "SQ *SAMPLE GRILL 0042" });
    const lone = txn({ date: "2026-03-02", amount: 12, pending: true, description: "SAMPLE KIOSK" });
    const kept = dropPostedPending([pend, post, lone]);
    assert.deepEqual(kept.map((t) => t.id), [post.id, lone.id]);
  });

  test("split pieces land in their own categories", () => {
    // A $100 row split $60 groceries / $40 discretionary arrives as two pieces sharing an id.
    const id = nextId++;
    const pieces = [
      txn({ id, date: "2026-05-20", amount: 60, category: "Food/Groceries" }),
      txn({ id, date: "2026-05-20", amount: 40, category: "Discretionary" }),
    ];
    const tl = replayPace(world({ start: "2026-01-01", end: "2026-05-20", extra: pieces }), cfg, "2026-05-20", "2026-05-20");
    assert.equal(tl.days[0].spend, 40);
  });
});

// ---- End to end -------------------------------------------------------------------------

describe("replay on a synthetic ledger", () => {
  // Break-even ≈ (4342.86 − 1200 − 303.33) / 30.4 ≈ 93.4/day; target ≈ 64.8/day.
  test("steady spending under target stays Green", () => {
    const tl = replayPace(world({ start: "2026-01-01", end: "2026-06-30", daily: 50 }), cfg, "2026-04-01", "2026-06-30");
    assert.ok(tl.days.every((d) => d.status === "green"));
  });

  test("a single $500 day in a normal week flags a big night but changes no status", () => {
    const night = txn({ date: "2026-06-20", amount: 500, category: "Restaurant/Bar", description: "SAMPLE BAR" });
    const plain = replayPace(world({ start: "2026-01-01", end: "2026-06-27", daily: 30 }), cfg, "2026-04-01", "2026-06-27");
    const inp = world({ start: "2026-01-01", end: "2026-06-27", daily: 30, extra: [night] });
    const tl = replayPace(inp, cfg, "2026-04-01", "2026-06-27");
    // The 7-day average crosses break-even that week, so it's a Watch at most — never Warning.
    assert.ok(tl.days.every((d) => d.status === "green" || d.status === "watch"));
    assert.ok(!tl.days.some((d) => shouldNotify(d.event)));
    const ind = paceIndicators(tl, inp, cfg);
    assert.deepEqual(ind.bigNights.map((b) => b.date), ["2026-06-20"]);
    assert.ok(plain.days.every((d) => d.status === "green"));
    assert.match(buildDigest(tl, ind, cfg, false).body, /2026-06-20: \$530\.00/);
  });

  test("a sustained overspend reaches Warning, then Alert, and doesn't clear on one quiet day", () => {
    const spend = (d: string) => (d >= "2026-05-01" ? (d === "2026-06-10" ? 0 : 160) : 40);
    const tl = replayPace(world({ start: "2026-01-01", end: "2026-06-30", spend }), cfg, "2026-04-01", "2026-06-30");
    const first = (l: PaceLevel) => tl.days.find((d) => d.status === l)?.date;
    assert.ok(first("warning")! < first("alert")!);
    assert.equal(tl.days.find((d) => d.date === "2026-06-11")!.status, "alert");
    assert.equal(tl.days.filter((d) => shouldNotify(d.event)).length, 2);
  });

  test("charge frequency over 1.5× the norm for 10+ days is a flag", () => {
    const extra: PaceTxn[] = [];
    for (let k = 0; k < 14; k++) for (let j = 0; j < 3; j++) extra.push(txn({ date: addDays("2026-06-17", k), amount: 4, description: `SAMPLE STAND ${j}` }));
    const inp = world({ start: "2026-01-01", end: "2026-06-30", daily: 20, extra });
    const ind = paceIndicators(replayPace(inp, cfg, "2026-06-01", "2026-06-30"), inp, cfg);
    assert.ok(ind.frequency.flagged, JSON.stringify(ind.frequency));
  });

  test("merchant streak: the same merchant 4+ times in 7 days, with a total", () => {
    const extra = [1, 2, 4, 6].map((d) => txn({ date: `2026-06-2${d}`, amount: 15, description: "SAMPLE COFFEE #12" }));
    const inp = world({ start: "2026-01-01", end: "2026-06-27", extra });
    const ind = paceIndicators(replayPace(inp, cfg, "2026-06-01", "2026-06-27"), inp, cfg);
    assert.deepEqual(ind.streaks.map((s) => [s.merchant, s.count, s.amount]), [["SAMPLE COFFEE", 4, 60]]);
  });

  test("an unpaid card statement is flagged once the grace period ends", () => {
    const inp = world({ start: "2026-01-01", end: "2026-06-30", daily: 20 });
    inp.statements = [{ accountId: 1, name: "Card A", closedOn: "2026-05-15", balance: 900 }];
    inp.txns.push(txn({ date: "2026-05-30", amount: 300, direction: "Credit", category: "Debt Repayment" }));
    const tl = replayPace(inp, cfg, "2026-06-01", "2026-06-30");
    assert.deepEqual(paceIndicators(tl, inp, cfg).cards.unpaidStatements.map((u) => [u.name, u.paid]), [["Card A", 300]]);
    assert.equal(paceIndicators(tl, inp, cfg, "2026-06-05").cards.unpaidStatements.length, 0);
  });
});

// ---- Wording & config -------------------------------------------------------------------

describe("digest wording", () => {
  const day = (mid: number) => ({ ...replayPace(world({ start: "2026-01-01", end: "2026-03-01" }), cfg, "2026-03-01", "2026-03-01").days[0], avgMid: mid, target: 125, breakEven: 180 });

  test("over break-even names the week and the main category, without exclamation marks", () => {
    const s = paceSentence(day(220), { topCategories: [{ category: "Restaurant/Bar", amount: 900 }, { category: "Discretionary", amount: 200 }] }, 10);
    assert.equal(s, "You're running about $40/day over break-even for the second week; most of it is restaurant and bar.");
    assert.ok(!s.includes("!"));
  });

  test("between target and break-even, and under target", () => {
    assert.match(paceSentence(day(150), { topCategories: [] }, 0), /\$25\/day over target and \$30\/day under break-even\./);
    assert.match(paceSentence(day(100), { topCategories: [] }, 0), /\$25\/day under target/);
  });

  test("remaining allowance today is target minus today's spend", () => {
    assert.equal(remainingToday({ ...day(100), target: 125, spend: 40 }), 85);
  });
});

describe("config", () => {
  test("defaults fill in anything missing and nonsense is clamped", () => {
    const c = normalizePaceConfig({ savingsPct: 500, windows: { short: 10, mid: 5 }, digestTime: "25:99", essentialsCategories: ["Gas", "Gas", " "] });
    assert.equal(c.savingsPct, 90);
    assert.deepEqual(c.windows, { short: 10, mid: 10, long: 28 });
    assert.equal(c.digestTime, "18:00");
    assert.deepEqual(c.essentialsCategories, ["Gas"]);
    assert.deepEqual(normalizePaceConfig(null), DEFAULT_PACE_CONFIG);
  });

  test("the digest is due once, after its day and time", () => {
    const sun = { date: "2026-03-01", weekday: 0, minutes: 18 * 60 + 5 };
    assert.ok(digestDue(sun, cfg, null));
    assert.ok(!digestDue(sun, cfg, "2026-03-01"));
    assert.ok(!digestDue({ ...sun, minutes: 17 * 60 }, cfg, null));
    assert.ok(!digestDue({ ...sun, weekday: 1 }, cfg, null));
  });
});

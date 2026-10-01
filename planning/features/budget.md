# Feature: Budget (plan vs. actual) & the debt-snowball generator

**Status:** live · **Entry:** `/budget?period=YYYY-MM` (+ a dashboard panel)

Sub-features: the **debt-snowball generator**, the **Savings line**, and the **cash projection**
widget (all below).

> Intent stated by the user on 2026-09-07: "Budgets are what you plan but sometimes you over and
> under spend … more tied to transactions really … different modes for creating budgets; for now a
> debt snowball option." Structural choices below were not put to the user — flagged where so.

## Intent / why
Every other surface records what *happened*. A budget records what you *meant* to happen and shows
the gap. Two deliberate framings:

- **A budget is measured against transactions, not the bill sheet.** Bills say what's due; the
  transactions say what actually left. A budget line pulls its *actual* from the month's
  transactions at read time, so over/under-spend appears without any manual entry. The bill
  sheet's total is shown for reference in the wizard only.
- **Modes are generators, not budget types.** Every budget is the same thing once created (a set
  of lines); a mode is just how the first draft gets filled in. `debt_snowball` drafts the whole
  month from live facts; `manual` starts blank. New modes = a new entry in `BUDGET_MODES` + a
  generator function — no schema change.

Competing intent to watch: [savings-goals.md](savings-goals.md) has a `debt_payoff` goal type. A
goal is a *target* over time ("pay $5,000 toward Card A"); a budget is a *monthly plan*. They do
not write to each other. If the user wants a budget's debt line to log goal contributions, that's
the `goal_contributions.transaction_id` seam, not a budget column.

## What it does
- Pick a month (this month and next always exist — see D9). No budget yet → the setup wizard;
  otherwise the plan view. Three modes: **Debt snowball**, **Copy last month** (the previous plan's
  lines, target and locks, adjustable before creating; disabled when there's nothing to copy),
  **Blank**.
- **Wizard (debt snowball):** income pre-filled from the pay schedule (take-home × paydays landing
  in the month). Income − debt minimums is a **pie** shown as one stacked bar (minimums | spending
  | extra | short). One big **"Extra to snowball" slider** and one **slider per spending category**
  (started at the trailing-3-month average rounded UP to $10, per-month figures shown so a one-off
  is visible; 🔒 pins a line; $0 drops it). **Auto-balance** (default on) makes the sliders
  zero-sum: drag the extra up and spending scales down proportionally; drag one category and the
  others give way to hold the extra; a plan that outruns the month is shrunk to fit on open instead
  of starting in deficit. Off, sliders are independent and extra is whatever's left (may be a
  shortfall). Debts listed in payoff order (smallest balance first, or highest APR via a toggle)
  with the extra landing on the target (spilling to the next when it would overpay); payoff
  projection vs. minimums-only. Auto-balance carries over as the budget's `auto_rebalance` flag.
- **Plan view — the envelope board.** Hero: income as the page's largest number (inline edit), a
  real switch for auto-rebalance, one **flow bar** (minimums | extra | everyday | savings |
  unallocated/over), four box-less stats (spent, left to spend, extra, cash by month end + savings
  check). Then the cash widget, then three groups — Debts / Everyday / Savings — as a grid of
  **envelopes**. An envelope at rest: emoji tile, name, one small subtitle, the planned amount
  large, a thin fill bar, one "left/over" line. **Every envelope starts locked.** Tap it to open:
  indigo ring, the amount control slides in (slider + `$` field on desktop, − / number / +
  below md), "See transactions" and "Remove". Open envelopes are the **pool**: one open → its
  change goes to the target (auto on, target shows an "auto" chip and can't be opened) or to
  Unallocated; two or more → they trade. A floating **dock** names who's open and where the change
  lands; "Done" locks all. A dashed "+ Add" card ends each group. The payoff sentence sits in a
  dark block with the debt-free month underlined.
- **Savings line** (`kind = savings`, one per budget, always the `Savings` system category): money
  you intend to *keep* this month. It comes off the pie like spending does, but is never counted as
  spent. Its reality check is cash on hand **month-start → projected month-end** (from the cash
  projection), shown as "+$X kept by month end if the plan holds · ✓ on track" when that covers the
  line. The raw month-start → right-now delta is only a footnote: mid-month it swings with paydays
  and due dates (a paycheck that just landed isn't savings), so it must never be the headline —
  the user flagged exactly that on 2026-09-09. Wizard: a Savings slider in the pie
  section (lime segment in the stacked bar; with auto-balance, saving more squeezes spending, not
  the extra).
- **Cash projection** (inside `CashMonthWidget.tsx`, on `/budget` and the dashboard): anchored on
  the date balances were last recorded, walks day-by-day **to the end of next month**. Next month's
  bills come from its auto-created sheet; its plan is next month's budget if one exists, otherwise
  this month's plan repeated (labeled *assumed*). Tiles: month start · latest · end of this month
  (+savings check) · end of next month · lowest on the horizon (flagged projected) · high-interest
  debt now → horizon. Then **Versus earlier projections** (today's projected month-end vs the
  snapshot from ≥7 days ago, else the earliest: "running below/ahead of plan") and **Spending
  pace** (spent so far vs plan × days elapsed ÷ days in month). Chart: solid = ledger so far,
  dashed = projected, dotted rule at the month boundary. Events list spans both months.
- **Dashboard panel:** whole-plan bar (savings excluded, noted beside it), the target's progress,
  the three most-over spending lines — or a "Plan a budget for <month>" prompt.

## How it works today
- Payday reconciliation: `src/server/lib/payday-reconcile.ts` — `reconcilePaydays(input)` and
  `isPayrollDescription()` (both pure). Tuned from `/settings/pay-schedule`.
- Cash projection: `src/server/lib/cash-projection.ts` — `projectCash(input)` (pure). Assembled by
  `queries.ts` `getCashProjection(view)` from `getProjectionBills(label)` (bill instances with a
  `paid` verdict, the liability account they pay, and their majority transaction category) +
  `getPaySchedule()`. Rendered inside the combined **`CashMonthWidget`** (with the ledger's day-by-day
  "so far" series) on `/budget` and the dashboard — see
  [dashboard.md](dashboard.md#cash-through-the-month--one-widget-2026-09-12). Chart:
  `CashMonthChart.tsx` (solid = recorded, dashed = projected, one hover readout).
- Pure planner: `src/server/lib/budget.ts` — `paydaysInMonth`, `monthIncome`, `orderDebts`,
  `suggestSpendingLines`, `buildSnowballPlan`, `projectPayoff`, plus the slider algebra
  `scaleRowsTo` / `moveRowKeepingExtra` (`SliderRow`). Imported by both the server page and the
  client wizard, so the preview *is* what gets saved.
- Queries: `src/server/queries.ts` — `getBudgetView(label)` (the whole plan + actuals),
  `getBudgetInputs(label)` (wizard inputs), `getBudgetedPeriodLabels()`, `getDebtInputs()`.
- Actions: `src/server/actions/budget.ts` — `createBudget`, `updateBudget`, `deleteBudget`,
  `addBudgetLine`, `updateBudgetLine`, `deleteBudgetLine`, `setBudgetTarget`, `rebalanceBudget`.
  `applyRebalance` is the shared core; `autoRebalanceIfOn(budgetId)` runs it after every write when
  the budget's `auto_rebalance` is set. All revalidate `/budget` + `/dashboard`.
- UI: `src/app/budget/page.tsx`; `src/components/budget/BudgetSetup.tsx` (wizard),
  `BudgetView.tsx` (the board), `BudgetSetup.tsx` (the wizard, same board), `Envelope.tsx`,
  `FlowBar.tsx`, `Stat.tsx`, `BalanceDock.tsx`, `AmountControl.tsx` (→ `AmountSlider` at md+,
  `AmountStepper` below), `BudgetPanel.tsx` (dashboard), `PlanBar.tsx`.
  `MonthNav` gained a `basePath` prop so the same picker drives `/budget`.
- Enums: `BUDGET_MODES`/`BUDGET_MODE_META`, `DEBT_STRATEGIES`/`DEBT_STRATEGY_META`,
  `BUDGET_LINE_KINDS`, `BUDGET_EXCLUDED_CATEGORIES`, `SNOWBALL_MIN_APR` in `src/constants/enums.ts`.
- `ProjectionSummary.tsx` — the one sentence about the projection, shared by wizard and plan view.

## Non-obvious logic / edge cases
- **Cash projection — the double-counting rules.** A bill and a budget line can describe the same
  money, so: (1) every *unpaid* bill leaves in full on its due day (overdue → the first projected
  day); if its majority category has a budget line, that line's remaining is reduced by the bill so
  it isn't also spread. (2) A **debt line schedules ONE payment** of `planned − max(linked payments,
  sheet-paid instance amount)` — on the unpaid instance's due day, else at month end (the extra). The
  liability's bill instance is never its own event. (3) Category lines spread `planned − actual`
  (after bill deductions) evenly over the remaining days. (4) Savings lines are not outflows.
  (5) Paydays: dates from the pay schedule, each worth `plannedIncome ÷ paydays in month`, then
  **netted against the payroll that actually landed** (see below). (6) A bill is `paid` when a
  transaction is linked to its instance, or its status is settled — except an *Autopay* status
  before its due day, which is a promise, not a payment. (7) **Pending outflows** dated after the
  anchor become events on their own day; they carry `lineId: null` because the category spend
  rollup already counts them in the line's `actual`.
- **Payday ↔ deposit reconciliation** (`src/server/lib/payday-reconcile.ts`). A schedule row says
  "$2,000 on the 15th"; a split direct deposit pays two halves that can land on the 14th and the
  16th. Anchored on the 14th, one half is already inside `cashNow`, so adding the scheduled lump on
  top counts it twice — overstating month-end by the half ($1,000 in this example). So each scheduled payday is a bucket: payroll credits landing within
  `pay_schedule.deposit_window_days` (default 3, ±) fill it, and **only the residual is projected**.
  Deposits are walked oldest-first into the *hungriest* in-range bucket, which is what makes the
  second half of a split find the same bucket as the first instead of drifting to a neighbouring
  payday. Only deposits dated ≤ `asOf` are netted — later ones aren't in the balance yet. Payroll is
  recognised by description (`pay_schedule.deposit_match`, else `DEFAULT_DEPOSIT_MATCH`); a credit
  that matches no bucket is reported as `unexpectedIncome` rather than eaten. A payday more than the
  window past with nothing matched is **dropped, not carried forward** — it is a deposit the matcher
  failed to recognise, and resurrecting it would invent cash that already arrived. `/budget` shows an
  amber note in both cases.
- **The walk starts in the ANCHOR month, not the viewed one.** `getCashProjection` builds segments
  from wherever the freshest cash balance sits through the month after the one being viewed, and
  `focusIndex` points at the viewed month; the flat `endBalance` / `spread*` / `paydays` figures all
  read from that index. Viewing a *future* budget without the lead-in opened it at today's cash,
  skipping everything the current month still owes — and the in-between days matched no segment at
  all, so they silently drew down the LAST segment's daily burn rate.
- **Horizon = this month + next.** Each segment spreads its own remaining everyday spending over
  its own days; next month's category lines start at actual = 0; its debt lines owe their full
  planned amount on the bill's due day (or month end). Debt balances roll month by month (interest
  then payments) for `hotHorizon`/`allHorizon`. Synthetic next-month lines carry negative ids so
  they can never collide with real ones.
- **Snapshots:** `projection_snapshots` gets one row per (period, day) on first compute; the
  `trend` on the projection is the earliest row, the most recent row ≥ 7 days old, and `series` —
  every row for the month, drawn on the chart as the thin indigo **forecast line** (each day's
  forecast of month-end, plotted against the day it was made, converging on the dashed line at month
  end). First write of the day wins, so a same-day engine change shows up tomorrow.
- **Projection anchor = the freshest cash snapshot ≤ month end**, never "today", and it is
  **rolled forward** by `getRolledCashOnHand`: balances are recorded per account on whatever day
  each was checked, so the raw sum mixes vintages and silently drops every transaction after each
  account's own date. Each account's balance is therefore carried over its own since-then rows
  (pending included) up to the anchor. **Wallet accounts are never rolled** — a withdrawal is a
  Debit on the bank account with no matching Credit on the wallet (cash-offsets.md), so rolling one
  would subtract its purchases without adding the cash that funded them. `drift` reports how much of
  the anchor is inferred rather than measured. The running balance is kept exact and rounded only
  for display, so month-end = start + in − out to the cent.
- **`unplannedSpend` on the budget view** is the month's spending in categories with no budget
  line (uncategorized included), minus `BUDGET_EXCLUDED_CATEGORIES` and the Cash source category
  (those are accounted for by the debt/savings lines and by cash-offsets). It is **invisible to the
  projection by construction** — the walk only ever spreads what a line planned — so it comes
  straight off month-end. `/budget` names it under "Outside the plan"; giving it a line is what
  brings it inside the forecast.
- **An unfunded Savings line is surfaced, not subtracted.** Savings here is a deliberate carry into
  the next month (rent is due on the 1st, ahead of that month's own pay), so `endBalance` counting
  it as spendable is a real overstatement — but subtracting it would double-count once the transfer
  actually happens. `/budget` says how much of the line is funded instead.
- **Reserved cash → `projection.spendable`.** Savings goals backed by a cash account (the
  emergency fund) sit inside `cashNow`, so every headline figure counts money that must not be
  spent. `getReservedCash` sums each non-archived goal's **`backed`** — not `funded`, not
  `targetAmount`, because you cannot reserve money that isn't there; an emergency fund recorded as
  $5,000 funded but holding $4,000 reserves $4,000 and keeps reporting the rest as its
  shortfall. The **walk is untouched** (the money really is in the account and a payment from it
  would clear); only `spendable.{now,end,low}` subtract it. This is what turns "the low on the 5th is
  $4,200" into "$200 of that is yours".
- **Debt at month end** = balance + one month's interest − the line's planned payment, floored at 0.
- **A line on the `Savings` category is a savings line whatever `kind` it was stored as**
  (`getBudgetView` normalizes; migration 0019 fixed the one pre-existing row).
- **The snowball only chases debt above `SNOWBALL_MIN_APR` (10%).** `isSnowballDebt` decides:
  balance > 0 and APR > 10 (an *unknown* APR counts as expensive — better to over-pay an
  unrecorded card than park it). Cheap debt (e.g. a low-rate student loan) still gets a budget line at its
  minimum, but it can't be the target, never receives extra (`buildSnowballPlan` gives it zero
  room), sorts after every eligible debt, and is **left out of the payoff projection** — which
  reports it in `excluded` so the sentence can say "X stays on its minimum". "Debt-free" in this
  app means *high-interest* debt-free. Intent: low-rate debt is not something the user is
  actively paying off.
- **The projection's monthly budget is Σ planned over the eligible lines only** (page + wizard both
  filter with `isSnowballDebt`), so the parked minimum doesn't inflate the payment being simulated.
- **Category actuals reuse `getCategorySpend(label)`** — so cash offsets, the pocket count and
  transfer exclusion are already applied. A budget can never disagree with the dashboard about
  what a category cost. Don't re-implement the sum.
- **Debt actuals = Debit transactions in the month with `bill_id` = the account's `bill_id`,
  excluding rows on the liability account itself** (a card's own linked rows are purchases and
  interest, not payments). A liability with no linked bill shows "payments can't be matched".
  Debits categorized `Debt Repayment` with no `bill_id` are totaled as **unassigned** with a link to
  go fix them — the nudge, not a guess.
- **`Debt Repayment`, `Deposit`, `Transfer`, `Interest`, `Interest/Rewards`, `Investing` never
  become spending lines** (`BUDGET_EXCLUDED_CATEGORIES`): income, internal moves, bank noise, or
  money the debt lines already count. Excluding `Debt Repayment` is what keeps a payment from being
  counted on a debt line *and* a category line.
- **Extra sweeps down the order.** The target takes `min(extra, balance − min)`; the remainder
  spills onto the next debt. A $200 balance with $500 spare doesn't strand $300.
- **Slider algebra is zero-sum over the pie** (income − minimums). `scaleRowsTo(rows, total)`
  rescales unlocked rows proportionally (by `suggested` when all are zero), clamps to each row's
  max, and lands rounding drift on the largest row so the sum is exact. `moveRowKeepingExtra`
  holds the extra by rescaling the *other* unlocked rows; when they bottom out at $0 the extra
  shrinks instead. Locked rows never move. The spending values are the source of truth — the extra
  slider's position is *derived* from them, so the two can't disagree.
- **Lock pool (`setBudgetLinePlanned`):** refuses a locked line; `absorbDelta(others, delta)`
  gives the OTHER unlocked lines −delta (one takes it exactly; several share by planned, equally
  when all zero; clamped at 0); the unabsorbed remainder changes the leftover, which
  `applyRebalance` sweeps to the target when auto is on. With auto on the target is excluded from
  the pool (it's the sink). All writes in one transaction. `updateBudgetLine` still refuses
  `planned` on a locked line for API callers; `moveBudgetAmount` (explicit transfer) remains for
  the MCP path but has no UI.
- **Lines default locked** (schema default + migration 0021 flipped existing rows). The wizard's
  rows start locked too; its Extra control is disabled until a spending line is unlocked.
- **Auto-rebalance never undoes a direct edit of the target's own payment** (`updateBudgetLine`
  skips the hook when the edited line is the target) — that's a deliberate override until the next
  edit elsewhere. Income changes, other-line edits/adds/deletes, target moves, and switching auto on
  all re-sweep.
- **Shortfall, not negative extra.** When minimums + suggested spending exceed income the preview
  says "short by $X"; every debt stays at its minimum. `rebalanceBudget` likewise floors the target
  at its minimum and caps at its balance.
- **`minimum` is a snapshot** on the line (planning-time min payment) so the "+$X extra" label
  doesn't drift when the account's minimum changes. `minPayment` on the row is the live value.
- **Balance movement** is "latest snapshot ≤ month end" minus "latest snapshot ≤ day before month
  start" — the month's own change. No snapshot either side → not shown.
- **The projection is a simple simulation**: interest = balance × APR ÷ 12 monthly, minimums held
  flat, each paid-off debt's payment rolls to the next, monthly debt budget held constant. It runs
  over the debts that *have lines*, in the plan's order (target first — `preserveOrder`), at the
  total the lines commit. `stalls` when a payment doesn't outrun interest. Month 1 = the budget
  month itself.
- **Paydays in a month** come from the pay schedule with the same clamping rule as the countdown
  (a 31st lands on the 30th). Weekly/biweekly count anchor cycles inside the month bounds — a
  5-payday month gets 5.
- **One budget per period** (`uq_budget_period`); a second create is refused, never a replace.
  **No two lines may measure the same thing** (same category / same account) — the actual would
  count twice.
- Inline edits save on blur (`key={planned}` re-seeds the input after refresh); a budget that hasn't
  changed doesn't write.

## Data model
`budgets` (one per period: `mode` debt_snowball | carry_forward | manual, `strategy`,
`planned_income`, `auto_rebalance`, `notes`) and `budget_lines` (`kind` category | debt | savings,
`label`, `category`, `account_id`, `planned`, `minimum`, `is_target`, `locked`, `sort_order`,
`notes`). Plus `projection_snapshots` (per period per day). Lines cascade with their budget; an account deletion SET NULLs the line. Migrations
`drizzle/0017_add_budgets.sql`, `0018_budget_auto_rebalance.sql`, `0019_savings_line_kind.sql`
(data fix), `0020_budget_locks_and_projection_snapshots.sql`, `0021_budget_lines_locked_default.sql`, `0024_payday_deposit_window.sql`. `Savings` is a seeded default category (`CATEGORY_DEFAULTS`, `SAVINGS_CATEGORY`). Full columns in [../design/02-data-model.md](../design/02-data-model.md).

## How to extend it
- **New mode:** add to `BUDGET_MODES` + `BUDGET_MODE_META`; write a `build<Mode>Plan()` in
  `lib/budget.ts` returning `PlannedLine[]`; branch on `mode` in `BudgetSetup` for its inputs.
  `createBudget` takes any `PlannedLine[]`.
- **New line kind** (e.g. a savings-goal line): add to `BUDGET_LINE_KINDS`, teach `getBudgetView`
  where its actual comes from, and `AddLine` how to pick one.
- **Change how a bill finds its budget line:** `getProjectionBills` (majority category) →
  `page.tsx` (`lineByCategory`). A `bills.category` column would make this explicit if it's ever
  wrong too often.
- **Change what counts as a payment:** `debtPaymentsForPeriod` in `queries.ts` — one place.
- **Move the high-interest line:** `SNOWBALL_MIN_APR` in `enums.ts`. If it ever needs to be
  per-user, it's a column on `pay_schedule`-style singleton config, not on each budget.
- **Extend the horizon:** `getCashProjection` builds `segments`; a third month is one more
  `segmentFor()` call (its sheet must exist — `ensureCurrentPeriods` only keeps two).

## Related
- Reads: [accounts-and-balances.md](accounts-and-balances.md) (liability balances/APR/min),
  [pay-schedule.md](pay-schedule.md) (income default), [cash-offsets.md](cash-offsets.md) (via
  `getCategorySpend`), [categorization.md](categorization.md) (bill linking for debt actuals).
- Decisions: [../design/07-decisions.md](../design/07-decisions.md) D7.

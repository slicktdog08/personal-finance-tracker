# Feature: Dashboard

**Status:** live · **Entry:** `/dashboard`

## Intent / why
The at-a-glance financial home, **month-scoped and URL-driven** (`?period=YYYY-MM`). For a single
selected month it answers: how much cash do I have, what do I owe (cards + loans), am I on track
with goals, how are this month's bills, did I earn more than I spent, where did the money go, and
how are all of these trending. Two design intents: (1) keep everything **server-rendered and
URL-driven** so month switching re-renders every widget with no client state; (2) read past months
**historically** — balances shown as they were recorded then, not "now."

## How it works today
- One file: `src/app/dashboard/page.tsx` (`DashboardPage`, `force-dynamic`; presentational helpers
  `Card`, `Panel`, `TxnList` at the bottom). Two `Promise.all`s: month-independent data (periods,
  status config, all instances, cashflow) then everything scoped to the selected month / month-end.
  Month resolved from `?period`, default newest. On DB error → `SetupNotice`.
- Queries: `src/server/queries.ts`. Charts: `src/components/charts/` (Donut, BarsChart, Sparkline).
  Month nav: `src/components/dashboard/MonthNav.tsx` (just pushes `?period=`).

## The metrics (how each is computed)
`monthEnd = monthBounds(selected).end` is the as-of cutoff for all balance reads.
- **Cash on hand** — `getCashOnHand(monthEnd)`: latest `account_balances` snapshot ≤ month-end per
  Checking/Savings account; sum by type; shows "—" + a "Record them" link when none exists.
- **Credit cards owed / Loans outstanding** — both from `getLiabilityAccounts(monthEnd)` (one
  query, split by `accountType`). Derived: available = limit − owed, utilization, monthly interest
  (`monthlyInterest`), min payments. Cards only render when such accounts exist.
- **Bill stats** (this month) — from `getInstances(selected.id)`: billed = Σ instance amount, paid =
  Σ where status is settled (from `statusConfig`), outstanding = billed − paid.
- **Income vs outgoing** — `getCashflowByPeriod()` groups `transactions` by period + direction,
  `SUM(amount)`, **excluding Transfer**; Net = income − outgoing.
- **Status donut** — instance counts per status, colored from config; center = % settled.
- **Spend by category** — `getCategorySpend(label)`, top 10; rows link into filtered
  `/transactions`.
- **Highest spending / deposits / recent** — `getTopTransactions` / `getTopDeposits`
  (exclude transfers) / `getRecentTransactions` (does **not** exclude transfers).

### Key rule: never `SUM(net_amount)`
Every row normalizes to **`amount` (positive magnitude) + `direction`**; `net_amount` is
unreliable (see [../design/07-decisions.md](../design/07-decisions.md) D5). Spend is
`CASE WHEN direction='Debit' THEN amount ELSE -amount END` (so refunds subtract; categories netting
≤0 drop via `HAVING`). Cashflow sums `amount` grouped by direction. `net_amount` is selected in the
transactions *list* query but never aggregated.

## The charts
**No chart library** — custom SVG/CSS, three components, each taking a `color` string:
- **Donut** — SVG circle via `strokeDasharray`/`strokeDashoffset` (`pathLength=100`).
- **BarsChart** (`"use client"`) — grouped bars; `valueFormat` is a **string flag
  `"money"|"number"`, NOT a function** (a server component can't pass a function to a client
  component); `highlightIndex` rings the selected month.
- **Sparkline** — filled area+line for cash/credit/loan banners; skips leading nulls but keeps time
  position; renders nothing with <2 points ("a lone point isn't a trend"); dot on latest, ring on
  highlighted.

`balanceTrends` (`getBalanceTrends`, oldest→newest) feeds the sparklines; a `hasTrend()` gate
requires ≥2 non-null points. `shortMonthLabel` gives `Apr '24` axis labels.

## Edge cases / gotchas
- **Server→client function props** (two documented traps): can't pass a formatter to `BarsChart`
  (hence the `valueFormat` string flag); SVG `<title>` needs a **single string child** (template
  literal).
- **Historical as-of**: balance cards show "—" when no snapshot exists ≤ month-end (all current
  snapshots are recent, so only recent months light up).
- **Transfers excluded** from cashflow/category/top-spend/deposit — but **not** recent.
- **Loan balances clamped ≥0**; a category netting ≤0 disappears from Spend-by-category.
- DB not set up / no periods → `SetupNotice` / "run npm run seed".

## How to extend it
- **Stat card**: add a `<Card label value tone />` in the grid; compute from an already-fetched
  array or add a query to the second `Promise.all`.
- **New data**: add an `export async function` in `queries.ts` (follow the as-of snapshot pattern
  for balances — accept `asOf`, order `desc(as_of)`, first-per-account wins), import + add to the
  `Promise.all`. Reuse `toNum`; never `SUM(net_amount)`.
- **Chart**: wrap in `<Panel>`; reuse `BarsChart` (pass colors as hex strings, `valueFormat` flag,
  `highlightIndex`) or `Sparkline`; keep new SVG `<title>` children a single template literal.
- **Month-reactive**: derive from `selected`/`monthEnd`; URL-driven widgets stay server-rendered.


## Months are automatic (2026-09-20)
`ensureCurrentPeriods()` (`src/server/periods.ts`) runs at the top of the dashboard and `/budget`:
this month and next always exist, cloned from the latest month with bills. The Months index page is
gone; "Open <month> →" on the dashboard opens the sheet (`/months/[period]`). The default selected
month is the one we're in (`defaultPeriod`), not the newest period (which is now next month).

## Cash through the month — one widget (2026-09-12; horizon + trend 2026-09-20)
`CashMonthWidget` (server) + `CashMonthChart` (client), shared by the dashboard and `/budget`.
Two series off the same `account_balances` snapshots, so they meet at one point with no seam:
- **So far (solid, dots on recorded days):** `getDailyCashOnHand(label)` — for each day, Σ over
  cash accounts of the latest snapshot ≤ that day (each account carries its last figure forward,
  seeded from its last pre-month snapshot). Stops at the last recorded day ≤ month end.
- **Projected (dashed, lighter fill):** `getCashProjection(view)` from the last recorded day to
  the **end of next month** (rules in [budget.md](budget.md)); dotted rule at the month boundary.
  Only drawn while the month is running. Adds "Versus earlier projections" (from
  `projection_snapshots`) and "Spending pace".
Tiles keep every figure the two earlier widgets had: month start · latest (+since start) ·
projected month end (+vs month start, savings-line check) · lowest (so far, and projected if
lower/later; high so far folded in) · high-interest debt now → end (+ all debt). Below the chart:
"Coming in" / "Going out" event lists. The readout above the chart follows hover/touch and says
recorded / carried / projected (+ that day's events). Shown when ≥ 2 ledger days or a live
projection exist. Replaced the separate "Cash on hand through <month>" panel and `CashProjection`
widget the same day they were added.

## Budget panel (added 2026-09-07)
Below the goals panel: a **Budget — <month>** panel (`BudgetPanel`), then the cash widget above.
See [budget.md](budget.md).

## Related
- Reads from [accounts-and-balances.md](accounts-and-balances.md), [savings-goals.md](savings-goals.md),
  [categorization.md](categorization.md), [transfers.md](transfers.md)

## Owed to cards — the rebalance widget (2026-10-10)
User: "a widget … to tell how much I owe to cards. I charge to cards at times but want to make it
easy to rebalance things through a payment … starting balance vs today's balance. Excess is treated
as a payment owed to that card on top of the debt payoff payment."
- Widget `card-rebalance` ("Owed to cards"), current month only, default slot right under payday
  (full width). `src/components/dashboard/CardRebalance.tsx`; rule in
  `src/server/lib/card-rebalance.ts` (unit-tested in `tests/unit/card-rebalance.test.ts`).
- Per active credit card: **owe = max(0, today − start)** — how far the card has climbed above
  the balance it started the month at. `start` = latest snapshot before the 1st
  (`getLiabilityStartBalances`; falls back to the first snapshot this month for a card first
  recorded mid-month), `today` = latest snapshot.
- 2026-10-10 follow-up — user: "the value needs to be how much the card is over the original
  reported balance. The debt payoff is treated separately here." The first version added the
  budget's planned payoff payment; it no longer does. Consequence: a payoff payment made this month
  lowers `today`, so it can mask charges made the same month (pay $300, charge $250 → owes $0).
- Interest posted this month also lands in "charges" — it is real money owed back to stay on plan.
- 2026-10-12 fix — user: "the current balance doesn't reflect current spending … take the credit
  limit minus available, or the current balance plus all pending transactions, then subtract where
  I started the month." `today` is now **latest balance + net pending on that card** (pending
  debits add, pending credits subtract). Credit-card available credit isn't stored (sync records the
  ledger balance only), so the pending route is used; it equals limit − available.
- Same figure exposed to agents as MCP tool `get_card_rebalance` (per card: start, balance,
  pending, now, change, owe; plus totalOwe and missing). Dashboard and tool both build it through
  `cardRebalanceFrom` so they can't disagree.

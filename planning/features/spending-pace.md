# Feature: Spending Pace

**Status:** live · **Entry:** dashboard "Spending pace" card → `/pace`; settings at `/settings/pace`;
MCP `get_spending_pace`

> Intent from the owner's feature request (2026-11). Backtest results against live history are in
> `planning/progress/` (git-ignored) — never here.

## Intent / why
A slow-moving monitor that says when discretionary spending has been **consistently** outpacing
what income leaves room for. It must not react to one big night or one big purchase; it should
only flag a pattern that holds for one to two weeks or longer.

The failure it exists to catch is the quiet one: a long run of small card charges plus the
occasional large night, none of which looks alarming on its own, adding up to a pace well over
break-even for months while card balances climb. Nothing per-transaction can see that, so
everything here works on trailing averages and holding periods.

Tone is part of the spec: factual, no guilt, no exclamation marks; numbers, not judgments.

## What it does
- Every day it recomputes an **income baseline**, **fixed costs**, an **essentials baseline** and a
  **savings target**, and from them a **break-even** and a **target** allowance per day.
- It averages **discretionary** spend over trailing 7-, 14- and 28-day windows and runs a status
  machine — **Green / Watch / Warning / Alert** — with hysteresis.
- Leading indicators (charge frequency, merchant streaks, big nights, card behavior, projected
  month-end net) are shown as context; they never set the status.
- A **weekly digest** (default Sunday 18:00) always posts; an **immediate notice** posts only on an
  escalation to Warning or Alert, once per escalation. Both land in the advisor **Insights** feed
  (the app's notification channel; it badges the nav and the dashboard Advisor card).
- The user can tag a charge as a **one-off**: excluded, or spread evenly over 90 days. Never automatic.

## How it works today
- Pure engine: `src/server/lib/spending-pace.ts` — `makeClassifier`, `replayPace`, `stepStatus`,
  `allowances`, `smoothedPayroll`, `paceIndicators`, `buildDigest`, `escalationNotice`,
  `paceSentence`, `normalizePaceConfig`. No DB, no clock.
- Service: `src/server/pace.ts` — `computePace` (load → replay → indicators → stale check),
  `runPaceJob` (notices + digest), config/state in `app_settings`.
- Loader: `paceLedger` / `paceSyncFreshness` in `src/server/queries.ts`. No session check of
  their own (the job has no request); every page/action caller calls `requireSession` first.
- Scheduler: `src/server/sync/pace-scheduler.ts`, started from `src/instrumentation.ts` beside the
  bank-sync scheduler (production only; `PACE_SCHEDULER=0` opts out). 15-minute idempotent ticks.
- Actions: `src/server/actions/pace.ts` — `tagOneOff`, `removeOneOff`, `savePaceSettings`.
- UI: `src/components/dashboard/PaceCard.tsx`, `src/app/pace/page.tsx`,
  `src/components/charts/PaceChart.tsx`, `src/components/pace/OneOffControls.tsx`,
  `src/app/settings/pace/page.tsx` + `src/components/settings/PaceSettingsForm.tsx`.

### The calculation (per evaluated day, trailing `baselineDays` = 90)
- **Income** — credits in `incomeCategories` (default `Deposit`) on non-liability accounts.
  Paychecks (matched by the pay schedule's deposit pattern) are smoothed: same-week deposits merge
  into one paycheck, then *median paycheck × 30.4 / median spacing*. So six vs seven biweekly
  checks in the window, or a three-check month, don't move it. Other income is a plain average.
- **Fixed** — for each bill that isn't a card payment: this month's instance amount when it has
  one (> 0, not cancelled, not No Balance/Skipped/Suspended), else that bill's own linked spend
  averaged over the window. Plus spend in `fixedCategories` (default Housing, Utilities) that no
  bill accounts for. Card-payment bills (a bill linked from a Credit account) are excluded: the
  purchases they pay off are already counted on their own dates.
- **Essentials** — `essentialsCategories` (default Food/Groceries, Gas, Essentials), averaged.
- **Savings** — `savingsPct` (default 20) of income.
- **Break-even/day** = (income − fixed − essentials) / 30.4; **target/day** subtracts savings too.
  Always computed; never hardcoded.
- **Discretionary** — every remaining debit, net of refunds (credits in a spending category, or an
  uncategorized credit on a card). Excluded: transfers (`transferPartnerId` or category Transfer),
  `excludedCategories` (Transfer, Debt Repayment, Investing, Savings), card-payment bills,
  uncategorized cash-account debits matching `cardPaymentPattern`, loan-account rows, fixed
  bills/categories, essentials. Interest and fees (`carryingCategories`) are their own line,
  "cost of carrying debt". Card purchases count on the transaction date.

### Status machine (`stepStatus`)
- Candidate: **Alert** if the 28-day average > 1.25 × break-even, or card balances have grown
  for 3+ weekly checks (each check is "higher than 4 weeks earlier"), held `alertDays` (1).
  Else **Warning** if the 14-day average has been over break-even for `warningDays` (7)
  consecutive evaluations. Else **Watch** if the 14-day average is over target or the 7-day is
  over break-even. Else **Green**.
- Up: immediately to the candidate (its hold already happened). Down: only after
  `deescalateDays` (7) consecutive days below the current level's *threshold* (raw condition, no
  hold), then to the highest candidate seen in those days.
- The status is never stored. Every read replays the last 120 days from Green (`REPLAY_DAYS`),
  so the card, page, digest and notices always agree, and a config change applies retroactively.

## Non-obvious logic / edge cases
- **Card growth uses 4-week deltas.** A plain week-over-week rise fires every month for anyone
  who charges all month and pays once. Comparing to four weeks earlier spans a payment cycle.
- **Splits** arrive as pieces (own remainder + each part) under their own categories; **cash
  withdrawals** count only what logged wallet purchases didn't explain. Both use the same SQL share
  rules as category spend (`ownShare` / `pieceShare`).
- **Pending** rows count. `dropPostedPending` drops a pending row once a posted twin exists (same
  account and direction, −3…+10 days, amount within a tip, same merchant word); sync usually
  merges them first anyway.
- **Refunds in a later period** subtract on the day they land; window sums floor at zero.
- **Stale** — sync on, and some enabled bank account hasn't synced in `staleDays` (2): the status
  shows "Stale" and no escalation notice is sent. With sync off (manual entry) it's never stale.
- **History start** — baselines never reach before the earliest transaction, so a new install
  averages over what it has instead of diluting with empty days.
- **Notices are idempotent.** `app_settings.spending_pace_state` holds `notified` keys
  (`date:level`) and `lastDigestOn`; insight dedupe keys are `pace-escalation-…` / `pace-digest-…`.
  Only events from the last two evaluations can notify, so first deploy doesn't replay history.
- **Projected month-end net** = income − (fixed + essentials + discretionary so far this month
  + 14-day pace × days left).

## Data model
- `pace_one_offs` (`drizzle/0035_pace_one_offs.sql`): `txn_id` (unique, FK cascade), `mode`
  (`exclude` | `spread`), `note`.
- `app_settings` keys `spending_pace` (config, normalized on read) and `spending_pace_state`.
- Everything else is read from the existing ledger: transactions, splits, cash allocations,
  bills/instances, accounts, statement balances, sync accounts, pay schedule.

## How to extend it
- New setting: add to `PaceConfig`, `DEFAULT_PACE_CONFIG`, `normalizePaceConfig`, the form.
- New indicator: compute it in `paceIndicators`; show it on `/pace`, in `buildDigest` and the MCP tool.
- A push or email channel: post from `runPaceJob` where it calls `upsertInsights`; the
  idempotency keys already guarantee one notice per escalation.

## Related
- [ai-advisor.md](ai-advisor.md) (Insights feed), [budget.md](budget.md), [cash-offsets.md](cash-offsets.md),
  [transaction-splits.md](transaction-splits.md), [pending-transactions.md](pending-transactions.md),
  [pay-schedule.md](pay-schedule.md), [dashboard.md](dashboard.md)

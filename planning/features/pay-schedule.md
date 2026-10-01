# Feature: Pay Schedule & payday countdown

**Status:** live · **Entry:** `/settings/pay-schedule` (setup) + `/dashboard` (countdown widget)

## Intent / why
Every other surface in this app looks *backward* — what was billed, what was paid, what the balances
were. This one looks *forward*. The user asked for it explicitly as a motivational device: knowing
"4 days to go" makes the cash currently on hand feel like a resource that has to last, rather than a
balance to spend down. The stated goal was two-sided: **hold on to the money**, and **know when more
is coming**.

Design choices confirmed with the user on 2026-07-18 (not inferred):

- **No weekend/holiday adjustment.** The countdown targets the nominal date — the 15th is the 15th even
  on a Sunday. The user preferred a rule they can predict over one that is subtly "smart". The whole
  rule lives at the `clampToMonth` callers in `src/server/lib/pay-schedule.ts`; nothing downstream
  knows about it, so switching to "Friday before" later is a local change.
- **Countdown only — no spending math.** A "safe to spend per day" figure was offered and declined.
  The widget shows days, date, and incoming amount. It deliberately does *not* net out bills due
  before payday. Resist adding that without asking; it changes the card from motivating to nagging,
  and it would overlap [dashboard.md](dashboard.md)'s outstanding-bills rollup.
- **One take-home for every paycheck.** Per-payday amounts were offered and declined. If that changes,
  it's a second decimal column, not a new table.

Intent that competes with a sibling feature: [savings-goals.md](savings-goals.md) reserves
`goal_contributions.transactionId` as "the seam a future paycheck-allocation module writes into".
This feature is **not** that module — it projects dates and an estimate, and writes no ledger rows.
It is the setup surface that module would build on.

## What it does
- Settings → Pay Schedule: pick a cadence (weekly / every 2 weeks / twice a month / monthly), enter
  the payday date(s) or an anchor payday, and an estimated take-home per paycheck. A live preview
  shows the resulting countdown before saving.
- Dashboard: a card above the financial-standing row showing days until the next payday, the date,
  the amount incoming, a progress bar through the current pay period, and an approximate monthly
  figure. Unconfigured, it degrades to a dashed "set up your pay schedule" prompt.
- The card's color warms as payday nears: indigo (3+ days) → amber (≤2 days) → emerald + 🎉 on the day.

## How it works today
- `src/server/lib/pay-schedule.ts` — all the date math, pure and dependency-free.
  `resolvePaydays()` (next + previous payday), `payCountdown()` (adds days/progress/period length),
  `countdownLabel()`, `paychecksPerYear()`, `todayIso()`.
- `src/server/queries.ts` — `getPaySchedule(): Promise<PayScheduleRow | null>`. Null means
  "not set up", never an error.
- `src/server/actions/pay-schedule.ts` — `savePaySchedule()` (upsert + validation, returns
  `{ ok, error }`), `clearPaySchedule()`. Revalidates `/settings/pay-schedule` and `/dashboard`.
- `src/app/settings/pay-schedule/page.tsx` → `src/components/settings/PayScheduleForm.tsx` (client).
- `src/components/dashboard/PaydayCountdown.tsx`, rendered from `src/app/dashboard/page.tsx`.
- `src/constants/enums.ts` — `PAY_FREQUENCIES` + `PAY_FREQUENCY_META` (label, blurb, emoji, and
  `usesDays`, which is what the settings form branches on to pick its input fields).

## Non-obvious logic / edge cases
- **All dates are ISO `YYYY-MM-DD` strings parsed by parts.** `new Date(iso)` reads as UTC midnight
  and shifts a day in US timezones. `daysBetween` converts to `Date.UTC` epoch ms, so DST transitions
  can't produce a 13- or 15-hour day that rounds wrong. Verified across the 2027 spring-forward.
- **Today counts as "next".** On payday, `daysUntil` is 0 and `progressPct` is 100 — the card
  celebrates rather than rolling forward to the next period. `Math.ceil` in the anchor branch is what
  makes this true for weekly/biweekly; a `floor` would skip payday entirely.
- **Day-of-month clamps to month length.** A 31st payday lands on the 30th in April and the 28th/29th
  in February. `clampToMonth` handles this; a 31st payday in February is *not* an error.
- **The projection walks a 3-month window** (previous/current/next). Scanning only the current month
  breaks when today sits past the last payday of its month, and the previous-month leg is what makes
  `previous` (and therefore the progress bar) correct on the days before the month's first payday.
- **Semi-monthly period lengths vary** (e.g. paydays on the 1st and 15th give periods of 14 to 17
  days). The progress bar is therefore not comparable between periods. Feb 15 → Mar 1 is genuinely
  14 days; that is not a bug.
- **`savePaySchedule` sorts the two days ascending** before writing, so the form and the projection
  window can never disagree about which is "first".
- **Fields the chosen cadence doesn't use are nulled, not preserved.** Switching semimonthly →
  biweekly clears `dayOne`/`dayTwo`; otherwise a stale value could leak into a later projection.
- **The card is not month-scoped.** The rest of the dashboard reflects the month in `?period=`; this
  card always speaks about right now. That is why it sits *above* the standing row rather than in it.
- `takeHome` is DECIMAL — drizzle returns it as a string, so it goes through `toNum()` on read and
  `String()` on write, like every other money column.

## Data model
`pay_schedule` in `src/server/db/schema.ts`, created by `drizzle/0013_add_pay_schedule.sql`
(applied 2026-07-18 via `npx tsx scripts/apply-sql.ts`, like every migration since 0005 — the
drizzle journal stops at 0004).

Single-row config table, always `id = 1`. This is a departure from the other settings tables, which
are lookup *lists*; there is one earner and one schedule, so a singleton row keeps reads a plain
`.limit(1)` with no "which row is active?" ambiguity. `frequency` is VARCHAR + an `enums.ts` const so
a new cadence needs no migration. Columns: `frequency`, `day_one`, `day_two`, `anchor_date`,
`take_home`, `active`, `notes`, timestamps. Which columns matter depends on the cadence —
semimonthly/monthly use the day columns, weekly/biweekly uses `anchor_date`; the rest stay NULL.

## How to extend it
- **New cadence** — add to `PAY_FREQUENCIES` + `PAY_FREQUENCY_META` (set `usesDays`), then handle it
  in `resolvePaydays`. No migration.
- **Weekend/holiday shifting** — one adjustment function applied to `clampToMonth`'s output, plus a
  toggle column. Everything downstream already consumes whatever date is produced.
- **Per-payday take-home** — a second decimal column and a branch in `payCountdown` on which of the
  two dates `next` is.
- **Paycheck allocation (auto-fund goals on payday)** — this is where it meets
  [savings-goals.md](savings-goals.md); write `goal_contributions` rows against the reserved
  `transactionId` seam. Confirm intent first — it crosses two features.

## Related
- Sibling features: [dashboard.md](dashboard.md), [savings-goals.md](savings-goals.md)

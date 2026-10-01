# Feature: Savings goals

**Status:** live · **Entry:** `/goals` (+ a dashboard panel)

> Intent from memory + code comments; confirm with the user if the regress model reads wrong.

## Intent / why
A goal accumulates money toward a target (emergency fund, a purchase, or a set amount toward a
debt). The distinctive design intent: progress is **not one editable number** but a running
**SUM of an append-only contribution ledger**, and for goals backed by a real cash account the
allocation is **reality-checked against that account's recorded balance** — so a goal can
*regress* (show a shortfall) when the funding account dips below what you've allocated. It answers
"how close am I, and is that money *actually still there*?"

## What it does
Create goals with a target, optional deadline, funding account, color/emoji, and a priority order.
Fund/withdraw via a ledger. Each goal shows a two-segment progress bar: **backed** (covered by the
funding account's balance) vs **shortfall** (allocated but not currently covered). Dashboard shows
the top active goals with under-funded flags.

## How it works today
- Page: `src/app/goals/page.tsx` (`GoalsPage`) — loads goals + accounts, fetches each goal's
  contribution ledger in parallel, renders `GoalCard`s + an archived `<details>` section.
- Actions: `src/server/actions/goals.ts` — `createGoal`, `updateGoal`, `setGoalStatus`,
  `deleteGoal` (deletes ledger rows first — no cascade), `addContribution` (+fund / −withdraw),
  `deleteContribution`; `revalidateGoals()` refreshes `/goals` + `/dashboard`.
- Core query: `src/server/queries.ts` `getGoalsWithProgress(asOf?)` (the fill algorithm),
  `getGoalContributions(goalId)`, `getCashOnHand(asOf?)` (drives the reality check).
- Components: `src/components/goals/GoalCard.tsx`, `AddGoal.tsx`.
- Dashboard panel: `src/app/dashboard/page.tsx` (bar logic **duplicated**, keep in sync).
- Enums: `GOAL_TYPES`, `GOAL_TYPE_META`, `GOAL_STATUSES` in `src/constants/enums.ts`.

## Non-obvious logic — contribution ledger + funding-account regress
`funded = SUM(goal_contributions.amount)` — always recomputed from the ledger; there is no stored
"current amount." The **regress reality-check** in `getGoalsWithProgress`:
1. `getCashOnHand(asOf)` → latest balance snapshot per Checking/Savings account on/before `asOf`.
2. Each goal starts fully backed (`backed = funded`, `shortfall = 0`).
3. Group non-archived, cash-backed goals (that have a recorded balance) by `funding_account_id`.
   Goals with no funding account / archived / non-cash / no snapshot are **skipped** → stay fully
   backed.
4. Per account, walk its goals in **priority order** (`sort_order, id`) and greedily fill from the
   account balance: `covered = clamp(funded, 0, remaining)`, `shortfall = funded − covered`,
   `remaining -= covered`. So when one account funds several goals and can't cover the sum, the
   **lowest-priority goals absorb the shortfall** and regress.

Debt-payoff goals are context-only: their linked account is a liability, never appears in
`getCashOnHand`, so they're skipped by step 3.

## Edge cases / gotchas
- **`asOf` matters.** `/goals` uses now; the dashboard uses `monthEnd` — the same goal's shortfall
  can differ between surfaces (each reads the account's latest snapshot on/before that date).
- **No snapshot = no reality check** — a cash-backed goal whose account has zero recorded balances
  is treated as fully backed; the check silently no-ops until a balance is imported.
- **Reality check is zero-sum and doesn't know what cash is "for"** — two goals on one account
  compete purely by `sort_order`; it doesn't account for cash earmarked by bills.
- **Withdrawals can push `funded` negative**; bars guard with `Math`/`target>0` but the number
  isn't floored.
- **`status="achieved"` is not auto-set** — reaching target only flips a visual "✔ reached"; the
  user archives/achieves manually.
- Decimals stored as strings; convert via `toNum`/`String(...)` at boundaries.

## Data model
- `savings_goals` (`schema.ts`): `goal_type` (VARCHAR + enum const → new kinds need no migration),
  `target_amount`, `target_date?`, `funding_account_id?` (FK accounts), `color`/`emoji`, `status`,
  **`sort_order`** (priority driving the fill), `notes`.
- `goal_contributions` (append-only ledger, same pattern as `account_balances`): `goal_id` FK,
  `amount` (+fund/−withdraw), `occurred_on`, `note?`, **`transaction_id?` FK → transactions
  `ON DELETE SET NULL`** — the pre-built seam for a future paycheck/windfall allocation module
  (currently never written).
- Migration `drizzle/0012_add_savings_goals.sql`.

## How to extend it
- **New goal type/status**: add to `GOAL_TYPES`/`GOAL_STATUSES` (+ `GOAL_TYPE_META`) in
  `enums.ts` — no migration (VARCHAR by design).
- **Change progress/regress math**: fully centralized in `getGoalsWithProgress` (`queries.ts`) —
  both surfaces consume its `funded/backed/shortfall`.
- **Paycheck/windfall allocation (planned)**: write `goal_contributions` rows with
  `transaction_id` set — the FK seam already exists.

## Related
- Reads: [accounts-and-balances.md](accounts-and-balances.md) (funding-account balances via
  `getCashOnHand`) · surfaced in [dashboard.md](dashboard.md)

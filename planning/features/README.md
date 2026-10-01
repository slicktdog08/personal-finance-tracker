# Features — how each feature works, in full

One file per feature (or tightly-related group). A feature doc owns that feature **completely**:
its **intent and why** *and* its **implementation** — the doc you wish existed before you started
touching it. This is the *only* place a feature is explained; `design/` does **not** carry a
parallel per-feature spec (see the philosophy below).

```
planning/features/<feature-slug>.md      e.g. csv-import.md, savings-goals.md, dashboard.md
```

## Index
| Feature | Doc | What it covers |
|---|---|---|
| CSV import | [csv-import.md](csv-import.md) | Mapping-driven bank-CSV import: column guessing, split Debit/Credit, dedup, balances → ledger |
| PDF statement import | [pdf-import.md](pdf-import.md) | Per-issuer PDF parsing (unpdf, no OCR), statement balances, reuses the CSV commit path |
| Categorization & rules | [categorization.md](categorization.md) | Rule engine, mass-categorize, category management, bill linking |
| Accounts & balances | [accounts-and-balances.md](accounts-and-balances.md) | One dated ledger for cash + liabilities; /accounts, /debts, /dashboard as three lenses |
| Savings goals | [savings-goals.md](savings-goals.md) | Contribution ledger + funding-account regress reality-check |
| Internal transfers | [transfers.md](transfers.md) | Detect/link two sides of a transfer; exclude from income/spend |
| Dashboard | [dashboard.md](dashboard.md) | Month-scoped at-a-glance home; custom SVG charts; as-of historical reads |
| Pay schedule | [pay-schedule.md](pay-schedule.md) | Payday cadence + take-home; forward-looking countdown on the dashboard |
| Cash offsets | [cash-offsets.md](cash-offsets.md) | Tie wallet purchases to the withdrawal that funded them; unaccounted cash still counts as spending |
| Pending transactions | [pending-transactions.md](pending-transactions.md) | Hand-entered pending charges; fuzzy match + merge with the posted row on import |
| Budget | [budget.md](budget.md) | Monthly plan vs. actual from transactions; debt-snowball generator; payoff projection |
| Transaction splits | [transaction-splits.md](transaction-splits.md) | Split one transaction across categories; the row's category keeps the remainder |

_Keep this table in sync when you add a feature doc._

## What a feature doc contains
- **Status + entry point** (route/command).
- **Intent / why** — the problem it solves and the *why* behind the key design choices. This is
  first-class content here, not a footnote.
- **How it works today** — real data flow, key files (`path` + function names), important types,
  non-obvious rules and edge cases.
- **How to extend it** — where the common changes go.
- **Related** — sibling features, decisions.

Keep it terse and *true to the code*. When the doc and the code disagree, the code wins — update
the doc. Reference code by `path` (and `path:line` for specifics). Absolute dates only. Start from
[_TEMPLATE.md](_TEMPLATE.md).

## Always surface intent when writing one — REQUIRED
A feature doc's job is to capture *why*, so before writing or substantially updating one, **ask the
user about intent** — don't infer it silently from the code. Concretely:
- Ask what problem the feature is really for and what the non-obvious design choices were *meant*
  to achieve, whenever that isn't already stated in an existing doc or code comment.
- **Watch for intent drift/conflict.** When two features imply different goals for the same data,
  or the code now does something the original intent didn't call for, **stop and flag it to the
  user** rather than papering over it in prose. Record the resolution (and lock it in
  [../design/07-decisions.md](../design/07-decisions.md) if it's a real decision).
- If you inferred intent instead of confirming it (e.g. when backfilling an old feature), **say so
  in the doc** — a short "Intent inferred from <source>; confirm" note — so the gap is visible.

The point: the moment intentions start to blur is exactly when a human should weigh in. A feature
doc that only describes *what the code does* has failed at its one distinctive job.

## When to write / update one
- New doc when a **feature ships or grows** past "just read the code."
- Update the existing one when behavior changes. The feature doc reflects *the new steady state*;
  git history records *that a change happened*.

---

## Philosophy: features vs design

The clarified split for this repo:

- **`design/` = high-level app design choices only.** The durable, app-wide "shape": vision, the
  data model, architecture, migration strategy, the roadmap, and locked decisions. It is *not* a
  place for per-feature specs. If a doc is really about one feature, it belongs in `features/`,
  not `design/`. (This is why the old `design/05-csv-import.md` was folded into
  [csv-import.md](csv-import.md).)
- **`features/` = one feature, end to end.** Why + intent + implementation, self-contained. No
  design counterpart to keep in sync.
- Feature docs get *rewritten in place* when behavior changes — they are not a journal.

### Quick decision
1. A high-level, app-wide choice / schema / a decision to lock? → `design/`
2. How a specific shipped feature works (why + how)? → `features/` (here)

When both seem to fit, write the durable explanation **once** (in `features/` for a feature, in
`design/` for an app-wide choice) and **link** to it from the other — don't duplicate.

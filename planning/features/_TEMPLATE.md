# Feature: <name>

**Status:** live | in-progress | planned · **Entry:** <route / command, e.g. `/import`>

> One feature, end to end — intent, why, and implementation. When the doc and the code disagree,
> the code wins; fix the doc. Reference code by `path` (`path:line` for specifics). Absolute dates.
>
> Before writing/updating this doc, **confirm intent with the user** (see
> [README.md](README.md#always-surface-intent-when-writing-one--required)). If you inferred
> anything rather than confirming it, leave a short "Intent inferred from <source>; confirm" note.

## Intent / why
The problem this solves, and the *why* behind the non-obvious design choices. First-class content
— not a footnote. Call out any intent that competes/overlaps with another feature.

## What it does
A few lines of user-facing behavior.

## How it works today
The real data flow. Key files with paths + function names; the important types; the entry points.
- `src/...` — <what lives here>
- Server actions: `src/server/actions/<x>.ts` — <functions>
- Pure logic: `src/server/lib/<x>.ts` — <functions>

## Non-obvious logic / edge cases
The subtle rules a future session could break by accident. Be specific.

## Data model
Tables/columns (`src/server/db/schema.ts`) and the migration(s) (`drizzle/00xx_*.sql`) involved;
what's live vs legacy.

## How to extend it
Where the common changes go (add a variant, a field, a rule, etc.).

## Related
- Sibling features: [<x>.md](<x>.md)
- Decisions: [../design/07-decisions.md](../design/07-decisions.md)

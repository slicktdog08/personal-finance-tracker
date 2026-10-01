# Planning & Docs

This folder is the project's memory outside the code. Read the relevant doc before
starting work; update it after finishing.

The root of this folder holds **only this README and folders** — every document lives in one
of them.

## Layout

| Folder | What's in it | Who writes it |
|--------|--------------|---------------|
| [design/](design/) | The project's design & spec docs — overview, data model, architecture, roadmap, locked decisions (`00`–`07`). The *intent & why*, sometimes aspirational | Humans/AI on direction or schema changes |
| [features/](features/) | Current-state "how does feature X work **now**" docs — one per feature. The *what/how it is today* | Update when a feature's behavior changes |

**Which folder?** Pick by the question you're answering: *what are we building & why* → `design/`;
*how does the shipped feature work now* → `features/`. Full guide with the tricky distinctions: [features/README.md](features/README.md#philosophy-features-vs-design).

### design/

| Doc | Purpose |
|-----|---------|
| [00-overview.md](design/00-overview.md) | Vision, scope, goals & non-goals |
| [01-data-inventory.md](design/01-data-inventory.md) | Format of the Notion export the seed script supports |
| [02-data-model.md](design/02-data-model.md) | The MySQL schema and why |
| [03-architecture.md](design/03-architecture.md) | Stack, structure, DB-access strategy |
| [04-migration-and-seed.md](design/04-migration-and-seed.md) | Loading history, the DDL blocker |
| [06-roadmap.md](design/06-roadmap.md) | Phased build plan |
| [07-decisions.md](design/07-decisions.md) | Locked decisions (the "don't relitigate" list) |

Per-feature docs (including the former `05-csv-import`) now live in
[features/](features/) — design holds only high-level app choices. See the
[features index](features/README.md#index).

## Decisions vs. the rest of design

- **`design/07-decisions.md` — locked decisions only.** The short list of choices that
  should not be reopened without a deliberate reason.
- The rest of `design/` captures the destination we're building toward; `features/`
  captures what has actually shipped.

## Working conventions

1. **Read before you write.** Skim `design/07-decisions.md` and the relevant `features/` doc
   at the start of a session so you don't relitigate settled choices or duplicate work.
2. **Lock what's settled.** When a real decision is made, add it to `design/07-decisions.md`.
3. **Keep the schema doc honest.** A migration under `drizzle/` should be reflected in
   `design/02-data-model.md`.
4. **Dates are absolute.** Write `2026-07-17`, never "today" — these docs outlive the session.

# Development

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve |
| `npm run db:init` | Create the schema in an empty database |
| `npm run auth -- <create\|passwd\|list\|token>` | Manage built-in sign-in accounts ([authentication.md](authentication.md)) |
| `npm run seed:demo` | Fill the database with fictional sample data (`-- --reset` wipes first) |
| `npx tsx scripts/apply-sql.ts --pending` | Apply new hand-written migrations |
| `npx tsx scripts/seed-config.ts` | Re-seed the default statuses, payment types and categories (never overwrites your edits) |
| `npm run seed` | Optional: import a Notion bill-tracker export from `notion_data/` ([format](../planning/design/01-data-inventory.md)) |
| `npm test` | Unit tests (`node:test`, no database) |
| `npm run db:test:up` · `npm run test:e2e` | End-to-end tests against a throwaway MySQL in Docker |
| `npm run sync -- <cmd>` | Bank-sync CLI: `status`, `sync --dry-run`, `runs`, `settings`… |
| `npm run check:private` | Scan staged changes for personal data (also runs as a pre-commit hook) |

**Tests.** Unit tests are pure. End-to-end tests insert and delete real rows, so they get their own database:

```bash
cp .env.test.example .env.test
npm run db:test:up        # MySQL 5.7 on 127.0.0.1:3307, fresh schema every time
npm run test:all
```

The test runner refuses to start unless `DATABASE_URL` points at the local machine. It also
refuses outright if it resolves to the same host as `.env.local`. If an e2e run ever leaves
rows behind, `npm run purge:e2e` finds them.

**Layout**

```
src/app/           pages: dashboard, months/[period], transactions, import, accounts, debts,
                   budget, goals, cash, transfers, settings/*; api/mcp, api/sync
src/components/    UI, grouped by feature
src/server/
  actions/         server actions (every one calls requireSession())
  queries.ts       read queries
  db/schema.ts     Drizzle schema
  lib/             money, dedup, categorize, budget, cash projection, pdf/, sync/
  mcp/             MCP server, tools, prompts, advisor profile loader
  auth/            sign-in: provider switch, local/ (built-in), cognito/, session
drizzle/           SQL migrations
scripts/           db init, migration runner, seeding, account + bank-sync CLIs, docker entrypoint
tests/             unit/, e2e/, db/schema.sql (fresh-install + test schema)
docs/              user guides (this folder) and screenshots
planning/          design docs and per-feature docs (start at planning/README.md)
config/            advisor-profile.example.json (template for scripts/advisor-profile.ts import)
```

**Keeping personal data out of the repo.** This code is public, but the database holds your
real finances. Personal context the app needs (the advisor profile) lives in the database too,
in `app_settings`, so a fresh clone or deploy needs nothing copied in. The rest lives in
git-ignored files:

| Ignored | Holds |
|---|---|
| `.env*` (except the two `.example` files) | Credentials |
| `config/advisor-profile.json` | Optional file version of the advisor profile (the DB copy wins) |
| `planning/progress/`, `planning/projects/` | Dev logs and side projects that quote real numbers |
| `private/`, `notion_data/`, `temp/`, `.setting/` | Statements, exports, scratch files |

`npm ci` installs a pre-commit hook (`.githooks/pre-commit` → `scripts/check-private.sh`).
It blocks those files if they're ever force-added. It also blocks any added line that matches
patterns you list in `~/.config/personal-finance-tracker/private-patterns` (or a git-ignored
`.private-patterns` in the repo), one regex per line (account last-4s, card names, employer
and so on). Keeping it in your home directory means every clone and worktree is covered. `CLAUDE.md` tells Claude Code to use illustrative
values in code, tests and docs.

## Screenshots

The images in `docs/screenshots/` are taken from a demo-seeded instance, so they never show
real data. To retake them after a UI change, start the app with `DEMO_MODE=1` against a
scratch database and run `npx tsx scripts/screenshots.ts http://localhost:3000`.

## Design docs

`planning/` is the project's long-form memory:
- `design/`: data model, architecture and locked decisions.
- `features/`: one doc per feature explaining how it works today.

Read the relevant feature doc before changing a feature. This project runs a newer Next.js
than most tutorials cover, so check `node_modules/next/dist/docs/` before relying on older patterns.

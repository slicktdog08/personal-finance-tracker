---
name: setup
description: Interactive first-time setup for this finance tracker — creates .env.local, checks the MySQL database and schema, seeds lookup tables, walks through AWS Cognito, and interviews the user to write their private advisor profile (config/advisor-profile.json). Use when someone has just cloned the repo, asks how to get it running, or wants to (re)write their advisor profile.
---

# Setup

Walk the user through getting their own copy of this app running. Go one step at a time,
check what already exists before asking, and skip any step that is already done. Ask only
what you can't detect.

## Ground rules — personal data

This app holds someone's real finances. Everything personal stays in **git-ignored** files:

| File | Holds |
|------|-------|
| `.env.local` / `.env.production` | DB password, Cognito IDs, encryption keys |
| `config/advisor-profile.json` | Income, debts, goals, life situation |
| `notion_data/` | Optional Notion export for `npm run seed` |

- Never write real values into a tracked file (README, `.env.example`, code, tests, docs).
- Before finishing, run `git status --porcelain` and confirm none of the files above show
  up. If one does, stop and fix `.gitignore` before anything else.
- Never print the user's passwords or keys back to them in full.
- Never commit or push on the user's behalf during setup.

## Step 1 — Prerequisites

Check `node --version` (needs 22+; the Dockerfile pins 22.20) and that `node_modules` exists
(else run `npm ci`). Note whether `docker` is available (only needed for the test database).
Read `AGENTS.md`: this is a newer Next.js than you may know — consult
`node_modules/next/dist/docs/` before changing any Next code.

## Step 2 — `.env.local`

If `.env.local` is missing, copy it from `.env.example`. Then ask for, and fill in:

1. `DATABASE_URL` — a MySQL 5.7+ URL. The password may contain `@`; it is parsed on the
   last `@` (see `src/server/lib/db-url.ts`), so do **not** percent-encode it.
2. `DATABASE_MIGRATION_URL` — only if the runtime user lacks CREATE/ALTER.
3. `SYNC_TOKEN_ENCRYPTION_KEY` — generate it yourself with `openssl rand -hex 32`;
   don't ask the user for one.
4. Cognito values (Step 5) — leave the `XXXX` placeholders for now if they haven't set
   Cognito up yet, and tell them the app won't start until they're real.
5. `APP_URL` — only needed once deployed behind a proxy; delete the example value for local dev.

## Step 3 — Database and schema

1. Confirm the database exists and is reachable — with a `mysql` client if one is
   installed, otherwise a tiny `npx tsx` script that passes `parseDbUrl(DATABASE_URL)` to
   `mysql2/promise`'s `createConnection` and runs `SELECT 1`. If it doesn't exist, show the `CREATE DATABASE \`personal-billing\`` statement
   and the two GRANTs (runtime: SELECT/INSERT/UPDATE/DELETE; migration: + CREATE/ALTER/INDEX/
   REFERENCES) — let the user run them.
2. Apply the schema: `npm run db:migrate` (journaled 0000–0004), then
   `npx tsx scripts/apply-sql.ts --pending` for the hand-written migrations.
3. Seed lookups: `npx tsx scripts/seed-config.ts`.

## Step 4 — Existing data (optional)

Ask how they track money today:

- **Bank CSVs / PDF statements** → nothing to do now; point them to the **Import** page
  once the app runs. CSV column mapping is learned per file layout.
- **Notion bill tracker** → have them drop the export in `notion_data/` (format in
  `planning/design/01-data-inventory.md`). If they want the account-number guard, set
  `SEED_KNOWN_ACCOUNTS` to their comma-separated last-4s in `.env.local` (not in code).
  Then `npm run seed`.
- **Starting fresh** → skip.

## Step 5 — AWS Cognito (sign-in)

Every page needs a signed-in Cognito user; there is no self-signup. Follow
README → "Authentication → One-time Cognito setup" with them:

1. Create (or reuse) a user pool and a **public** app client (no secret). Put the region,
   pool ID and client ID in `.env.local`.
2. Enable `ALLOW_USER_PASSWORD_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH` on the client.
3. Create their user with `admin-create-user`, using the email they give you.

If they have the AWS CLI configured you can run these for them after confirming each
command; otherwise give the console path.

## Step 6 — Run it

`npm run dev`, then have them sign in at http://localhost:3000 with the temporary password
(they'll be asked to choose a new one). If the page errors, read the server output and fix
the env value it names.

## Step 7 — Advisor profile (for the Claude MCP connector)

The MCP server (`/api/mcp`) prepends `config/advisor-profile.json` to every advisory
conversation. Offer to write it; if they decline, skip — the advisor then asks for context.

Interview them briefly, one topic at a time, and accept "skip" for any of them:

- **Name** the advisor should use (first name or nickname is fine).
- **Situation** — employment/income type and rough take-home, pay frequency, housing.
- **Goals** — near-term (e.g. emergency fund, payoff, a purchase) and long-term.
- **Plan / rules** — debt strategy (avalanche/snowball), money that's off-limits, typical
  monthly spend.
- **Data caveats** — months that are incomplete, stale bills, anything the advisor
  shouldn't trust.
- **Style** — keep the defaults from the example unless they want changes.

Write it in the shape of `config/advisor-profile.example.json`, short factual bullet
strings, `updatedOn` = today. Show them the result and confirm before saving. Remind them
to bump `updatedOn` when the plan changes, and that for Docker deploys the file is either
baked in from `config/` at build time or mounted (see `docker-compose.yml`).

Optional next step: the claude.ai connector — README → "Claude MCP connector".

## Step 8 — Tests (optional)

`npm test` runs unit tests with no database. For e2e: `cp .env.test.example .env.test`,
`npm run db:test:up` (Docker), `npm run test:e2e`. The test DB is throwaway and on port
3307; never point `.env.test` at a real database.

## Finish

Summarize what's configured, what's still a placeholder, and run the `git status` check
from the ground rules.

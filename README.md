# Personal Finance Tracker

A self-hosted, single-user app for running your own money: monthly bills, every bank
transaction, budgets, debt payoff and savings goals in one place. It also ships an MCP
server, so you can connect Claude as a financial advisor that reads your real numbers.

Built with Next.js 16, TypeScript, Tailwind v4, Drizzle ORM and MySQL. Sign-in uses AWS Cognito.

Built by **Tyler Clay** — [tylerthedeveloper.com](https://tylerthedeveloper.com) ·
[Candy Creative](https://candycreative.digital)

---

## Features

**Bills**
- Monthly bill sheets. Start a new month by cloning the last one forward, then edit inline:
  status, amount, due day, payment type.
- Custom statuses and payment types with your own colors and emoji, plus bulk status changes.
- Suggests recurring bills from your transactions, links payments to bills, and merges or renames bills.
- A pay schedule (weekly, biweekly, semimonthly or monthly) with a payday countdown on the dashboard.

**Transactions**
- **CSV import** from any bank: map the columns once and it remembers that layout. Duplicates
  are rejected by a content hash, so re-importing overlapping exports does nothing.
- **PDF statement import** for banks without a usable CSV export. Statement balances
  are recorded too. One parser ships today (Robinhood Spending), and adding more is a single file.
- Categorization rules that apply on import, a mass-categorize screen, and inline edits.
- Split one transaction across categories, attach notes, and track pending transactions
  until they settle.
- Matches transfers between your own accounts so money you moved isn't counted as spending.
- **Cash offsets**: link an ATM withdrawal to the cash purchases it paid for, so cash spending isn't counted twice.

**Accounts and planning**
- One ledger for every account: checking, savings, cash, credit cards and loans, with dated
  balance snapshots and trends.
- **Debts**: APR, minimum payments, credit limits, utilization and monthly interest cost,
  plus avalanche or snowball payoff projections.
- **Budgets**: planned vs. actual per category. Includes a debt-payoff plan generator,
  a savings line, locked lines, auto-rebalancing and a day-by-day projection of your cash to month-end.
- **Savings goals** with contributions and progress.
- **Dashboard**, one month at a time: cash on hand, what you owe, bills, income vs. spending,
  where the money went, and goals.

**Claude as your financial advisor (MCP)**
- A remote MCP server at `/api/mcp`, secured with OAuth through your Cognito user pool.
- 15 read tools: snapshot, month summary, spending and balance trends, debts,
  cash projection, budget, goals, transaction search and more.
- 8 write tools that only add or edit, never delete: categorize, split, bill status, goal
  contribution, budget line, debt target, manual transaction, balance snapshot. There's also
  a `run_bank_sync` tool for when a sync provider is connected.
- Built-in prompts: `monthly_review`, `can_i_afford`, `debt_payoff_plan`, `budget_check_in`.
- A private **advisor profile** (`config/advisor-profile.json`, git-ignored) gives Claude
  your situation and plan. It's prepended to every advisory conversation.

**Bank sync** (engine only): scheduler, webhooks, reconciliation, encrypted token storage
and a settings page are built and tested, but **no bank provider is connected yet**. The first
provider (Teller) shut down its API. A new one plugs in behind
`src/server/lib/sync/provider.ts`; see `planning/features/bank-sync.md`.

## What you need

| | Required | Notes |
|---|---|---|
| **Node.js 22+** | ✅ | The Docker image uses `node:22-alpine` |
| **MySQL 5.7+** | ✅ | Tested on 5.7. MariaDB works for local development. Any managed MySQL is fine |
| **AWS account + Cognito user pool** | ✅ | Handles sign-in. Free at personal scale. No self-signup: you create your own user |
| **A server that stays running, with HTTPS** | to host | See [Hosting](#hosting) |
| **Docker** | optional | For the end-to-end test database and the included deployment |
| **Claude (claude.ai or Claude Code)** | optional | For the MCP advisor and the guided `/setup` |

## Quick start

### The easy way: Claude Code

```bash
git clone https://github.com/slicktdog08/personal-finance-tracker
cd personal-finance-tracker
npm ci
claude
> /setup
```

The `/setup` skill walks you through each step:
- Writes `.env.local`.
- Checks the database and creates the schema.
- Sets up Cognito.
- Interviews you to write your advisor profile.

It never commits anything personal.

### By hand

1. **Install:** `npm ci`
2. **Configure:** `cp .env.example .env.local`, then fill in at least `DATABASE_URL` and
   the three `NEXT_PUBLIC_*` Cognito values ([Configuration](#configuration)).
3. **Create an empty database** and a user that can create tables in it:
   ```sql
   CREATE DATABASE `personal-billing`;
   CREATE USER 'billing'@'%' IDENTIFIED BY 'choose-a-password';
   GRANT ALL ON `personal-billing`.* TO 'billing'@'%';
   ```
4. **Create the schema:** `npm run db:init`. It loads the full schema and default categories,
   statuses and payment types, then applies any newer migrations. It refuses to run on a
   database that already has tables.
5. **Set up Cognito** ([below](#cognito-sign-in)), then create your user.
6. **Run:** `npm run dev`, open http://localhost:3000, and sign in.
7. *(Optional)* **Advisor profile:**
   `cp config/advisor-profile.example.json config/advisor-profile.json` and describe your
   situation, goals and plan.

Then go to **Import** and load a bank CSV, or add accounts under **Accounts**.

### Cognito sign-in

1. Create a user pool and a **public app client** (no client secret).
2. Enable password auth on the client. This app signs in from the server, so it can't use
   the default SRP-only flow:
   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id "$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \
     --client-id "$NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID" \
     --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
   ```
   `--explicit-auth-flows` *replaces* the whole list. Keep `ALLOW_REFRESH_TOKEN_AUTH` in it,
   or sessions stop renewing after an hour.
3. Create your user:
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id "$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \
     --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
     --temporary-password 'SomeTempPass1!'
   ```
   Your first sign-in asks you to choose a new password.

Every page, server action and API route requires a valid session. `src/proxy.ts` gates
requests, and `requireSession()` checks again in the data layer. Tokens are kept in
`httpOnly` cookies, and the JWT signature is verified on every request.

## Configuration

All settings are environment variables: `.env.local` for development, `.env.production`
for deployment. `.env.example` documents each one.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | `mysql://user:password@host:3306/db`. The password may contain `@` and should not be percent-encoded |
| `DATABASE_MIGRATION_URL` | | A separate user with CREATE/ALTER rights, if the runtime user doesn't have them |
| `NEXT_PUBLIC_AWS_REGION` | ✅ | Cognito region |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | ✅ | User pool ID |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | ✅ | Web app client ID |
| `COGNITO_CLIENT_SECRET` | | Only if your web client was created with a secret |
| `COGNITO_MCP_CLIENT_ID` | | The second app client, for the Claude connector |
| `APP_URL` | prod | Your public origin (`https://finance.example.com`), used in the OAuth discovery documents |
| `PORT` | prod | Port the container listens on (default setup: `9010`) |
| `ADVISOR_PROFILE_PATH` | | Location of the advisor profile. Default: `config/advisor-profile.json` |
| `SYNC_TOKEN_ENCRYPTION_KEY` | sync | `openssl rand -hex 32`. Encrypts stored bank tokens |
| `SYNC_SCHEDULER` | sync | `1` starts the in-process sync scheduler. Leave unset in development |
| `SYNC_CRON_SECRET` | | Bearer token for `POST /api/sync/run` if you'd rather trigger syncs from cron |

## Hosting

The app needs three things in production:

- **A long-running Node process.** The sync scheduler runs in-process, statement uploads can
  reach 25 MB, and PDF parsing can take a while.
- **MySQL.**
- **HTTPS on a domain.** Cognito cookies are `Secure` in production, and claude.ai only connects over HTTPS.

Serverless platforms like Vercel can render the pages, but they cut off the scheduler and
reject large uploads, so a VPS or container host is the better fit.

### Option A: VPS with Docker and nginx (what this repo ships)

Everything is in the repo. The app runs in a container bound to `127.0.0.1:${PORT}`, and
nginx proxies to it with TLS from Let's Encrypt.

```bash
# on the server
git clone https://github.com/slicktdog08/personal-finance-tracker && cd personal-finance-tracker
cp .env.example .env.production        # fill in real values (PORT, DATABASE_URL, Cognito, APP_URL)
cp .env.production .env                # docker compose reads PORT from .env
cp config/advisor-profile.example.json config/advisor-profile.json   # optional, then edit

docker compose build
docker compose run --rm --no-deps --entrypoint '' personal-billing \
  node_modules/.bin/tsx scripts/apply-sql.ts --pending      # on later deploys
docker compose up -d

sh scripts/render-nginx-conf.sh finance.example.com | sudo tee /etc/nginx/sites-available/finance.example.com
sudo ln -s /etc/nginx/sites-available/finance.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d finance.example.com
```

For the first install, run `npm run db:init` once against the production database, from
any machine that can reach it. `.env.production` is only copied into the build stage, never
into the final image. `NEXT_PUBLIC_*` values are inlined at build time, so rebuild the image after changing them.

| File | Role |
|---|---|
| `Dockerfile` | Two-stage build. The runtime image runs as a non-root user |
| `docker-compose.yml` | One service, `restart: always`, listening on loopback only |
| `nginx/template` + `scripts/render-nginx-conf.sh` | Site config with long timeouts and large-body limits for imports |
| `JenkinsFile` | Optional CI/CD (Option B) |

### Option B: Jenkins pipeline (push to deploy)

`JenkinsFile` automates Option A on every build. It runs: clean workspace → restore secrets
→ nginx + certbot over SSH → `docker compose build` → apply pending SQL migrations →
swap the container → prune old images.

One-time setup in Jenkins:
1. Create a **Secret file** credential `personal-billing-env-production` containing `.env.production`.
2. *(Optional)* Create a **Secret file** credential `personal-billing-advisor-profile`
   containing your `advisor-profile.json`. The workspace is wiped on each run, so the
   pipeline restores it from this credential.
3. Create an **SSH credential** `vps-deploy-key` that can log in to the host as `deployer`.
4. Point a Pipeline job at this repo (script path `JenkinsFile`) and set the `DOMAIN` and
   `CERTBOT_EMAIL` parameters.
5. Create the DNS A record **before** the first run, because certbot validates over HTTP.

`APPLY_SQL` (on by default) applies each new `drizzle/*.sql` exactly once and stops the
deploy if one fails. `RUN_MIGRATIONS` runs `drizzle-kit migrate` for the early journaled
migrations, which a fresh install doesn't need.

### Option C: A container platform (Railway, Render, Fly.io…)

Deploy the `Dockerfile` with a managed MySQL. Set the environment variables in the
platform's dashboard. Because `NEXT_PUBLIC_*` values are inlined at build time, they must be
available as **build** variables too. Run `npm run db:init` once against the new database.
Mount or bake in `config/advisor-profile.json` if you use the advisor.

### Updating

Pull, rebuild and redeploy. Before switching to the new container, apply schema changes
with `npx tsx scripts/apply-sql.ts --pending`. It records what it has applied and is safe to re-run.

## Connecting Claude (MCP)

Claude signs in with OAuth 2.0 + PKCE against **your Cognito pool**; the app never issues
tokens itself. When an unauthenticated request hits `/api/mcp`, the app returns `401` with
a pointer to `/.well-known/oauth-protected-resource`. That document names Cognito as the
authorization server. After you sign in on Cognito's hosted page, every call carries a bearer
token that's verified like a web session.

**One-time Cognito setup**
1. **Give the pool a domain** (User pools → Domain; a Cognito prefix domain is fine). Without one,
   the OAuth endpoints don't exist.
2. **Create a second app client** for Claude:
   - Confidential, *with* a client secret.
   - Managed login enabled.
   - Callback URL `https://claude.ai/api/mcp/auth_callback`.
   - Grant type: Authorization code. Scope: `openid`. Auth flows: `ALLOW_REFRESH_TOKEN_AUTH` only.
3. Set `COGNITO_MCP_CLIENT_ID` and `APP_URL`, then redeploy.

**In claude.ai**, go to Settings → Connectors → *Add custom connector* and enter:
- URL: `https://finance.example.com/api/mcp`
- Advanced: the MCP client's ID and secret

For **Claude Code**: `claude mcp add --transport http finance https://finance.example.com/api/mcp`.
Add `http://localhost/callback` and `http://127.0.0.1/callback` to the client's callback URLs.

**Checking it works**
- `curl -i https://…/.well-known/oauth-protected-resource` should return the metadata document.
- `curl -i -X POST https://…/api/mcp` should return `401` with a `resource_metadata` header.
- With the `pb_at` cookie value (copied from your browser's dev tools after signing in) as
  `$TOKEN`, run:
  ```bash
  curl -s -X POST https://…/api/mcp -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

## Development

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve |
| `npm run db:init` | Create the schema in an empty database |
| `npx tsx scripts/apply-sql.ts --pending` | Apply new hand-written migrations |
| `npx tsx scripts/seed-config.ts` | Re-seed the default statuses, payment types and categories (never overwrites your edits) |
| `npm run seed` | Optional: import a Notion bill-tracker export from `notion_data/` ([format](planning/design/01-data-inventory.md)) |
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
  auth/            Cognito sign-in, JWT verification, session
drizzle/           SQL migrations
scripts/           db init, migration runner, seeding, bank-sync CLI, test-db helpers
tests/             unit/, e2e/, db/schema.sql (fresh-install + test schema)
planning/          design docs and per-feature docs (start at planning/README.md)
config/            advisor-profile.example.json (your real profile sits beside it, ignored)
```

**Keeping personal data out of the repo.** This code is public, but the database holds your
real finances, so everything personal lives in git-ignored files:

| Ignored | Holds |
|---|---|
| `.env*` (except the two `.example` files) | Credentials |
| `config/advisor-profile.json` | The advisor's profile of you |
| `planning/progress/`, `planning/projects/` | Dev logs and side projects that quote real numbers |
| `private/`, `notion_data/`, `temp/`, `.setting/` | Statements, exports, scratch files |

`npm ci` installs a pre-commit hook (`.githooks/pre-commit` → `scripts/check-private.sh`).
It blocks those files if they're ever force-added. It also blocks any added line that matches
patterns you list in `.private-patterns`, a git-ignored file with one regex per line (account
last-4s, card names, employer and so on). `CLAUDE.md` tells Claude Code to use illustrative
values in code, tests and docs.

## Documentation

`planning/` is the project's long-form memory:
- `design/`: data model, architecture and locked decisions.
- `features/`: one doc per feature explaining how it works today.

Read the relevant feature doc before changing a feature. This project runs a newer Next.js
than most tutorials cover, so check `node_modules/next/dist/docs/` before relying on older patterns.

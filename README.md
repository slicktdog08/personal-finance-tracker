# Personal Finance Tracker

**The app I built to run my own money, and still use to do it.**

Built by **Tyler Clay** — [tylerthedeveloper.com](https://tylerthedeveloper.com)·
[Candy Creative](https://candycreative.digital)·
[Donate](https://paypal.me/tylerclay2019)

---

## Disclaimer
I am a 9+ year software engineer with experience building apps that store peoples ssn, dob, and other valuable information. 
Effort has been put into ensuring that this app isn't leaking personal information, but its engineered with
agentic tooling. For this reason I recommend ***NEVER*** storing your full account and/or credit/debit card numbers in
either this repo or your database. I cannot accept liability if things go left. You can tell by the apps heavy emphasis 
on debt snowballing that suing me won't net you any money so use at your own risk.

## Support Me
If you want to fork and customize go ahead! If you want a senior software engineer who can architect things like this in a weekend 
or two lets have a conversation. My development experience goes way back before AI but I'm not the type to stick with the shovel 
when the new crew comes in with these shiny excavator things. This would have taken me a few months in the pre-ai era. Enjoy the fruits
of my (and claudes) labor for free. Consider a small donation if this app helped you.

## Why this exists

I've always managed my finances by hand, in a system I maintained myself. First it was a
Monday.com board. Then it was Notion: one database
per month, cloned from the month before, with a row for every bill (amount, due date, how it
gets paid, and whether it's paid yet). Under that sat a transactions layer I filled by
downloading CSVs from each bank and mapping every line to my own categories.

It worked, but it was slow and fragile:
- **Cloning months by hand** meant re-typing structure and fixing due dates that had drifted.
- **Overlapping CSV exports** quietly double-counted transactions.
- **Every month was its own island.** Nothing answered "how am I actually doing?" across months.
- **The bookkeeping crowded out the thinking.** Most of my time went to maintaining the system,
  not using it to make decisions.

In June 2026 I started replacing it with my own app. The first goal was strict parity: keep
the workflow I already trusted, minus the tedium. I imported my full Notion history so nothing
was lost. Then I kept building on top of it as I lived in it:

| When | What got added |
|------|----------------|
| Jun 2026 | Monthly bill sheets, CSV import with duplicate rejection, dashboard, accounts, debts, transfers, PDF statement import, categorization rules |
| Jul 2026 | Running balances from CSV imports, a pay schedule with a payday countdown |
| Aug 2026 | Cash offsets (so ATM cash isn't counted twice), transaction notes |
| Sep 2026 | Budgets with a debt-payoff generator, a cash projection, an MCP server so Claude can act as my financial advisor, bank sync (built, then its provider shut down), pending transactions, split transactions |

Every feature exists because I hit the problem while managing my own money. It's built for one
person and it's opinionated. I'm open-sourcing it as a working example of a personal tool built
with Claude Code as a pair programmer, and as a starting point if you'd rather own your
financial data than rent a budgeting app. Every number in the docs, tests and fixtures is
illustrative; my real data never leaves my own database.

## What it does

### Bills: the monthly sheet, without the busywork
- **One sheet per month.** Each month opens with your recurring bills carried forward from the
  last, ready to edit inline: status, amount, due day and payment type.
- **Statuses that match how bills really work.** Sixteen of them out of the box (Unpaid,
  Autopay, Autopay Pending, Partial Payment, Past Due, Skipped, Paid & Cancelled and more),
  all customizable with your own colors and emoji. Bulk-update a whole month at once.
- **Bills linked to the payments that cleared them**, so you can see exactly which transaction
  paid which bill.
- **Recurring-bill suggestions.** It spots repeating charges in your transactions and offers to
  turn them into bills. You can also merge or rename bills whose names drifted over time.

### Transactions: getting real bank data in, cleanly
- **CSV import from any bank.** Map the columns once and the app remembers that layout and
  guesses the rest: dates, debit/credit vs. signed amounts, and which account it belongs to.
  Duplicates are rejected using the transaction's actual facts (account, date, amount,
  description), not the bank's IDs, which change between exports. Re-importing an overlapping
  date range is harmless.
- **Running balances.** If the CSV has a balance column, it's recorded as a dated balance snapshot.
- **PDF statement import** for accounts that only give you PDFs. It records the opening and
  closing balances and de-duplicates across statements. Parsers are per-issuer; one ships
  today (Robinhood Spending).
- **A review step before anything is saved.** Every import shows a preview where you can
  categorize, write notes and settle pending charges. It works on a phone too.
- **Categorization in three layers:**
  1. Saved rules run automatically on import.
  2. A mass-categorize screen clears the backlog.
  3. A one-click inline rule also catches the N similar transactions it finds.
- **Pending transactions.** Bank exports don't include pending charges, so enter them by hand.
  When the posted version arrives in a later import, it settles into the pending entry even
  if the name, date or amount (say, a tip) changed. Your category, notes and links carry over.
- **Split transactions.** A $100 store run can be $60 groceries and $40 household. The parts
  always add up to the full amount, and cash back is treated as cash.
- **Transfers between your own accounts** are paired and excluded, so moving money from
  checking to a credit card doesn't count as spending one way and income the other.
- **Cash offsets.** An ATM withdrawal is spending until you say what it bought. Log cash
  purchases and they move money out of "unaccounted cash" into real categories. Count what's
  left in your wallet and that portion counts as cash on hand, not spent.

### Accounts, debts and the big picture
- **One ledger for everything you own and owe.** Checking, savings, cash, credit cards and
  loans each have dated balance history. Past months show what balances actually were then,
  not what they are today.
- **Debts.** Each debt shows APR, minimum payment, credit limit, utilization and what it costs
  you in interest this month, plus avalanche or snowball payoff projections with a debt-free
  date and total interest.
- **Dashboard.** For any month: cash on hand, total owed, bill status, income vs. spending,
  spending by category, goal progress and trends. Switching months re-renders the whole page
  from that month's data.

### Planning: looking forward instead of back
- **Budgets measured against what actually happened.** Plan a month as envelopes, and each
  envelope's "actual" comes straight from that month's transactions. You never type in spending.
  Lines can be locked, the rest rebalance automatically, and a savings line keeps saving visible.
- **Debt-payoff budget generator.** It drafts the month from your live data: income from your
  pay schedule, bills, minimum payments and recent spending. Whatever's left goes to the debt
  you're targeting, and it warns you when the plan doesn't fit.
- **Cash projection.** A day-by-day forecast of your cash through the end of the month and the
  next: upcoming bills, paydays and remaining budget. It shows the low point before it happens.
  Paydays are checked against the deposits that have actually landed, so a paycheck split
  across two deposits isn't counted twice.
- **Savings goals.** Goals are built from a running list of contributions. For goals tied to
  a real account, progress is checked against that account's balance, so a goal shows a
  shortfall if the money has actually been spent.
- **Pay schedule and payday countdown**: weekly, biweekly, semimonthly or monthly. It's
  deliberately just a countdown ("4 days to go") with no nagging math.

### Claude as a financial advisor (MCP)
The app runs its own [MCP](https://modelcontextprotocol.io) server. You can connect it to
claude.ai or Claude Code and have a real conversation about your actual numbers: "Can I afford
this?", "How did this month go?", "What's my fastest path out of debt?"

- **15 read tools:** snapshot, month summaries, spending and balance trends, debts and payoff
  projections, cash projection, budget, goals and transaction search.
- **8 write tools that only add or edit, never delete:** categorize, split, update bill
  status, add a goal contribution, adjust a budget line, set a debt target, add a transaction,
  record a balance. Claude has to tell you exactly what will change and wait for your OK.
- **Built-in prompts:** `monthly_review`, `can_i_afford`, `debt_payoff_plan` and
  `budget_check_in`.
- **A private advisor profile** (`config/advisor-profile.json`, never committed). It gives
  Claude standing context, such as your situation, your plan, and what money is off-limits,
  so every conversation starts from where you are.
- **Secure sign-in.** Claude signs in through your own Cognito user pool using OAuth, so your
  data never sits with a third-party aggregator.

## Limitations and honest downsides

This is a tool I built for myself, so these are the trade-offs I live with:

- **Imports are manual. This is the big one.** No bank connection is wired up, so keeping the
  app current means logging into each bank, downloading a CSV or PDF statement, and importing
  it. Pending charges have to be typed in by hand until they post. The more accounts you
  have, the more of this there is.
- **Bank sync is built but has no provider.** The scheduler, webhooks, reconciliation, encrypted
  token storage, settings page and tests all exist. They were built against Teller, which then
  shut down its API. The likely replacement is Plaid's free trial tier for hobby use. Paid
  aggregators (around $100/mo) and daily-only feeds were ruled out. Adding a provider means
  one adapter behind `src/server/lib/sync/provider.ts`; see `planning/features/bank-sync.md`.
- **One PDF parser.** Only Robinhood Spending statements are supported out of the box. Other
  banks need a CSV export or a new parser in `src/server/lib/pdf/parsers/`. Scanned (image)
  PDFs aren't supported because there's no OCR.
- **Single user, single currency.** No households, shared access or roles, and everything is
  in USD.
- **Cash takes discipline.** Cash spending is only as accurate as the purchases you log and
  the wallet counts you record.
- **Setup is heavier than a hosted app.** You need MySQL, an AWS Cognito user pool even for
  local development, and somewhere to host it. There's no one-click deploy.
- **Opinionated by design.** Categories, statuses and workflows reflect how I manage money.
  They're customizable, but the app assumes a monthly bill sheet plus transactions.
- **Web only.** It works on a phone browser, but there's no native app or offline mode.
- **Not audited.** Auth is solid (JWT verification on every request, `httpOnly` cookies,
  nothing public by default), but there's no Content-Security-Policy yet and it hasn't had a
  third-party security review. Treat it as a personal tool.

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

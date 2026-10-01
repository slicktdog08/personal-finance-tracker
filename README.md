# Personal Billing Tracker

A single-user Next.js app that replaces a Notion/Monday monthly bill tracker.
Tracks bills per month (clone-forward, inline edit) and bank transactions
(CSV import with automatic duplicate rejection). Backed by MySQL via Drizzle ORM.

See [`planning/`](planning/) for the full design (data model, import pipeline, roadmap).

## Stack
Next.js (App Router) · TypeScript · Tailwind v4 · Drizzle ORM (`mysql2`) · papaparse · zod.

## Quick start with Claude Code

This repo ships a Claude Code skill that walks you through setup interactively — env
file, database, Cognito, seed data, and your personal advisor profile:

```
claude
> /setup
```

It never commits anything personal: `.env*`, `config/advisor-profile.json` and
`notion_data/` are all git-ignored. Prefer to do it by hand? Follow the steps below.

## Setup

1. **Configure the database connection** — edit `.env.local`:
   ```
   DATABASE_URL="mysql://USER:PASSWORD@DB_HOST:3306/personal-billing"
   # optional, for migrations if your runtime user lacks DDL:
   DATABASE_MIGRATION_URL="mysql://ADMIN:PASSWORD@DB_HOST:3306/personal-billing"
   ```
   The `personal-billing` database must already exist. The migration user
   needs `CREATE/ALTER`; the runtime user needs `SELECT/INSERT/UPDATE/DELETE`.

2. **Create the schema**:
   ```
   npm run db:migrate      # applies drizzle/0000_init.sql (+ future migrations)
   # or, for a quick push without migration files:  npm run db:push
   ```

3. **Seed the lookup tables** (statuses, payment types, categories):
   ```
   npx tsx scripts/seed-config.ts
   ```
   *Optional:* if you're migrating from a Notion bill tracker, put the export in
   `notion_data/` (git-ignored) and run `npm run seed` — see
   [`planning/design/01-data-inventory.md`](planning/design/01-data-inventory.md) for the
   expected format. Otherwise start fresh and import bank CSVs from the **Import** page.

4. **Run it**:
   ```
   npm run dev        # http://localhost:3000
   ```

5. **Write your advisor profile** (optional, used by the Claude MCP connector):
   ```
   cp config/advisor-profile.example.json config/advisor-profile.json
   ```
   Fill in your situation, plan and data caveats. The file is git-ignored; without it
   the advisor simply asks you for context.

## Authentication

Every page, Server Action and API route requires a signed-in AWS Cognito user. There
is no self-signup — users are created in the Cognito console.

### One-time Cognito setup

1. **Enable the password auth flow** on the app client (the pool ships with only
   `ALLOW_USER_SRP_AUTH`, which a server-side login can't drive):
   ```
   aws cognito-idp update-user-pool-client \
     --user-pool-id "$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \
     --client-id "$NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID" \
     --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
   ```
   Console equivalent: **User pools → App clients → Login pages → Authentication
   flows → "Sign in with username and password: ALLOW_USER_PASSWORD_AUTH"**.

   > `--explicit-auth-flows` **replaces** the list, so keep `ALLOW_REFRESH_TOKEN_AUTH`
   > in it or sessions will stop renewing after an hour.

2. **Create your user**:
   ```
   aws cognito-idp admin-create-user \
     --user-pool-id "$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \
     --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
     --temporary-password 'SomeTempPass1!'
   ```
   Signing in with the temporary password lands on the "choose a new password"
   screen, which completes Cognito's `NEW_PASSWORD_REQUIRED` challenge.

### How the gate works

Two independent layers — the second is what actually protects the data:

| Layer | File | Covers |
|-------|------|--------|
| Proxy (Next 16's renamed middleware) | `src/proxy.ts` | Pages and API routes, before rendering. Allowlist: anything not listed as public is protected, so new pages are gated by default. Also transparently refreshes an expired access token from the refresh-token cookie. |
| Data Access Layer | `requireSession()` in `src/server/auth/session.ts` | Called at the top of every Server Action and every function in `src/server/queries.ts`. Server Actions are POSTs to the page route they're used on, so a matcher change could silently drop proxy coverage — per the Next.js docs this layer must not be skipped. |

API route handlers additionally call `requireApiAuth()` (`src/server/auth/api.ts`),
which accepts `Authorization: Bearer <accessToken>` or the session cookie. See
`src/app/api/auth/session/route.ts` for the reference implementation.

Tokens live in three `httpOnly`, `SameSite=Lax` cookies (`pb_at`, `pb_it`, `pb_rt`),
`Secure` in production — no token is ever readable by browser JavaScript. Every
request re-verifies the JWT signature against the pool's JWKS; a cookie's mere
presence never grants access.

## Claude MCP connector

The app exposes an [MCP](https://modelcontextprotocol.io) server at `/api/mcp` so
claude.ai can act as a financial advisor over the real data: read-only tools for
snapshots, month summaries, trends, debts/payoff projections, cash projections, goals
and budgets, plus a small set of additive writes (categorize, bill status, goal
contribution, budget line, manual transaction, balance snapshot). No deletes, imports
or rule edits — those stay in the UI. Code lives in `src/server/mcp/`.

### How auth works

claude.ai authenticates with OAuth 2.0 + PKCE against **Cognito itself** — the app
never issues tokens. The handshake:

1. Claude POSTs to `/api/mcp` with no token → `401` with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
2. It reads that document (`src/app/.well-known/oauth-protected-resource/route.ts`),
   which names the Cognito issuer as the authorization server, then reads Cognito's
   `/.well-known/openid-configuration` to find the hosted-UI authorize/token endpoints.
3. You sign in on Cognito's hosted page; Claude exchanges the code for tokens and sends
   the access token as `Authorization: Bearer` on every call.
4. `withMcpAuth` in `src/app/api/mcp/route.ts` verifies it with the same
   `aws-jwt-verify` verifier as the web app, and `getSession()` reads the bearer header
   when there is no cookie — so every query and Server Action runs through the usual
   `requireSession()` guard unchanged.

### One-time Cognito setup

1. **Assign a domain to the pool** (User pools → Domain → Cognito prefix domain is
   fine). Without one the OAuth endpoints don't exist, and Cognito's discovery document
   advertises placeholder `/authorize` `/token` URLs that return 400. After assigning it,
   confirm `curl https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/openid-configuration`
   shows `authorization_endpoint` on your `*.amazoncognito.com` domain.
2. **Create a second app client** for Claude (User pools → App clients → Create):
   - Type: confidential client **with a client secret** (Cognito's token endpoint only
     advertises `client_secret_basic`/`client_secret_post`; claude.ai accepts a secret).
   - Managed login / hosted UI enabled; identity provider: Cognito user pool.
   - Allowed callback URL: `https://claude.ai/api/mcp/auth_callback`
   - OAuth grant: **Authorization code**; PKCE is on by default.
   - OpenID scopes: `openid` (add `email` if you like).
   - Auth flows: `ALLOW_REFRESH_TOKEN_AUTH` only — this client never does password auth.
3. Put the new client id in `.env.production` (and `.env.local` for dev) as
   `COGNITO_MCP_CLIENT_ID`, set `APP_URL=https://finance.example.com`, and
   redeploy. The verifier accepts tokens from either client from then on.

### Connecting claude.ai

Settings → Connectors → **Add custom connector**:

| Field | Value |
|-------|-------|
| Name | Personal Billing |
| Remote MCP server URL | `https://finance.example.com/api/mcp` |
| Advanced → OAuth Client ID | the MCP app client id |
| Advanced → OAuth Client Secret | its secret |

Click Connect, sign in on the Cognito page, and the tools appear in any chat. Try the
built-in prompts (`monthly_review`, `can_i_afford`, `debt_payoff_plan`,
`budget_check_in`) — they encode the "advisor" workflow: which tools to call, in what
order, and how to frame the answer.

Claude Code can use the same server (`claude mcp add --transport http billing
https://…/api/mcp`); it runs its own OAuth flow, so add
`http://localhost/callback` and `http://127.0.0.1/callback` as extra callback URLs on
the app client if you want that.

### Testing without claude.ai

- Discovery: `curl -i https://…/.well-known/oauth-protected-resource`
- Challenge: `curl -i -X POST https://…/api/mcp` → `401` with the `resource_metadata` header.
- Authenticated: copy the `pb_at` cookie value from DevTools after signing in to the
  web app and call the endpoint directly:
  ```
  curl -s -X POST https://…/api/mcp -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
- Tool logic against the live DB without any session: see the `tsx` loader harness
  pattern in `planning/` / memory (stub `server-only`, `next/cache`, `next/headers`,
  `@/server/auth/session`, then call `createMcpHandler` directly with JSON-RPC
  `Request`s).

## Scripts
| Command | Purpose |
|---------|---------|
| `npm run dev` / `build` / `start` | Next.js dev / build / serve |
| `npm run db:generate` | Generate a migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (no migration file) |
| `npm run db:studio` | Drizzle Studio (DB browser) |
| `npm run seed` | Load `notion_data/` history |
| `npm test` | Unit tests (pure modules) — `node:test` via tsx |
| `npm run test:e2e` | End-to-end tests against the local test database with an in-memory bank provider (see [Testing](#testing)) |
| `npm run db:test:up` / `:down` / `:reset` | Start / discard / recreate the throwaway test database |
| `npm run db:test:schema` | Regenerate `tests/db/schema.sql` from the live schema (run after a migration) |
| `npm run purge:e2e` | Report e2e leftovers in the DB from `.env.local`; `-- --apply` to delete them |
| `npm run sync -- <cmd>` | Bank-sync CLI: `status`, `enrollments`, `sync [--dry-run]`, `runs`, `settings`, `ignored`, `check` (see `scripts/bank-sync.ts`) |

## Testing

Unit tests are pure. The e2e suite is not: it inserts accounts, commits imports, triggers
whole-ledger sync runs, prunes `sync_runs` and rewrites `sync_settings`. It gets its own
database.

```bash
cp .env.test.example .env.test   # once
npm run db:test:up               # MySQL 5.7 on 127.0.0.1:3307, schema from tests/db/schema.sql
npm run test:all
```

`docker-compose.test.yml` runs `mysql:5.7` under `linux/amd64` emulation — there is no arm64
5.7 image, and matching the server's 5.7.32 keeps the quirks this codebase works around
(hyphenated database name, `@` in the password, 5.7's `sql_mode`) reproducible. Its data
directory is a tmpfs, so `db:test:reset` always yields a pristine schema. First boot is slow;
`db:test:up` polls the healthcheck rather than sleeping.

**How the suite is kept off the real database.** `.env.test` is loaded by
`tests/env-test.cjs`, preloaded *before* `tests/stubs.cjs`. The order is the mechanism:
`dotenv` never overwrites an already-set variable, so the file loaded first wins, and
`stubs.cjs` loads `.env.local`. For a long time `.env.test` was loaded *after* `.env.local`
inside `stubs.cjs`, where it could never override `DATABASE_URL` — so the e2e suite ran
against production, and left 48 orphaned `import_batches` and 25 fake `sync_runs` there
before anyone noticed. `stubs.cjs` deliberately still knows nothing about `.env.test`,
because `npm run sync` shares it and must keep talking to the real database.

On top of that, `tests/env-test.cjs` refuses to start a test process unless `DATABASE_URL`
is on the loopback:

- A non-local host is refused. To override you must name it — `E2E_ALLOW_REMOTE_DB=<host>`,
  not a bare `1`, because typing the host out is the moment you check which one it is.
- If `.env.test` resolves to the **same host as `.env.local`**, it is refused outright with
  no override. That is the live database by definition.

`tests/e2e/helpers.ts` repeats the check in `setupFixtures()` as a backstop, and its teardown
removes everything the fixtures create — `[e2e] …` accounts and their rows, the `e2efake`
provider's data, the category rule, the import batches, sync runs created after setup, and
the `sync_settings` bookkeeping (including `last_run_id`, which otherwise dangles).

If something ever does leak, `npm run purge:e2e` reports it and `npm run purge:e2e -- --apply`
removes it. The import-batch sweep only deletes batches with no transactions left, so a real
import that happens to share a fixture filename survives.

## Deployment

One way to self-host: a VPS where Jenkins → Docker → nginx serves it at your domain
(`finance.example.com` below — substitute your own). The app listens on **port 9010**, published on the loopback only;
nginx is the only route in.

| File | Role |
|------|------|
| `Dockerfile` | Two-stage build (`npm ci` + `next build`, then a slim runner as `nodeuser`) |
| `docker-compose.yml` | One service, `restart: always`, binds `127.0.0.1:${PORT}` |
| `nginx/template` | Site config with `__DOMAIN__` / `__PORT__` placeholders |
| `scripts/render-nginx-conf.sh` | Renders that template using `PORT` from `.env` |
| `JenkinsFile` | Clean → env → nginx+TLS → build → (migrate) → (apply SQL) → up → prune |

### One-time Jenkins setup
1. Create a **Secret file** credential with ID `personal-billing-env-production`,
   containing the production `.env.production` (see below). `git clean -fdx` wipes
   the workspace on every run, so the pipeline restores this file from the credential
   rather than from the repo — the MySQL password is never committed.
2. Create a `vps-deploy-key` SSH credential that can log in to the VPS as `deployer`.
3. Point a Pipeline job at this repo with script path `JenkinsFile`.
4. Add a DNS A record for `finance.example.com` **before** the first run —
   certbot validates over HTTP and will fail without it.

### `.env.production` contents
```
DATABASE_URL="mysql://USER:PASSWORD@DB_HOST:3306/personal-billing"
DATABASE_MIGRATION_URL="mysql://ADMIN:PASSWORD@DB_HOST:3306/personal-billing"
NEXT_PUBLIC_AWS_REGION=...
NEXT_PUBLIC_COGNITO_USER_POOL_ID=...
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=...
COGNITO_MCP_CLIENT_ID=...
APP_URL=https://finance.example.com
PORT=9010
# Bank sync (see planning/features/bank-sync.md and .env.example) — no provider wired yet
SYNC_TOKEN_ENCRYPTION_KEY=...      # openssl rand -hex 32
SYNC_SCHEDULER=1
```
This file is deliberately **not** in `.dockerignore`: pages are DB-backed and
`NEXT_PUBLIC_*` values are inlined into the bundle, so `next build` needs it at
build time. It is only copied into the builder stage, never into the final image.

### Pipeline parameters
| Parameter | Default | Notes |
|-----------|---------|-------|
| `DOMAIN` | `finance.example.com` | Also the nginx site filename and certbot cert name |
| `CERTBOT_EMAIL` | `you@example.com` | Renewal notices |
| `RUN_MIGRATIONS` | `false` | Runs `drizzle-kit migrate` in a one-off container off the freshly built image, before the running container is swapped. Opt-in — check the pending migrations in `drizzle/` first. Only covers the journaled migrations (0000–0004); use `APPLY_SQL` for the hand-written ones. |
| `APPLY_SQL` | `true` | Runs `scripts/apply-sql.ts --pending` in a one-off container off the new image, before the running container is swapped: every hand-written `drizzle/*.sql` not yet recorded in the `sql_migrations` table, oldest first. Files applied by hand with the script are recorded too, so they're skipped. A failed statement fails the build so the new code doesn't go live. When the table is first created, everything through `0021` is recorded as already applied (the baseline) without being run. |

### Running it locally the way production does
```
cp .env.production .env      # compose reads PORT from .env
docker compose build
docker compose up -d         # http://127.0.0.1:9010
docker compose logs -f
docker compose down
```

## Structure
```
src/
  app/                      dashboard · months · months/[period] · transactions · import
  components/               Nav, BillSheet, CategoryCell, NewMonthButton, ...
  server/
    db/schema.ts            Drizzle schema (periods, bills, bill_instances, accounts,
                            transactions, import_batches, category_mappings)
    db/index.ts             runtime db client
    actions/                server actions (bills, periods, transactions, import)
    lib/                    money, dedup, categorize, period helpers
    queries.ts              read queries
  constants/enums.ts        statuses, payment types, categories
scripts/seed-history.ts     one-time historical loader
drizzle/                    generated migrations
notion_data/                source export (gitignored)
planning/                   design docs, progress logs (see planning/README.md)
```

## Notes
- The MCP MySQL connection used during development cannot run DDL — schema is created via
  Drizzle migrations with a privileged connection. See `planning/design/04-migration-and-seed.md`.
- Transaction dedup uses a `sha256(account|date|amount|description|direction)` hash with a
  `UNIQUE` constraint, so re-importing overlapping CSVs is a no-op.

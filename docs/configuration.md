# Configuration

Everything is an environment variable: `.env.local` for development, `.env.production` (or
your container platform's settings) for a deployment. [`.env.example`](../.env.example) is
the commented template.

**Only `DATABASE_URL` is required.**

## Core

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | `mysql://user:password@host:3306/db`. The password may contain `@` and must not be percent-encoded |
| `DATABASE_MIGRATION_URL` | | A user with CREATE/ALTER rights, when the runtime user has none |
| `APP_URL` | deployed | Your public origin, e.g. `https://finance.example.com`. Used for OAuth discovery, Plaid redirects, and to decide whether cookies are `Secure` |
| `PORT` | | Port the server listens on (3000 in the Docker image) |
| `AUTO_MIGRATE` | | Docker only. `0` skips schema creation and migrations at container start |

## Sign-in ([authentication.md](authentication.md))

| Variable | Purpose |
|---|---|
| `AUTH_PROVIDER` | `local` or `cognito`. Default: `cognito` when the pool variables are set, otherwise `local` |
| `AUTH_SECRET` | Built-in auth: session signing key, 32+ characters. Default: generated and stored in the database |
| `AUTH_COOKIE_SECURE` | `0` forces non-`Secure` cookies (plain-http access), `1` forces `Secure`. Default: follows `APP_URL` / production |
| `NEXT_PUBLIC_AWS_REGION` | Cognito region |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito user pool |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito web app client |
| `COGNITO_CLIENT_SECRET` | Only if the web client was created with a secret |
| `COGNITO_MCP_CLIENT_ID` | The second Cognito client, for the claude.ai connector |

## Bank sync ([importing.md](importing.md#3-bank-sync))

| Variable | Purpose |
|---|---|
| `SYNC_TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32`. Encrypts stored bank tokens. Changing it orphans them (re-link) |
| `SYNC_SCHEDULER` | `0` stops a production process from starting the sync scheduler |
| `SYNC_CRON_SECRET` | Bearer token for `POST /api/sync/run`, to trigger syncs from cron |
| `SIMPLE_FIN_SETUP_TOKEN` | Optional one-time SimpleFIN token to link with |
| `SIMPLEFIN_ALLOW_ANY_HOST` | `1` allows a self-hosted SimpleFIN server |
| `PLAID_API_CLIENT_ID`, `PLAID_API_SECRET` | Plaid keys |
| `PLAID_ENV` | `sandbox` (default) or `production` |
| `PLAID_REDIRECT_URI`, `PLAID_WEBHOOK_URL` | Override the URLs derived from `APP_URL` |

## Claude ([claude-mcp.md](claude-mcp.md))

| Variable | Purpose |
|---|---|
| `CLAUDE_ADVISOR_ROUTINE_ID` | The advisor routine's trigger id (`trig_…`), for the in-app Insights and chat buttons |
| `CLAUDE_ADVISOR_ROUTINE_TOKEN` | The token generated with that trigger |
| `ADVISOR_PROFILE_PATH` | Fallback advisor-profile file, used only when the database has none |

## Demo ([demo.md](demo.md))

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | `1` = public demo: sample data, sign-in filled in, real bank linking disabled. **Wipes the database on every start** |
| `DEMO_RESET_MINUTES` | How often the sample data is put back (default 60, `0` = only at start) |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | The shared demo account shown on the sign-in page |

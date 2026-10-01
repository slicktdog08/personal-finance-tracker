# Feature: Bank sync (engine; no provider wired)

**Status:** engine live, **no provider registered** (2026-09-21) · **Entry:** `/settings/sync` · scheduler + webhook + `scripts/bank-sync.ts`

> Pulls transactions and balances automatically from a bank aggregator instead of CSV/PDF
> imports. Built and tested against **Teller** on 2026-09-20; Teller then turned out to have
> shut its API down (announced July 2026), so the Teller adapter was removed on 2026-09-21
> and the provider registry is empty. Everything below the provider contract — schema,
> reconcile, sync writer, settings UI, scheduler, webhook route, MCP tools, CLI, tests — is in
> place and exercised by an in-memory provider. The pending-transaction model it introduced
> is live on its own: [pending-transactions.md](pending-transactions.md).
>
> **Next provider:** Plaid's Trial plan (free, 10 Items, real data, "hobbyist use") is the
> obvious candidate; Quiltt ($100/mo) and SimpleFIN/Lunch Flow (daily only) were ruled out.
> The Teller sections below are kept as the worked example of what an adapter needs.

## Intent / why
Manual CSV/PDF import means the ledger is only as fresh as the last time the user bothered. The
goal is **intraday freshness with zero effort**: Teller polls each bank several times a day and
webhooks us, we also poll on our own interval, and pending card authorizations show up in the
app the same day they happen.

Why Teller (validated 2026-09-20 against the live institution list and docs):
- Covers most major US banks' checking, savings and credit-card accounts. **Not** covered:
  brokerages (Teller has no brokerage type) and loan servicers (no loan type). Those keep their
  existing paths (PDF import / manual).
- Freshness: Teller polls "multiple times per day on a non-predictable schedule, at least once
  per 24h" and fires `transactions.processed`; API reads are live pass-throughs, so our own
  cron adds more.
- Cost: **Development environment** = real bank data, free, 100 enrollments (cumulative — a
  deleted enrollment is not refunded), same rate limits as production, webhooks work.
  Production needs KYB (a company); we never need it.
- Risks accepted: the dev tier is framed as "integration testing"; rate limits are undisclosed
  (we back off on 429); *business*-account logins are unverified until the first real enrollment.

The sync layer is written **provider-agnostic at the storage layer** (`source` + `external_id`
on transactions, a generic `sync_*` schema) so a move to Plaid later touches only
`src/server/lib/teller/`.

## What it does (user-facing)
- **Settings → Bank Sync**: link a bank (Teller Connect popup), see each enrollment and its
  accounts, map each external account to a local `accounts` row, turn accounts on/off, set the
  sync-from date, choose the interval, toggle balance recording, see run history and errors,
  and hit **Sync now**.
- **Transactions**: synced rows appear automatically, categorized by the existing rules.
  **Pending** rows show an amber `Pending` pill, promote in place when they post, and vanish if
  the bank drops them. Filterable by status.
- **Accounts**: cash + card balances are recorded daily from the bank instead of typed in;
  each synced card shows "Synced · 2h ago".
- **Advisor (MCP)**: can read sync status / pending spend and trigger a sync.
- **CLI**: `scripts/teller.ts` for everything above without the browser, plus dry-runs.

## Decisions (locked unless the user changes them)
| # | Decision | Why |
|---|---|---|
| D1 | **Pending transactions are stored** in `transactions` with `status='pending'`, shown with a badge, and count in spend rollups. | The user wants the intraday picture; a pending charge is real money leaving. |
| D2 | Pending rows are **excluded from bill auto-linking, recurring-bill suggestions, and transfer pairing** until posted. | Pending descriptions/amounts change on posting; linking early creates wrong links that must be undone. |
| D3 | Teller rows get `dedup_hash = sha256("teller|" + external_id)` rather than the content hash. | The content hash changes when pending → posted (date/description shift), which would collide with the UNIQUE index. Cross-source duplicates are handled by reconciliation (D4), not the hash. |
| D4 | Per-account **`sync_from` date** (default: last existing txn date + 1 for that account, else today − 30) + a **soft-match pass** (same account, same amount & direction, date ±2 days) against existing non-Teller rows inside the window. Soft matches are *skipped*, not inserted, and logged in the run. | CSV/PDF history and Teller overlap for a few weeks; descriptions differ between sources so the hash can't catch it. |
| D5 | **Pending expiry**: a pending row not returned by Teller for `pending_expiry_days` (default 7) is deleted. If it had user edits (category set by hand, notes, bill link) and a posted row soft-matches, the edits are carried over first. | Teller docs: a pending txn that changes significantly on posting is re-created under a new ID. |
| D6 | **Scheduler runs in-process** via `src/instrumentation.ts` (Node runtime only, gated by `SYNC_SCHEDULER=1`), reading `interval_minutes` from `sync_settings`. A `/api/sync/run` route with a bearer secret exists as a fallback for host cron. | One long-running container; interval must be changeable from the settings screen without a redeploy; no volumes or host cron to manage. |
| D7 | Balances: cash accounts record Teller **`available`**, credit accounts record **`ledger`** (amount owed). One snapshot per `(account, as_of=today)`; later runs the same day **update** that row instead of inserting. | `available` is what the manual entries always meant for cash; `ledger` is the owed figure the debt views expect. Idempotent-per-day matches the CSV/PDF balance rule. |
| D8 | Secrets in env (`.env.production` Jenkins secret file), **config in DB**. Access tokens encrypted at rest with AES-256-GCM under `TELLER_TOKEN_ENCRYPTION_KEY`. | Matches the existing deploy; tokens are the only thing that can read the user's banks. |
| D9 | Category rules run at insert; on pending → posted, if the description changed **and** the category was rule-set or null (`category_rule_id` not null or `category` null), rules re-run. A hand-set category is never overwritten. | Same provenance rule as `category_rule_id` today. |
| D10 | Teller amount **sign convention is verified in sandbox on day one** and encoded in `map.ts` with a test per account type. Never assumed. | Their docs' sample data is inconclusive on sign. |
| D12 | **Hand edits on synced rows persist.** Each synced row stores the provider's last-delivered values (`raw.seen`); a run writes a provider-owned field only when the *provider* changed it since. Deleting a synced row leaves a tombstone (`sync_ignored`) so it isn't re-inserted; hand edits keep the provider-id dedup hash. | The user fixes descriptions and dates by hand; the next run must not undo that, and a deleted row must stay deleted. Where both sides changed, the bank wins on its own fields. |
| D13 | **Gaps are backfilled.** A run's window starts at `min(today − window, lastSyncedAt − window)`, clamped to `sync_from`, and is pulled back to the oldest pending row we hold. | Pause/disconnect/downtime longer than the window must not leave a hole; a pending hold older than the window must be judged against the bank, not expired blindly. |
| D14 | **One external account per ledger account** (unique on `sync_accounts.account_id`), and **only `enrollment.disconnected.*` codes** flip an enrollment to disconnected — a bare 401 (e.g. a rotated client cert) fails the run instead. | Two feeds into one account would expire each other's pending rows every run; a deploy mistake must not force a Connect repair on every bank. |
| D11 | **Only the sync writer talks to the provider.** Every reader — pages, queries, MCP tools (`list_pending_transactions`, `get_sync_status`), CLI status — reads our tables. Provider code lives behind a `SyncProvider` interface (`src/server/lib/sync/provider.ts`); Teller is the first implementation (`src/server/lib/teller/`). | Providers get swapped or added later; the app must never depend on one being reachable, and the advisor must see the same ledger the UI shows. |

## Data model (migration `drizzle/0022_bank_sync.sql`, applied 2026-09-20 with `scripts/apply-sql.ts`)

### `transactions` — three new columns
```
source        VARCHAR(16)  NOT NULL DEFAULT 'import'   -- import | pdf | manual | teller
external_id   VARCHAR(64)  NULL                        -- provider's stable txn id
status        VARCHAR(12)  NOT NULL DEFAULT 'posted'   -- posted | pending
UNIQUE uq_tx_external (source, external_id)
INDEX  idx_tx_status  (status)
```
Backfill: existing rows keep `source='import'`, `status='posted'`. `commitImport` stamps
`import`/`pdf` and `createTransaction` stamps `manual`.

### `sync_settings` — singleton (id = 1, like `pay_schedule`)
```
enabled              BOOL     default false     -- master switch for the scheduler
interval_minutes     INT      default 180       -- 60 … 1440; UI offers 1h/2h/3h/4h/6h/12h/24h
sync_window_days     INT      default 10        -- how far back each run re-queries (Teller says 7–10)
pending_expiry_days  INT      default 7         -- D5
record_balances      BOOL     default true      -- D7
auto_categorize      BOOL     default true      -- D9
webhook_enabled      BOOL     default true      -- ignore inbound webhooks when off
lock_until           DATETIME NULL              -- run mutex (scheduler / webhook / manual / CLI)
next_run_at          DATETIME NULL
last_run_id          INT NULL
last_webhook_at      DATETIME NULL
created_at / updated_at
```

### `sync_enrollments` — one per bank login
```
id, provider VARCHAR(16) 'teller', enrollment_id VARCHAR(64) UNIQUE,
institution_id VARCHAR(64), institution_name VARCHAR(128),
provider_user_id VARCHAR(64), access_token_enc TEXT,
status VARCHAR(16) active | disconnected | paused,
disconnect_reason VARCHAR(64), enrolled_at, last_synced_at, last_error TEXT,
created_at / updated_at
```

### `sync_accounts` — external account ↔ local account
```
id, enrollment_id FK → sync_enrollments (cascade),
external_account_id VARCHAR(64) UNIQUE, name VARCHAR(128), type VARCHAR(16),
subtype VARCHAR(32), last_four VARCHAR(4), currency VARCHAR(3),
account_id INT NULL FK → accounts (set null),   -- null = unmapped, nothing synced
enabled BOOL default true, sync_balances BOOL default true,
sync_from DATE NULL,                              -- D4
external_status VARCHAR(16) open | closed,
last_synced_at, last_error TEXT, created_at / updated_at
```
Auto-mapping on enrollment: match `last_four` against `accounts.account_number` where both
institution names are known and overlap (case-insensitive contains) and no other external
account already feeds that local account → pre-fill `account_id` **with `enabled = false`**;
The user confirms by turning it on (an explicit mapping in the UI/CLI switches it on). Unmapped
accounts are visible but inert.

### `sync_ignored` — tombstones (migration `0023`)
```
source VARCHAR(16), external_id VARCHAR(64), UNIQUE (source, external_id)
```
Written by `deleteTransaction` for a synced row; the sync writer skips those inserts (D12).
`0023` also adds `UNIQUE (account_id)` on `sync_accounts` (D14).

### `sync_runs` — audit log (what the settings screen shows)
```
id, trigger VARCHAR(16) scheduled | webhook | manual | cli,
enrollment_id INT NULL (webhook runs are per-enrollment; others are "all"),
status VARCHAR(12) running | ok | partial | failed,
started_at, finished_at,
inserted INT, updated INT, promoted INT (pending→posted), expired INT,
skipped_dupes INT, balances_recorded INT,
error TEXT, details JSON   -- per-account counts + soft-match list, for the expandable row
```
Keep the last 200 rows (prune at the end of each run).

## Pending state lives on `transactions.pending`

This branch was written against a `status` varchar on `transactions`; the merge to `main` moved it
onto `main`'s `pending` boolean, which is the model production adopted. The provider-facing
`TxnStatus` ('posted' | 'pending') is unchanged and `reconcile.ts` still speaks it — `sync.ts`
converts at the database boundary. See the "One pending model, not two" section in
pending-transactions.md for why, and for the dead `status` column that is deliberately still
declared.

## Environment
```
# public, needed by Teller Connect in the browser
NEXT_PUBLIC_TELLER_APPLICATION_ID=app_xxx
NEXT_PUBLIC_TELLER_ENVIRONMENT=development        # sandbox | development
# server-only
TELLER_CERT_PEM_B64=...      # base64 of certificate.pem (npm run sync -- teller cert a.pem b.pem)
TELLER_KEY_PEM_B64=...       # base64 of private_key.pem
TELLER_WEBHOOK_SECRETS=...   # comma-separated while rolling; webhooks 401 when unset
SYNC_TOKEN_ENCRYPTION_KEY=...     # 32 bytes hex; `openssl rand -hex 32` (provider-agnostic)
SYNC_SCHEDULER=1             # only in .env.production; unset locally (D6)
SYNC_CRON_SECRET=...         # bearer for /api/sync/run fallback (optional)
```
Certificates are base64 because `.env.production` is a single Jenkins secret file and the
container has no volumes. `.env.example` documents all of these.

## How it will work — modules

### `src/server/lib/sync/provider.ts` — the provider contract (D11)
```ts
interface SyncProvider {
  id: "teller";                                   // stored in sync_enrollments.provider
  listAccounts(token): Promise<ProviderAccount[]>;
  listTransactions(token, externalAccountId, range): Promise<ProviderTransaction[]>;
  getBalances(token, externalAccountId): Promise<ProviderBalances>;
  deleteEnrollment(token, enrollmentId): Promise<void>;
  verifyWebhook(rawBody, headers): ProviderWebhookEvent | null;
}
```
`ProviderTransaction` is already normalized (`txnDate`, `description`, signed `amount`,
`direction`, `status`, `externalId`, `raw`). `sync.ts` and `reconcile.ts` only see these types;
`getProvider(id)` returns the implementation. Adding Plaid = a new folder + one registry line.

### Provider adapter — what one needs (Teller, removed 2026-09-21, as the worked example)
A provider folder (`src/server/lib/<provider>/`) implements `SyncProvider` and is registered
in `PROVIDERS` (`provider.ts`). The Teller one had:
- `client.ts` — `tellerFetch(path, token, init)`: undici `Agent` with `connect: { cert, key }`
  decoded from env, HTTP Basic auth with the access token as username, JSON in/out, typed
  errors (`TellerError` with `code`, e.g. `enrollment.disconnected`, `account.closed`, 429 →
  `RateLimited` with retry-after). One Agent instance per process.
- `types.ts` — `TellerAccount`, `TellerTransaction`, `TellerBalances`, webhook payloads.
- `map.ts` — **pure**: Teller txn → `{ txnDate, description, amount, direction, status, raw }`
  using the sign rules verified per D10; `counterparty.name` and `category` are kept in `raw`
  (and `raw_category` is fed to `categorize()` for rules on `field='raw_category'`).
- `reconcile.ts` — **pure**: `reconcile(fetched, existingTeller, existingOther, opts)` →
  `{ inserts, updates, promotions, expirations, softDupes }`. This is where D3/D4/D5/D9 live;
  unit-tested with fixtures (`npx tsx scripts/test-reconcile.ts`).
- `sync.ts` — orchestrator: acquire `lock_until` (skip if held, log "skipped: locked"), open a
  `sync_runs` row, for each active enrollment → `GET /accounts` (refresh `sync_accounts`,
  detect closed) → for each enabled + mapped account: fetch
  `?start_date=max(sync_from, today − window)&end_date=today`, paginate by `from_id`, run
  `reconcile`, write in chunks of 200, record balances (D7), stamp `last_synced_at`. Catches
  per-enrollment errors → `partial`; `enrollment.disconnected` flips the enrollment status.
  Ends with `revalidatePath` for `/transactions`, `/accounts`, `/dashboard`, `/settings/sync`.
- `crypto.ts` — `encryptToken` / `decryptToken` (AES-256-GCM, iv + tag + ciphertext, base64).
- `index.ts` — `verifyTellerSignature(rawBody, header, secrets)` per Teller's "Verifying
  Messages" (timestamped HMAC-SHA256; reject > 3 min skew), and the event → action map:
  `transactions.processed` → sync that enrollment; `enrollment.disconnected` → mark it and
  surface a `SetupNotice`; `webhook.test` → stamp `last_webhook_at` only.

### Scheduler — `src/instrumentation.ts` → `src/server/sync/scheduler.ts`
`register()` imports the scheduler only when `NEXT_RUNTIME === 'nodejs'` and
`SYNC_SCHEDULER === '1'`. A `globalThis.__syncScheduler` guard prevents double timers under
HMR. Tick every 60 s: read `sync_settings`; if `enabled` and `next_run_at <= now`, run
`syncAll('scheduled')` then set `next_run_at = now + interval`. Changing the interval in the UI
resets `next_run_at`. Failures never throw out of the tick (logged to the run row).

### Server actions — `src/server/actions/sync.ts` (all behind `requireSession()`)
`getSyncOverview`, `saveSyncSettings`, `completeEnrollment(enrollment)` (from Connect's
`onSuccess`: encrypt token, `GET /accounts`, upsert `sync_accounts`, auto-map),
`mapSyncAccount`, `updateSyncAccount` (enabled / sync_balances / sync_from),
`pauseEnrollment` / `resumeEnrollment`, `removeEnrollment` (DELETE on Teller, delete rows;
synced transactions stay), `runSyncNow`, `expirePendingNow`, `getSyncRun(id)`.

### Route handlers
- `src/app/api/sync/webhook/[provider]/route.ts` — **public** (`/api/sync/webhook/` prefix
  in `src/proxy.ts`), POST only. `src/server/lib/sync/webhook.ts#handleWebhook` verifies the
  signature via the provider, stamps `last_webhook_at`, and returns deferred work the route
  runs in `after()` so the provider never waits on a sync. Unverified → 401; unknown
  provider → 404; `webhook_enabled=false` → 200 with no work.
- `src/app/api/sync/run/route.ts` — `Authorization: Bearer $SYNC_CRON_SECRET` (constant-time
  compare in the proxy and the route) or a session; runs `runSync('scheduled')`. Fallback for
  a host cron if the in-process scheduler ever proves unreliable.
- nginx: no change needed (already proxies everything); the webhook body is small.

### Link flow (removed with Teller)
Linking needs a provider-side UI (Teller Connect / Plaid Link): a client component that
loads the provider script, opens it, and hands the resulting token to `finishEnrollment`
(`src/server/actions/sync.ts`). `getConnectConfig` reports `ready: false` with the reason while
no provider is registered, and `/settings/sync` explains it in place of the Link button.

### UI
- `src/app/settings/page.tsx` — new tile **Bank Sync** ("Link banks, choose how often to pull
  transactions and balances, map accounts, and review sync history.").
- `src/app/settings/sync/page.tsx` + `src/components/settings/sync/`:
  - `SyncStatusCard` — enabled toggle, interval select, "Next run in 42m", last run summary,
    **Sync now** (with spinner + result toast), webhook health (last received).
  - `EnrollmentList` — per bank: institution, status pill (active / disconnected / paused),
    accounts count, last synced, actions: Reconnect (Connect with `enrollmentId` to repair —
    does not consume an enrollment), Pause, Remove (confirm).
  - (Link button — removed with Teller; see "Link flow".)
  - `AccountMappingTable` — external account (name · subtype · ····last4) → local account
    `<select>` (existing + "Create new…"), enabled, balances, sync-from date, last synced,
    status. Dual-render (table / cards) per the mobile conventions.
  - `SyncRunHistory` — last 20 runs; expandable row shows per-account counts, soft-matches,
    errors. Link to full list via `?all=1`.
  - `AdvancedSettings` — window days, pending expiry days, auto-categorize, balance
    recording; "Expire pending now" and "Re-run reconciliation (dry run)" buttons.
- `src/components/SetupNotice.tsx` gets a variant: "<Bank> needs reconnecting" → link.
- `src/components/StatusBar.tsx`: "Synced 12m ago" / "Sync error" indicator.
- **Transactions** (`TransactionsTable.tsx`, `MonthTransactions.tsx`, `TransactionFilters.tsx`):
  `Pending` pill, muted row style, status filter, a source glyph (bank / csv / pdf / hand).
  `EditTransaction` allowed on pending rows (edits survive posting per D9).
- **Dashboard**: a "Pending: 3 · $150.00" chip next to the month's spend.
- **Accounts** (`AccountCard.tsx`): "Synced via Teller · 2h ago" and balance source note.

### Management tools (explicitly requested)
1. **Settings screens** — above.
2. **CLI `scripts/bank-sync.ts`** — `npm run sync -- <cmd>` (preloads `tests/stubs.cjs` so
   `server-only`/`next/cache` resolve outside Next; never stubs the session):
   ```
   status | enrollments | runs [--last N] | run <id> | settings [key=value…]
   enroll --provider teller --token T --enrollment ENR      # headless / sandbox
   map <syncAccountId> <accountId|none> [--from YYYY-MM-DD]
   account <syncAccountId> [--enabled 0|1] [--balances 0|1] [--from …]
   pause | resume | remove <enrollmentDbId> [--keep-remote]
   sync [--enrollment <dbId>] [--dry-run]                   # dry run = soft-match report
   ignored [--clear <source> <externalId>]                  # tombstones (deleted synced rows)
   probe [--enrollment <dbId>]                              # live accounts + balances
   check                                                    # env + cert + token round-trip
   teller institutions <query> | teller cert <cert> <key> | teller sign <payload.json>
   ```
   Expiring stale pending rows is part of every run, so there is no separate command.
3. **MCP tools** (`src/server/mcp/tools-read.ts` / `tools-write.ts`): `get_sync_status`
   (settings, enrollments, last run, pending count/total), `list_pending_transactions`,
   `run_bank_sync` (write; confirm-first like the others). **All read from our tables** —
   `list_pending_transactions` is `SELECT … WHERE status='pending'`, never a provider call
   (D11). `run_bank_sync` is the one tool that reaches the provider, and only via `sync.ts`.
4. **Tests** (`npm test`, `npm run test:e2e`; see "Testing" below).

## Testing
- **Unit** (`tests/unit/`, no DB): `reconcile.test.ts` (every D3/D4/D5/D9/D12/D13 rule,
  window and sync-from math, pending placeholders), `crypto.test.ts`, `sync-misc.test.ts`
  (settings validation, display helpers). Provider-specific tests (mapping, webhook
  signature) left with the Teller adapter — bring them back with the next provider.
- **E2E** (`tests/e2e/`, real DB from `.env.local`, one file at a time): `helpers.ts`
  registers an in-memory `FakeProvider` (id `e2efake`) and creates tagged fixtures
  (`[e2e] …` accounts, an `E2E-RULE` category rule) that `teardownFixtures` removes.
  `sync.test.ts` drives `runSync` through enrollment, first sync, no-op re-run,
  pending→posted, expiry with carried edits, soft duplicates vs a CSV row, dry run, the
  run lock, disconnected/closed errors, settings toggles and removal. `webhook.test.ts`
  covers `handleWebhook`; `scheduler.test.ts` covers `tick`; `pages.test.ts` calls the
  server components with a stubbed session (`tests/stubs-session.cjs`) and walks the
  element tree. `pending.test.ts` covers hand-entered pending rows.
- Both preloads live in `tests/`: `stubs.cjs` (server-only, next/cache, .env.local) and
  `stubs-session.cjs` (adds the session stub; tests only).
- **Safety latch**: the e2e suite refuses to start while any non-fake enrollment exists in
  the target database (`assertNoLiveEnrollments`), because it triggers whole-ledger runs.
  Point `.env.test` at a scratch DB once real banks are linked, or set
  `E2E_ALLOW_LIVE_ENROLLMENTS=1` knowingly.

## Non-obvious logic / edge cases
- **Run mutex**: `lock_until = now + 10 min` set with a conditional UPDATE
  (`WHERE lock_until IS NULL OR lock_until < NOW()`); affected-rows = 0 → skip. Cleared in a
  `finally`. A crashed run self-heals after 10 min.
- **Window vs sync_from**: first run backfills from `sync_from` (can be months); later runs
  start at `min(today − window, lastSyncedAt − window)`, never before `sync_from`, and are
  pulled back to the oldest pending row held (D13). Calendar dates use the server's local
  zone, like `todayIso()`.
- **Initial history timeouts**: Teller warns the first transactions call can time out on big
  accounts — retry with backoff (3×), and the first run for a new account uses
  `count=250` pages.
- **Period assignment**: `periodId` from `txnDate` via the existing `periodMap`; a pending row
  that posts into a different month moves periods.
- **Transfers**: Teller `type === 'transfer'` is stored in `raw` and offered as a hint to the
  existing transfer pairing (posted rows only, D2).
- **Rate limits**: 429 → honor `Retry-After` up to 60 s (longer → fail that account now, the
  run is `partial`), max 3 retries. The next run happens at the normal interval.
- **Closed accounts**: `account.closed` (410) → `external_status='closed'`, `enabled=false`,
  a notice; nothing deleted.
- **Local dev**: no webhooks reach a laptop; use `scripts/teller.ts sync` and the settings
  "Sync now". Sandbox tokens (`test_token_…`) don't need the cert.
- **Deleting an enrollment** on Teller's side does **not** refund the 100-enrollment cap —
  the Remove button says so. Prefer Pause.

## Rollout — phases with checkpoints
Done 2026-09-20: 1 (foundation + sandbox), 3 (settings UI), 4 (scheduler, webhook, cron
fallback, proxy), 5 (pending UX, MCP, CLI), 6 (docs). **Open: 0 and 2** — need the user's
Teller application (cert + app id) and the real-bank enrollments.

0. **User**: create the Teller app (teller.io → Dashboard → Applications), download
   `certificate.pem` + `private_key.pem`, note the `app_…` id. Add the env vars to
   `.env.local` (sandbox) and to the production env secret file (Jenkins).
   *Checkpoint*: `npx tsx scripts/teller.ts token check` succeeds against sandbox.
1. **Foundation** (no UI): migration 0022, `teller/` adapter, `reconcile.ts` + tests, CLI
   `sync --dry-run` against **sandbox**, sign convention confirmed and encoded (D10).
   *Checkpoint*: sandbox transactions land in a throwaway local account with correct
   directions; a second run inserts 0.
2. **Real data**: switch `.env.local` to `development`, enroll a single-account bank first,
   then a multi-account bank, and any business login last (the business-login risk).
   *Checkpoint*: soft-match report against the CSV history shows no double-imports; balances
   recorded.
3. **Settings UI**: tile, `/settings/sync`, Connect, mapping, run history, advanced.
   *Checkpoint*: link/pause/reconnect/remove all work from the browser; interval change moves
   `next_run_at`.
4. **Automation**: `instrumentation.ts` scheduler, webhook route + proxy allowlist + signature
   verification, `/api/sync/run` fallback, `SYNC_SCHEDULER=1` in prod env, deploy with
   `RUN_MIGRATIONS` (or `apply-sql` per [../design/07-decisions.md](../design/07-decisions.md)).
   *Checkpoint*: Teller dashboard "send test webhook" stamps `last_webhook_at`; a scheduled run
   appears in history without anyone touching the app.
5. **Pending UX + tools**: transaction badge/filter, dashboard chip, account card line,
   SetupNotice for disconnects, StatusBar indicator, MCP tools, CLI polish.
6. **Docs**: convert this file to the live feature doc, add
   update `csv-import.md` / `pdf-import.md`
   "Related", record decisions in `07-decisions.md`.

## Open questions (non-blocking; defaults chosen)
- Should pending charges count toward **budget** actuals? Default **yes** (matches D1); a
  per-budget toggle can come later if it's noisy.
- Balance mode for credit cards (`ledger` vs `available`-derived owed) — D7 picks `ledger`;
  revisit once a statement cycle has been observed.
- Whether to auto-create a local `accounts` row for unmapped external accounts — default
  **no** (explicit mapping keeps the ledger clean).

## Related
- Sibling features: [csv-import.md](csv-import.md), [pdf-import.md](pdf-import.md),
  [accounts-and-balances.md](accounts-and-balances.md), [categorization.md](categorization.md),
  [transfers.md](transfers.md)
- Decisions: [../design/07-decisions.md](../design/07-decisions.md)
- Teller docs: environments, webhooks, transactions (syncing section), accounts,
  authentication — https://teller.io/docs

# Migration & Seed

How the schema gets created and how `notion_data/` history gets loaded.

## Chosen path (see [07-decisions.md](07-decisions.md))

The MCP MySQL user **cannot run DDL** (`CREATE TABLE` returns "DDL operations are not
allowed"; DELETE/DROP also blocked). A probe confirmed it. So:

- **Schema** is created with a **privileged connection string** (`DATABASE_MIGRATION_URL`)
  via `drizzle-kit` — version-controlled in `drizzle/`. Not through MCP.
- **Target**: a new dedicated database **`personal_billing`** (the migration user needs
  `CREATE DATABASE`, or the user pre-creates the empty DB and grants rights).
- **MCP** is used afterward for read/verification (INSERT works too, but the seed runs
  through the app's ORM for consistency with the live import code).

> The **runtime app** user needs `SELECT/INSERT/UPDATE/DELETE` on `personal_billing`.
> A single privileged user can serve both migration and runtime if preferred.

Reference for the original blocker details:
```
readonly:false  allowDDL:false ❌  allowDrop:false ❌  allowDelete:false ❌
user: <mcp-user>   host: <db-host>
```

## Full DDL (canonical — dedicated DB, unprefixed names)

```sql
CREATE DATABASE IF NOT EXISTS personal_billing
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE personal_billing;

CREATE TABLE periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year SMALLINT NOT NULL,
  month TINYINT NOT NULL,
  label VARCHAR(20) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_period (year, month)
);

CREATE TABLE bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  default_amount DECIMAL(10,2) NULL,
  default_due_day TINYINT NULL,
  default_payment_type VARCHAR(32) NULL,
  is_debt BOOLEAN NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bill_name (name)
);

CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_number VARCHAR(8) NOT NULL,
  label VARCHAR(64) NULL,
  institution VARCHAR(64) NULL,
  account_type VARCHAR(32) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_acct (account_number)
);

CREATE TABLE bill_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_id INT NOT NULL,
  bill_id INT NULL,
  name VARCHAR(191) NOT NULL,
  amount DECIMAL(10,2) NULL,
  status VARCHAR(32) NOT NULL,
  due_day TINYINT NULL,
  payment_type VARCHAR(32) NULL,
  is_debt BOOLEAN NOT NULL DEFAULT 0,
  is_cancel BOOLEAN NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_bi_period (period_id),
  KEY idx_bi_bill (bill_id),
  CONSTRAINT fk_bi_period FOREIGN KEY (period_id) REFERENCES periods(id),
  CONSTRAINT fk_bi_bill FOREIGN KEY (bill_id) REFERENCES bills(id)
);

CREATE TABLE import_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  source VARCHAR(64) NULL,
  account_id INT NULL,
  total_rows INT NOT NULL,
  inserted_count INT NOT NULL,
  duplicate_count INT NOT NULL,
  error_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ib_acct FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NULL,
  period_id INT NULL,
  bill_instance_id INT NULL,
  txn_date DATE NOT NULL,
  description VARCHAR(512) NOT NULL,
  category VARCHAR(48) NULL,
  amount DECIMAL(12,2) NOT NULL,
  net_amount DECIMAL(12,2) NULL,
  direction VARCHAR(8) NOT NULL,
  dedup_hash CHAR(64) NOT NULL,
  import_batch_id INT NULL,
  raw JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dedup (dedup_hash),
  KEY idx_tx_date (txn_date),
  KEY idx_tx_acct (account_id),
  KEY idx_tx_cat (category),
  CONSTRAINT fk_tx_acct FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_tx_period FOREIGN KEY (period_id) REFERENCES periods(id),
  CONSTRAINT fk_tx_bi FOREIGN KEY (bill_instance_id) REFERENCES bill_instances(id),
  CONSTRAINT fk_tx_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
);

CREATE TABLE category_mappings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  match_type VARCHAR(12) NOT NULL,
  pattern VARCHAR(255) NOT NULL,
  field VARCHAR(16) NOT NULL DEFAULT 'description',
  category VARCHAR(48) NOT NULL,
  bill_id INT NULL,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cm_bill FOREIGN KEY (bill_id) REFERENCES bills(id)
);
```

> This DDL is the canonical reference. In practice it is generated by `drizzle-kit` from
> `src/server/db/schema.ts` so schema and code never drift.

## Seed plan (`scripts/seed-history.ts`)

Idempotent loader, runnable repeatedly. Order matters (FKs):

1. **Accounts** — insert each distinct last-4 account number found in the transaction CSVs (`INSERT IGNORE`).
2. **Periods** — derive `(year, month)` from each month folder's name prefix (`MM 01 YY`),
   `INSERT IGNORE`. (Handles labels like `09 ... 31 25` — a 30-day month written with `31` — by trusting the prefix.)
3. **Bills (definitions)** — collect distinct bill names across all months; create one
   `bills` row per canonical name. Apply a small alias map for known renames
   (e.g. `Card A Credit Card`→`Card A`) so instances link to the same recurring bill. Aliases are reviewable in the script.
4. **Bill instances** — one row per CSV bill row, linked to its period and (best-effort)
   bill_id. Parse amount via `lib/money`, `Yes/No`→bool, status/payment-type passed through
   (validated against the enum; unknown values logged, not dropped).
5. **Transactions** — parse each month's transaction CSV (where present); compute `dedup_hash`; `INSERT IGNORE`
   so re-running is safe. Link `account_id` by number, `period_id` by date.

Idempotency: every insert is `INSERT IGNORE` / upsert on the natural unique key, so the
seed can run after the app already has live data without creating duplicates.

Counts to expect after seed: one period per month folder, one bill instance per bill CSV
row, one account per distinct last-4, and one transaction per transaction CSV row (minus
exact duplicates). See [01-data-inventory.md](01-data-inventory.md) for the format.

## Verification

After seeding, verify via MCP (read is allowed):
```sql
SELECT label, COUNT(*) FROM bill_instances bi
  JOIN periods p ON p.id = bi.period_id GROUP BY label ORDER BY label;
SELECT COUNT(*), COUNT(DISTINCT dedup_hash) FROM transactions;  -- must be equal
```

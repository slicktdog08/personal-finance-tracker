import {
  mysqlTable,
  int,
  smallint,
  tinyint,
  varchar,
  decimal,
  boolean,
  date,
  text,
  timestamp,
  json,
  char,
  index,
  uniqueIndex,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// MySQL 5.7 doesn't support DEFAULT (now()); use literal CURRENT_TIMESTAMP.

// Months ("sheets"). One row per tracked month.
export const periods = mysqlTable(
  "periods",
  {
    id: int("id").autoincrement().primaryKey(),
    year: smallint("year").notNull(),
    month: tinyint("month").notNull(),
    label: varchar("label", { length: 20 }).notNull(),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_period").on(t.year, t.month)],
);

// Recurring bill definitions (a bill's identity across months).
export const bills = mysqlTable(
  "bills",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 191 }).notNull(),
    defaultAmount: decimal("default_amount", { precision: 10, scale: 2 }),
    defaultDueDay: tinyint("default_due_day"),
    defaultPaymentType: varchar("default_payment_type", { length: 32 }),
    isDebt: boolean("is_debt").notNull().default(false),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_bill_name").on(t.name), index("idx_bill_active").on(t.active)],
);

// Every asset & liability lives here — the single registry. accountType drives behavior:
// Checking/Savings are cash (track `balance` in account_balances); Credit/Loan are liabilities
// (track balance owed + APR + min payment, and — for Credit — a credit limit). The liability
// facts below (only meaningful for Credit/Loan) used to live on a separate `debts` table; they
// were folded in here so a credit card is ONE entity, edited in one ledger.
export const accounts = mysqlTable(
  "accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    accountNumber: varchar("account_number", { length: 8 }).notNull(),
    label: varchar("label", { length: 64 }),
    institution: varchar("institution", { length: 64 }),
    accountType: varchar("account_type", { length: 32 }),
    // ---- Liability facts (Credit/Loan only; null on cash accounts) ----
    // Starting loan/original balance, so we can show payoff progress. Null = unknown.
    originalPrincipal: decimal("original_principal", { precision: 12, scale: 2 }),
    openedOn: date("opened_on", { mode: "string" }),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    // Optional link to the recurring bill this liability is paid via — powers payment
    // attribution (transactions → bill_instance → bill) and the "promote a bill" flow.
    billId: int("bill_id").references(() => bills.id),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [
    uniqueIndex("uq_acct").on(t.accountNumber),
    uniqueIndex("uq_acct_bill").on(t.billId),
  ],
);

// A bill's state within one month — the row the user edits.
export const billInstances = mysqlTable(
  "bill_instances",
  {
    id: int("id").autoincrement().primaryKey(),
    periodId: int("period_id")
      .notNull()
      .references(() => periods.id),
    billId: int("bill_id").references(() => bills.id),
    name: varchar("name", { length: 191 }).notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }),
    status: varchar("status", { length: 32 }).notNull(),
    dueDay: tinyint("due_day"),
    paymentType: varchar("payment_type", { length: 32 }),
    isDebt: boolean("is_debt").notNull().default(false),
    isCancel: boolean("is_cancel").notNull().default(false),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [index("idx_bi_period").on(t.periodId), index("idx_bi_bill").on(t.billId)],
);

// Audit trail per CSV import.
export const importBatches = mysqlTable("import_batches", {
  id: int("id").autoincrement().primaryKey(),
  filename: varchar("filename", { length: 255 }).notNull(),
  source: varchar("source", { length: 64 }),
  accountId: int("account_id").references(() => accounts.id),
  totalRows: int("total_rows").notNull(),
  insertedCount: int("inserted_count").notNull(),
  duplicateCount: int("duplicate_count").notNull(),
  errorCount: int("error_count").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Individual bank transactions.
export const transactions = mysqlTable(
  "transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    accountId: int("account_id").references(() => accounts.id),
    periodId: int("period_id").references(() => periods.id),
    billInstanceId: int("bill_instance_id").references(() => billInstances.id, {
      onDelete: "set null",
    }),
    // Durable link to the recurring bill this transaction belongs to. Unlike
    // billInstanceId (one month's instance), billId spans months, so every past
    // and future occurrence of the same charge attributes to a single bill even
    // though instances are only created going forward. ON DELETE SET NULL so a
    // bill/instance can be deleted or merged without a FK error — the transaction
    // just becomes unlinked.
    billId: int("bill_id").references(() => bills.id, { onDelete: "set null" }),
    // The other side of an internal account-to-account transfer (self reference).
    transferPartnerId: int("transfer_partner_id").references((): AnyMySqlColumn => transactions.id),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    description: varchar("description", { length: 512 }).notNull(),
    // The user's own long-form explanation of the charge. `description` is the
    // merchant string the bank supplies and drives dedup/merchant matching;
    // `notes` is free-form commentary and drives nothing.
    notes: text("notes"),
    category: varchar("category", { length: 48 }),
    // Which saved categorization rule set `category` (null = set by hand, or
    // categorized before this was tracked). Lets a row show "auto-set by rule X"
    // so the rule can be edited/removed when it guessed wrong. Cleared whenever
    // the category is set manually; SET NULL when the rule is deleted.
    categoryRuleId: int("category_rule_id").references((): AnyMySqlColumn => categoryMappings.id, {
      onDelete: "set null",
    }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    netAmount: decimal("net_amount", { precision: 12, scale: 2 }),
    direction: varchar("direction", { length: 8 }).notNull(),
    dedupHash: char("dedup_hash", { length: 64 }).notNull(),
    importBatchId: int("import_batch_id").references(() => importBatches.id),
    raw: json("raw"),
    // Where the row came from: import (CSV) | pdf | manual | <sync provider id>.
    // Bank-synced rows also carry the provider's stable transaction id in `externalId`
    // (unique per source) — that is what the sync writer upserts on, because a
    // content-based dedup hash would change when a pending row posts. See
    // planning/features/bank-sync.md (D3).
    source: varchar("source", { length: 16 }).notNull().default("import"),
    externalId: varchar("external_id", { length: 64 }),
    // Authorized but not settled: a card hold, a tip not yet finalized, a synced row the bank
    // hasn't posted. Counts as spend like any other row but is excluded from bill linking,
    // suggestions and transfer pairing; when the posted version arrives it is merged into this
    // row's place instead of landing beside it. See planning/features/pending-transactions.md
    // and bank-sync.md (D2).
    //
    // THE pending flag — the bank-sync branch carried a parallel `status` varchar for the same
    // idea. This one won because it is the model production actually adopted: `pending` is
    // recorded in sql_migrations (0022_add_txn_pending) and carries live rows, while `status`
    // was pushed to the database but never tracked and never held a pending row.
    pending: boolean("pending").notNull().default(false),
    // Superseded by `pending` above and read by nothing. Declared only so this schema still
    // matches the live database, because `drizzle-kit push` drops columns a schema omits — and
    // dropping a production column to tidy up a dead field is not a trade worth making. Delete
    // the declaration and the column together, deliberately, or leave both alone.
    status: varchar("status", { length: 12 }).notNull().default("posted"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_dedup").on(t.dedupHash),
    index("idx_tx_pending").on(t.pending),
    uniqueIndex("uq_tx_external").on(t.source, t.externalId),
    index("idx_tx_date").on(t.txnDate),
    index("idx_tx_acct").on(t.accountId),
    index("idx_tx_cat").on(t.category),
    index("idx_tx_bill").on(t.billId),
    index("idx_tx_cat_rule").on(t.categoryRuleId),
    index("idx_tx_status").on(t.status),
  ],
);

// Cash offsets — "$X of this ATM withdrawal paid for that purchase".
//
// A withdrawal (Debit, category "Cash", on a real bank account) and the wallet purchases it
// funded (Debits on a Cash-type account) are the same money, so counting both double-counts
// the month. The bank row can't be adjusted — it's re-imported from the statement — so the
// link lives here instead. Rollups then count a withdrawal only for its UNALLOCATED remainder
// (amount − SUM(amount) here), which is exactly "cash I couldn't account for", and each wallet
// purchase counts once under its own real category.
//
// The per-link `amount` (rather than a single FK on the purchase) is what makes it exact: one
// $300 withdrawal covers many purchases, and one purchase can draw on two withdrawals. Both
// FKs cascade — an allocation is meaningless without both sides.
export const cashAllocations = mysqlTable(
  "cash_allocations",
  {
    id: int("id").autoincrement().primaryKey(),
    withdrawalTxnId: int("withdrawal_txn_id")
      .notNull()
      .references((): AnyMySqlColumn => transactions.id, { onDelete: "cascade" }),
    spendTxnId: int("spend_txn_id")
      .notNull()
      .references((): AnyMySqlColumn => transactions.id, { onDelete: "cascade" }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_cash_alloc").on(t.withdrawalTxnId, t.spendTxnId),
    index("idx_ca_withdrawal").on(t.withdrawalTxnId),
    index("idx_ca_spend").on(t.spendTxnId),
  ],
);

// Transaction splits — "$X of this transaction belongs in category C".
//
// For a charge that was really two things (a Target run that was half groceries, half
// household). Like cash offsets, the pieces live beside the bank row rather than replacing it,
// because the row is re-imported from the statement and must keep matching it. The
// transaction's own `category` keeps the REMAINDER (amount − SUM(amount) here), so the parts
// always add back up to the whole. Cascades with the transaction.
// See planning/features/transaction-splits.md.
export const transactionSplits = mysqlTable(
  "transaction_splits",
  {
    id: int("id").autoincrement().primaryKey(),
    txnId: int("txn_id")
      .notNull()
      .references((): AnyMySqlColumn => transactions.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 48 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_ts_txn").on(t.txnId), index("idx_ts_cat").on(t.category)],
);

// Rules that map raw bank text → a system category (and optionally a bill).
export const categoryMappings = mysqlTable("category_mappings", {
  id: int("id").autoincrement().primaryKey(),
  matchType: varchar("match_type", { length: 12 }).notNull(), // contains | equals | regex
  pattern: varchar("pattern", { length: 255 }).notNull(),
  field: varchar("field", { length: 16 }).notNull().default("description"), // description | raw_category
  category: varchar("category", { length: 48 }).notNull(),
  billId: int("bill_id").references(() => bills.id),
  priority: int("priority").notNull().default(100),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
});

// Customizable lookup for bill statuses (name + color + settled flag).
export const billStatuses = mysqlTable(
  "bill_statuses",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 32 }).notNull(),
    color: varchar("color", { length: 16 }).notNull().default("#9ca3af"),
    emoji: varchar("emoji", { length: 16 }),
    isSettled: boolean("is_settled").notNull().default(false),
    sortOrder: int("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_status_name").on(t.name)],
);

// Customizable lookup for payment types (name + color).
export const paymentTypes = mysqlTable(
  "payment_types",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 32 }).notNull(),
    color: varchar("color", { length: 16 }).notNull().default("#9ca3af"),
    emoji: varchar("emoji", { length: 16 }),
    sortOrder: int("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_ptype_name").on(t.name)],
);

// The single dated balance ledger for EVERY account (history, not one field), queried "as of"
// a date. Checking/savings record cash-on-hand in `balance`. Credit/Loan record the amount owed
// in `balance`, plus (Credit only) the card's `credit_limit`, plus `apr` and `min_payment`.
// apr/min_payment carry forward from the freshest non-null snapshot when a later one omits them
// (rates rarely change). monthly interest ≈ balance * apr/100 / 12.
export const accountBalances = mysqlTable(
  "account_balances",
  {
    id: int("id").autoincrement().primaryKey(),
    accountId: int("account_id")
      .notNull()
      .references(() => accounts.id),
    balance: decimal("balance", { precision: 12, scale: 2 }).notNull(),
    creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }),
    apr: decimal("apr", { precision: 5, scale: 2 }),
    minPayment: decimal("min_payment", { precision: 10, scale: 2 }),
    asOf: date("as_of", { mode: "string" }).notNull(),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_ab_acct").on(t.accountId), index("idx_ab_date").on(t.asOf)],
);

// A debt is the financial face of a bill (one marked is_debt) — a loan being repaid.
// Static facts live here; the balance/APR/min-payment that change over time live in
// `debt_balances` (a dated-snapshot ledger, exactly like account_balances). 1:1 with a bill.
// Unlike a credit card, paying down a debt does NOT free up available credit — the balance
// simply trends toward zero, which is what the ledger + payoff progress track.
export const debts = mysqlTable(
  "debts",
  {
    id: int("id").autoincrement().primaryKey(),
    billId: int("bill_id")
      .notNull()
      .references(() => bills.id),
    // The starting loan amount, so we can show how much has been paid down. Null = unknown.
    originalPrincipal: decimal("original_principal", { precision: 12, scale: 2 }),
    openedOn: date("opened_on", { mode: "string" }),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_debt_bill").on(t.billId)],
);

// Manual snapshots of a debt's outstanding balance over time (history, not a single field) —
// queried "as of" a date like account_balances. APR and min payment are captured on the same
// snapshot (they can drift: variable rates, promo periods ending), each carried forward from
// the last known value when not re-entered. monthly interest ≈ balance * apr/100 / 12.
export const debtBalances = mysqlTable(
  "debt_balances",
  {
    id: int("id").autoincrement().primaryKey(),
    debtId: int("debt_id")
      .notNull()
      .references(() => debts.id),
    balance: decimal("balance", { precision: 12, scale: 2 }).notNull(),
    apr: decimal("apr", { precision: 5, scale: 2 }),
    minPayment: decimal("min_payment", { precision: 10, scale: 2 }),
    asOf: date("as_of", { mode: "string" }).notNull(),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_db_debt").on(t.debtId), index("idx_db_date").on(t.asOf)],
);

// Customizable lookup for transaction categories (managed in Settings).
export const categories = mysqlTable(
  "categories",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 48 }).notNull(),
    color: varchar("color", { length: 16 }).notNull().default("#9ca3af"),
    emoji: varchar("emoji", { length: 16 }),
    sortOrder: int("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_category_name").on(t.name)],
);

// Suggested transfer pairs the user dismissed, so they don't reappear. Stored as the
// normalized (low,high) transaction-id pair.
export const transferDismissals = mysqlTable(
  "transfer_dismissals",
  {
    id: int("id").autoincrement().primaryKey(),
    lowId: int("low_id").notNull(),
    highId: int("high_id").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_dismissal").on(t.lowId, t.highId)],
);

// Recurring-bill suggestions the user dismissed, keyed by normalized merchant key,
// so a spend group that isn't a bill (ATM cash, food delivery, …) stops being
// re-suggested on the Bills screen.
export const suggestionDismissals = mysqlTable(
  "suggestion_dismissals",
  {
    id: int("id").autoincrement().primaryKey(),
    merchantKey: varchar("merchant_key", { length: 191 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_suggestion_key").on(t.merchantKey)],
);

// A savings goal — accumulate money toward a target (emergency fund, a future purchase, or
// paying a set amount toward a debt). Progress is the running SUM of `goal_contributions`
// (an append-only funding ledger, exactly like account_balances). `fundingAccountId` optionally
// links the real account backing the goal: for cash goals the allocation is reality-checked
// against that account's recorded cash-on-hand, so when the account dips below what's been
// allocated the goal shows a shortfall (it "regresses"). For debt_payoff goals it points at the
// liability being paid down and is shown for context only. goalType/status are VARCHAR + an
// enums.ts const (add values without a migration, like the other lookups).
export const savingsGoals = mysqlTable(
  "savings_goals",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 191 }).notNull(),
    goalType: varchar("goal_type", { length: 32 }).notNull().default("savings"),
    targetAmount: decimal("target_amount", { precision: 12, scale: 2 }).notNull(),
    targetDate: date("target_date", { mode: "string" }),
    fundingAccountId: int("funding_account_id").references(() => accounts.id),
    color: varchar("color", { length: 16 }).notNull().default("#3b82f6"),
    emoji: varchar("emoji", { length: 16 }),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | achieved | archived
    sortOrder: int("sort_order").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [index("idx_goal_status").on(t.status), index("idx_goal_acct").on(t.fundingAccountId)],
);

// Append-only funding ledger for a savings goal (history, not one mutable field — like
// account_balances). Positive amount = money put toward the goal, negative = withdrawn.
// `transactionId` optionally ties a contribution to the real bank transaction that funded it
// (SET NULL so deleting the transaction just unlinks it) — the hook the future paycheck-
// allocation module writes into.
export const goalContributions = mysqlTable(
  "goal_contributions",
  {
    id: int("id").autoincrement().primaryKey(),
    goalId: int("goal_id")
      .notNull()
      .references(() => savingsGoals.id),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    note: varchar("note", { length: 255 }),
    transactionId: int("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_gc_goal").on(t.goalId), index("idx_gc_date").on(t.occurredOn)],
);

// When the paycheck lands and roughly how much of it survives taxes. Single-row config table
// (always id = 1) rather than a lookup list — there is one earner and one schedule, and a
// singleton row keeps reads a plain `.limit(1)` with no "which one is active?" ambiguity.
// `frequency` is VARCHAR + a const in enums.ts so new cadences need no migration.
// Which columns matter depends on the cadence: semimonthly/monthly use dayOne/dayTwo,
// weekly/biweekly use anchorDate. The unused ones are left NULL, not zeroed.
export const paySchedule = mysqlTable("pay_schedule", {
  id: int("id").autoincrement().primaryKey(),
  frequency: varchar("frequency", { length: 32 }).notNull().default("semimonthly"),
  dayOne: int("day_one"), // day-of-month; clamped to month length at read time
  dayTwo: int("day_two"), // second day-of-month, semimonthly only
  anchorDate: date("anchor_date", { mode: "string" }), // a known payday, weekly/biweekly only
  takeHome: decimal("take_home", { precision: 12, scale: 2 }), // estimated net PER paycheck
  // How far a real deposit may drift from its nominal payday and still count as that payday —
  // a split direct deposit lands its halves on different days, and a Friday payday can pay
  // Thursday before a holiday. The projection nets arrivals inside this window out of the
  // scheduled amount so the arrived part isn't counted twice. See payday-reconcile.ts.
  depositWindowDays: int("deposit_window_days").notNull().default(3),
  // Case-insensitive regex picking payroll credits out of all deposits; null = the built-in
  // DEFAULT_DEPOSIT_MATCH.
  depositMatch: varchar("deposit_match", { length: 255 }),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .onUpdateNow(),
});

// A budget: the PLAN for one month, laid against what the transactions say actually happened.
// One per period. `mode` is the generator that produced it (debt_snowball | manual) and
// `strategy` the debt ordering it used; both VARCHAR + enums.ts consts so a new mode needs no
// migration. `plannedIncome` is the month's expected take-home (defaulted from pay_schedule).
// Budgets are deliberately NOT tied to bill_instances: bills say what's due, transactions say
// what was spent, and a budget is about the second thing. See planning/features/budget.md.
export const budgets = mysqlTable(
  "budgets",
  {
    id: int("id").autoincrement().primaryKey(),
    periodId: int("period_id")
      .notNull()
      .references(() => periods.id),
    mode: varchar("mode", { length: 32 }).notNull().default("manual"),
    strategy: varchar("strategy", { length: 32 }),
    plannedIncome: decimal("planned_income", { precision: 12, scale: 2 }),
    // When on, every write re-derives the target debt's payment as income − every other line,
    // so the snowball keeps sweeping the leftover with no manual "Rebalance" click.
    autoRebalance: boolean("auto_rebalance").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_budget_period").on(t.periodId)],
);

// One line of a budget. `kind` decides where the actual comes from: a `category` line sums
// the month's net spend in `category` (same rule as the dashboard — cash offsets included);
// a `debt` line sums Debit payments linked to `accountId`'s bill. `planned` is the full
// planned amount; debt lines also snapshot `minimum` at planning time so "min + extra" stays
// readable after the account's minimum changes. `isTarget` marks the snowball focus debt.
// Cascades with its budget; an account deletion just unlinks the line.
export const budgetLines = mysqlTable(
  "budget_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    budgetId: int("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(), // category | debt
    label: varchar("label", { length: 191 }).notNull(),
    category: varchar("category", { length: 48 }),
    accountId: int("account_id").references(() => accounts.id, { onDelete: "set null" }),
    planned: decimal("planned", { precision: 12, scale: 2 }).notNull().default("0.00"),
    minimum: decimal("minimum", { precision: 12, scale: 2 }),
    isTarget: boolean("is_target").notNull().default(false),
    // Lines start pinned. The unlocked lines are the balancing pool: edit one and the other
    // unlocked lines absorb the difference (with none, the leftover — or the auto-rebalance
    // target — absorbs it). See planning/features/budget.md.
    locked: boolean("locked").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
    notes: varchar("notes", { length: 255 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [index("idx_bl_budget").on(t.budgetId), index("idx_bl_account").on(t.accountId)],
);

// What the cash projection said on a given day for a month — written once per (period, day),
// never overwritten — so today's projection can be compared to last week's ("am I trending
// above or below plan?"). See planning/features/budget.md.
export const projectionSnapshots = mysqlTable(
  "projection_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    periodId: int("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    takenOn: date("taken_on", { mode: "string" }).notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    cashNow: decimal("cash_now", { precision: 12, scale: 2 }).notNull(),
    endBalance: decimal("end_balance", { precision: 12, scale: 2 }).notNull(), // this month's end
    horizonBalance: decimal("horizon_balance", { precision: 12, scale: 2 }).notNull(), // end of the horizon
    lowBalance: decimal("low_balance", { precision: 12, scale: 2 }).notNull(),
    lowDate: date("low_date", { mode: "string" }).notNull(),
    spreadTotal: decimal("spread_total", { precision: 12, scale: 2 }).notNull(),
    hotEnd: decimal("hot_end", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_proj_snap").on(t.periodId, t.takenOn)],
);

// Which hand-written drizzle/*.sql files have been applied. Created and written only by
// scripts/apply-sql.ts (the Jenkins APPLY_SQL stage runs it with --pending on every deploy);
// declared here so drizzle-kit push doesn't treat it as a stray table. The app never reads it.
export const sqlMigrations = mysqlTable("sql_migrations", {
  filename: varchar("filename", { length: 255 }).primaryKey(),
  appliedAt: timestamp("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  note: varchar("note", { length: 64 }),
});

// ---------------------------------------------------------------------------
// Bank sync (planning/features/bank-sync.md)
// ---------------------------------------------------------------------------

// Singleton (id = 1, like pay_schedule): how the automatic bank sync behaves. Config lives
// here rather than in env so the interval etc. can be changed from /settings/sync without a
// redeploy; secrets (certificates, webhook secret, token key) stay in env.
export const syncSettings = mysqlTable("sync_settings", {
  id: int("id").autoincrement().primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  intervalMinutes: int("interval_minutes").notNull().default(180),
  // How far back each run re-queries so pending → posted date shifts are caught (7–10 is
  // typical).
  syncWindowDays: int("sync_window_days").notNull().default(10),
  // A pending row the provider stops returning for this many days is dropped (D5).
  pendingExpiryDays: int("pending_expiry_days").notNull().default(7),
  recordBalances: boolean("record_balances").notNull().default(true),
  autoCategorize: boolean("auto_categorize").notNull().default(true),
  webhookEnabled: boolean("webhook_enabled").notNull().default(true),
  // Run mutex: a run claims the row by setting lock_until = now + 10min with a conditional
  // UPDATE; scheduler, webhook, "Sync now" and the CLI all go through it. A crashed run
  // self-heals when the lock expires.
  lockUntil: timestamp("lock_until"),
  nextRunAt: timestamp("next_run_at"),
  lastRunId: int("last_run_id"),
  lastWebhookAt: timestamp("last_webhook_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .onUpdateNow(),
});

// One row per bank login at a provider (an "enrollment" / "item"). The access token
// is AES-256-GCM encrypted under SYNC_TOKEN_ENCRYPTION_KEY — it is the only thing that can
// read the bank. `provider` is the SyncProvider id, so a second provider is additive.
export const syncEnrollments = mysqlTable(
  "sync_enrollments",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: varchar("provider", { length: 16 }).notNull(),
    enrollmentId: varchar("enrollment_id", { length: 64 }).notNull(),
    institutionId: varchar("institution_id", { length: 64 }),
    institutionName: varchar("institution_name", { length: 128 }),
    providerUserId: varchar("provider_user_id", { length: 64 }),
    accessTokenEnc: text("access_token_enc").notNull(),
    // active | disconnected | paused. Disconnected = the provider said the login is broken
    // (needs a reconnect in the UI); paused = the user turned it off without deleting it.
    status: varchar("status", { length: 16 }).notNull().default("active"),
    disconnectReason: varchar("disconnect_reason", { length: 64 }),
    enrolledAt: timestamp("enrolled_at").default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: timestamp("last_synced_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_sync_enrollment").on(t.provider, t.enrollmentId)],
);

// An account the provider exposes under an enrollment, and which local `accounts` row it
// feeds. `accountId` null = seen but unmapped: nothing is synced for it until the user maps it
// in /settings/sync. `syncFrom` bounds the first backfill so it doesn't re-import history
// that already came in via CSV/PDF (D4).
export const syncAccounts = mysqlTable(
  "sync_accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    enrollmentId: int("enrollment_id")
      .notNull()
      .references(() => syncEnrollments.id, { onDelete: "cascade" }),
    externalAccountId: varchar("external_account_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }),
    type: varchar("type", { length: 16 }), // depository | credit
    subtype: varchar("subtype", { length: 32 }),
    lastFour: varchar("last_four", { length: 4 }),
    currency: varchar("currency", { length: 3 }),
    accountId: int("account_id").references(() => accounts.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    syncBalances: boolean("sync_balances").notNull().default(true),
    syncFrom: date("sync_from", { mode: "string" }),
    externalStatus: varchar("external_status", { length: 16 }).notNull().default("open"),
    lastSyncedAt: timestamp("last_synced_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [
    uniqueIndex("uq_sync_account").on(t.externalAccountId),
    // One external account per local account (NULLs are free): two feeds into one ledger
    // account would each treat the other's pending rows as vanished and expire them.
    uniqueIndex("uq_sync_account_local").on(t.accountId),
    index("idx_sa_enrollment").on(t.enrollmentId),
  ],
);

// Tombstones: a synced row the user deleted by hand. Without this the next run would
// re-insert it for as long as it stays inside the re-query window. Written by
// deleteTransaction, read by the sync writer before inserting.
export const syncIgnored = mysqlTable(
  "sync_ignored",
  {
    id: int("id").autoincrement().primaryKey(),
    source: varchar("source", { length: 16 }).notNull(),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_sync_ignored").on(t.source, t.externalId)],
);

// Audit log of every sync run — what /settings/sync shows. `details` holds per-account
// counts, the soft-match list and per-enrollment errors for the expandable row. Pruned to
// the newest 200 at the end of each run.
export const syncRuns = mysqlTable(
  "sync_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    trigger: varchar("trigger", { length: 16 }).notNull(), // scheduled | webhook | manual | cli
    enrollmentId: int("enrollment_id").references(() => syncEnrollments.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 12 }).notNull().default("running"), // running | ok | partial | failed
    dryRun: boolean("dry_run").notNull().default(false),
    startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`),
    finishedAt: timestamp("finished_at"),
    inserted: int("inserted").notNull().default(0),
    updated: int("updated").notNull().default(0),
    promoted: int("promoted").notNull().default(0),
    expired: int("expired").notNull().default(0),
    skippedDupes: int("skipped_dupes").notNull().default(0),
    balancesRecorded: int("balances_recorded").notNull().default(0),
    error: text("error"),
    details: json("details"),
  },
  (t) => [index("idx_sr_started").on(t.startedAt)],
);

export type Period = typeof periods.$inferSelect;
export type Bill = typeof bills.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type BillInstance = typeof billInstances.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type CategoryMapping = typeof categoryMappings.$inferSelect;
export type BillStatusRow = typeof billStatuses.$inferSelect;
export type PaymentTypeRow = typeof paymentTypes.$inferSelect;
export type AccountBalance = typeof accountBalances.$inferSelect;
export type Debt = typeof debts.$inferSelect;
export type DebtBalance = typeof debtBalances.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type TransferDismissal = typeof transferDismissals.$inferSelect;
export type SuggestionDismissal = typeof suggestionDismissals.$inferSelect;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type GoalContribution = typeof goalContributions.$inferSelect;
export type CashAllocation = typeof cashAllocations.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type BudgetLine = typeof budgetLines.$inferSelect;
export type ProjectionSnapshot = typeof projectionSnapshots.$inferSelect;
export type SyncSettings = typeof syncSettings.$inferSelect;
export type SyncEnrollment = typeof syncEnrollments.$inferSelect;
export type SyncAccount = typeof syncAccounts.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type SyncIgnored = typeof syncIgnored.$inferSelect;

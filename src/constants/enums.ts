// Central enum/constant definitions. Stored as VARCHAR in the DB so new values can be
// added here without a migration. See planning/design/02-data-model.md.

export const BILL_STATUSES = [
  "Unpaid",
  "Optional",
  "Not Due Yet",
  "Past Due",
  "Debt",
  "Autopay",
  "Ready for Payment",
  "Pending",
  "Partial Payment",
  "Autopay Pending",
  "Declined",
  "Paid/Purchased",
  "Paid & Cancelled",
  "Suspended",
  "No Balance",
  "Skipped",
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

// Statuses that count as "settled" (no money still owed this month) for rollups.
export const SETTLED_STATUSES: readonly BillStatus[] = [
  "Autopay",
  "Paid/Purchased",
  "Paid & Cancelled",
  "No Balance",
  "Skipped",
  "Optional",
  "Suspended",
];

// Tailwind classes per status for badges.
export const STATUS_STYLES: Record<string, string> = {
  Unpaid: "bg-red-100 text-red-800 border-red-200",
  Optional: "bg-gray-100 text-gray-700 border-gray-200",
  "Not Due Yet": "bg-slate-100 text-slate-700 border-slate-200",
  "Past Due": "bg-red-200 text-red-900 border-red-300",
  Debt: "bg-orange-100 text-orange-800 border-orange-200",
  Autopay: "bg-blue-100 text-blue-800 border-blue-200",
  "Ready for Payment": "bg-amber-100 text-amber-800 border-amber-200",
  Pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Partial Payment": "bg-purple-100 text-purple-800 border-purple-200",
  "Autopay Pending": "bg-sky-100 text-sky-800 border-sky-200",
  Declined: "bg-rose-100 text-rose-800 border-rose-200",
  "Paid/Purchased": "bg-green-100 text-green-800 border-green-200",
  "Paid & Cancelled": "bg-emerald-100 text-emerald-800 border-emerald-200",
  Suspended: "bg-zinc-100 text-zinc-700 border-zinc-200",
  "No Balance": "bg-teal-100 text-teal-800 border-teal-200",
  Skipped: "bg-gray-100 text-gray-500 border-gray-200",
};

export const PAYMENT_TYPES = [
  "Payable By Credit",
  "ACH Payment",
  "Cashapp/Zelle",
  "Cash Only",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const TXN_DIRECTIONS = ["Debit", "Credit"] as const;
export type TxnDirection = (typeof TXN_DIRECTIONS)[number];

// Seed set of transaction categories. Extensible — new ones can be added freely.
export const TXN_CATEGORIES = [
  "Business",
  "Cash",
  "Debt Repayment",
  "Deposit",
  "Discretionary",
  "Essentials",
  "Essentials/Discretionary",
  "Fees",
  "Food/Groceries",
  "Interest",
  "Interest/Rewards",
  "Investing",
  "Rent",
  "Savings",
  "Temporary Debt",
  "Transfer",
  "Transportation",
  "Utilities",
] as const;
export type TxnCategory = (typeof TXN_CATEGORIES)[number];

// ---- Cash offsets ------------------------------------------------------------------------
// A "cash source" is the bank row that put cash in your pocket — an ATM withdrawal, an Apple
// Cash load, a Zelle to yourself. They're identified by category, not description, because the
// descriptions vary wildly ("ATM Withdrawal - CVS…", "Digital Card Purchase - APPLE CASH…").
// Categorize a row as Cash and it becomes offsettable. See planning/features/cash-offsets.md.
export const CASH_SOURCE_CATEGORY = "Cash";

export const DEFAULT_NEW_MONTH_STATUS: BillStatus = "Not Due Yet";

// Default seed values for the customizable bill_statuses / payment_types tables.
// These are also the in-app fallback when the lookup tables are empty.
export interface StatusDefault {
  name: string;
  color: string;
  isSettled: boolean;
  emoji?: string;
}
export const STATUS_DEFAULTS: StatusDefault[] = [
  { name: "Unpaid", color: "#ef4444", isSettled: false, emoji: "💸" },
  { name: "Optional", color: "#9ca3af", isSettled: true, emoji: "🤷" },
  { name: "Not Due Yet", color: "#64748b", isSettled: false, emoji: "🕓" },
  { name: "Past Due", color: "#b91c1c", isSettled: false, emoji: "⏰" },
  { name: "Debt", color: "#f97316", isSettled: false, emoji: "💳" },
  { name: "Autopay", color: "#3b82f6", isSettled: true, emoji: "🔄" },
  { name: "Ready for Payment", color: "#f59e0b", isSettled: false, emoji: "📤" },
  { name: "Pending", color: "#eab308", isSettled: false, emoji: "⏳" },
  { name: "Partial Payment", color: "#a855f7", isSettled: false, emoji: "🪙" },
  { name: "Autopay Pending", color: "#0ea5e9", isSettled: false, emoji: "🔁" },
  { name: "Declined", color: "#f43f5e", isSettled: false, emoji: "❌" },
  { name: "Paid/Purchased", color: "#22c55e", isSettled: true, emoji: "✅" },
  { name: "Paid & Cancelled", color: "#10b981", isSettled: true, emoji: "🧾" },
  { name: "Suspended", color: "#71717a", isSettled: true, emoji: "⏸️" },
  { name: "No Balance", color: "#14b8a6", isSettled: true, emoji: "🆓" },
  { name: "Skipped", color: "#d4d4d8", isSettled: true, emoji: "⏭️" },
];

export const PAYMENT_TYPE_DEFAULTS: { name: string; color: string; emoji?: string }[] = [
  { name: "Payable By Credit", color: "#8b5cf6", emoji: "💳" },
  { name: "ACH Payment", color: "#0ea5e9", emoji: "🏦" },
  { name: "Cashapp/Zelle", color: "#22c55e", emoji: "📱" },
  { name: "Cash Only", color: "#f59e0b", emoji: "💵" },
];

// Default colors + emoji for the seed transaction categories (managed in Settings afterward).
export const CATEGORY_DEFAULTS: { name: string; color: string; emoji?: string }[] = [
  { name: "Business", color: "#6366f1", emoji: "💼" },
  { name: "Cash", color: "#84cc16", emoji: "💵" },
  { name: "Debt Repayment", color: "#f97316", emoji: "💳" },
  { name: "Deposit", color: "#22c55e", emoji: "💰" },
  { name: "Discretionary", color: "#a855f7", emoji: "🛍️" },
  { name: "Essentials", color: "#0ea5e9", emoji: "🧺" },
  { name: "Essentials/Discretionary", color: "#14b8a6", emoji: "🛒" },
  { name: "Fees", color: "#ef4444", emoji: "🧾" },
  { name: "Food/Groceries", color: "#f59e0b", emoji: "🍔" },
  { name: "Interest", color: "#eab308", emoji: "📈" },
  { name: "Interest/Rewards", color: "#10b981", emoji: "🎁" },
  { name: "Investing", color: "#3b82f6", emoji: "📊" },
  { name: "Rent", color: "#8b5cf6", emoji: "🏠" },
  { name: "Savings", color: "#4dff79", emoji: "💴" },
  { name: "Temporary Debt", color: "#fb7185", emoji: "⌛" },
  { name: "Transfer", color: "#64748b", emoji: "🔁" },
  { name: "Transportation", color: "#06b6d4", emoji: "🚗" },
  { name: "Utilities", color: "#d946ef", emoji: "⚡" },
];

// ---- Savings goals ----------------------------------------------------------------------
// Stored as VARCHAR on savings_goals so new kinds/states can be added here without a migration.
export const GOAL_TYPES = ["savings", "purchase", "debt_payoff", "custom"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

// Display metadata per goal type (label + default emoji/color used when the user hasn't picked one).
export const GOAL_TYPE_META: Record<GoalType, { label: string; emoji: string; color: string }> = {
  savings: { label: "Savings", emoji: "🐖", color: "#10b981" },
  purchase: { label: "Future purchase", emoji: "🛒", color: "#3b82f6" },
  debt_payoff: { label: "Debt payoff", emoji: "💳", color: "#f97316" },
  custom: { label: "Custom", emoji: "🎯", color: "#8b5cf6" },
};

export const GOAL_STATUSES = ["active", "achieved", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

// ---- Pay schedule ------------------------------------------------------------------------
// Stored as VARCHAR on pay_schedule so a new cadence can be added here without a migration.
// "semimonthly" = twice a month on fixed dates (e.g. the 7th & 22nd) — distinct from
// "biweekly", which is every 14 days and drifts across the calendar.
export const PAY_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

// Display metadata per cadence. `usesDays` picks which setup fields the settings form shows:
// date-driven schedules ask for day-of-month, cadence-driven ones ask for an anchor payday.
export const PAY_FREQUENCY_META: Record<
  PayFrequency,
  { label: string; blurb: string; usesDays: boolean; emoji: string }
> = {
  weekly: {
    label: "Weekly",
    blurb: "Every 7 days, counted off a payday you pick.",
    usesDays: false,
    emoji: "📅",
  },
  biweekly: {
    label: "Every 2 weeks",
    blurb: "Every 14 days — the date drifts through the month.",
    usesDays: false,
    emoji: "🗓️",
  },
  semimonthly: {
    label: "Twice a month",
    blurb: "Two fixed dates each month, like the 7th and the 22nd.",
    usesDays: true,
    emoji: "💵",
  },
  monthly: {
    label: "Monthly",
    blurb: "One fixed date each month.",
    usesDays: true,
    emoji: "🏦",
  },
};

export const ACCOUNT_TYPES = ["Checking", "Savings", "Cash", "Credit", "Loan", "Other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const CASH_ACCOUNT_TYPES: readonly string[] = ["Checking", "Savings", "Cash"];
// A physical-cash wallet (the "9999 Cash" account): no bank feed, every row is hand-entered,
// and its spending is funded by withdrawals from the accounts above. Being a TYPE rather than a
// hardcoded account number means a second wallet (Apple Cash, a spouse's cash) just works.
// See CASH_SOURCE_CATEGORY and planning/features/cash-offsets.md.
export const WALLET_ACCOUNT_TYPES: readonly string[] = ["Cash"];
// Account types that carry a balance owed (tracked over time) — the "Debts" screen is a lens
// over exactly these. Credit additionally has a credit limit → utilization; Loan does not.
export const CREDIT_ACCOUNT_TYPES: readonly string[] = ["Credit"];
export const LIABILITY_ACCOUNT_TYPES: readonly string[] = ["Credit", "Loan"];

// ---- Budgets ------------------------------------------------------------------------------
// A budget "mode" is the generator that fills in the month's plan. Stored as VARCHAR on
// budgets.mode so a new mode is a new entry here, no migration. See planning/features/budget.md.
export const BUDGET_MODES = ["debt_snowball", "carry_forward", "manual"] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

export const BUDGET_MODE_META: Record<
  BudgetMode,
  { label: string; blurb: string; emoji: string }
> = {
  debt_snowball: {
    label: "Debt snowball",
    blurb:
      "Minimums on every debt, your usual spending on everything else, and whatever's left piles onto one debt until it's gone — then rolls to the next.",
    emoji: "⛄",
  },
  carry_forward: {
    label: "Copy last month",
    blurb: "Start from the previous month's plan — same lines, same amounts, same target — then adjust.",
    emoji: "📋",
  },
  manual: {
    label: "Blank",
    blurb: "Start from nothing and add lines yourself.",
    emoji: "📝",
  },
};

// How the snowball orders debts. "snowball" is the classic smallest-balance-first (quick wins);
// "avalanche" is highest-APR-first (least interest). Same machinery, different sort key.
export const DEBT_STRATEGIES = ["snowball", "avalanche"] as const;
export type DebtStrategy = (typeof DEBT_STRATEGIES)[number];
export const DEBT_STRATEGY_META: Record<DebtStrategy, { label: string; blurb: string }> = {
  snowball: { label: "Smallest balance first", blurb: "Quick wins — knock out the small ones and roll their payments forward." },
  avalanche: { label: "Highest APR first", blurb: "Least interest paid overall." },
};

// `savings` is money deliberately NOT spent this month. It's a budget line so it competes for the
// pie like everything else, but it is never a cash outflow: cash on hand (checking + savings +
// pocket) doesn't drop when you move money to savings. Its reality check is whether cash on hand
// actually grew by that much.
export const BUDGET_LINE_KINDS = ["category", "debt", "savings"] as const;
export type BudgetLineKind = (typeof BUDGET_LINE_KINDS)[number];

// The system category a savings line measures (rarely carries transactions — a transfer to
// savings is usually categorized Transfer). Seeded as a default so it always exists.
export const SAVINGS_CATEGORY = "Savings";

// Categories a snowball plan never turns into a spending line: they're income, internal moves,
// bank-side noise, or money the debt lines already account for.
export const BUDGET_EXCLUDED_CATEGORIES: readonly string[] = [
  "Deposit",
  "Transfer",
  "Debt Repayment",
  "Interest",
  "Interest/Rewards",
  "Investing",
  "Savings", // its own line kind, never an everyday-spending line
];

// The snowball only chases debt that's actually costing something. Anything at or under this APR
// (the student loan at ~4%) stays in the budget at its minimum, never receives the extra, and is
// left out of the payoff projection — "debt-free" in this app means "high-interest debt-free".
export const SNOWBALL_MIN_APR = 10;

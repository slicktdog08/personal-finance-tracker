import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fail, money0, ok } from "./result";
import { bulkSetCategory } from "@/server/actions/categorize";
import { bulkSetStatus } from "@/server/actions/bills";
import { addContribution } from "@/server/actions/goals";
import { setBudgetTarget, updateBudgetLine } from "@/server/actions/budget";
import { createTransaction } from "@/server/actions/transactions";
import { setTransactionSplits } from "@/server/actions/splits";
import { addAccountBalance } from "@/server/actions/accounts";
import {
  getAccounts,
  getBudgetView,
  getCategoryOptionsRich,
  getGoalsWithProgress,
  getStatusConfig,
  getTransactionsPage,
} from "@/server/queries";
import { db } from "@/server/db";
import { billInstances, budgetLines, transactions } from "@/server/db/schema";
import { eq, inArray } from "drizzle-orm";
import { todayIso } from "@/server/lib/pay-schedule";
import { toNum } from "@/server/lib/money";

// Every write here is additive or a status/label flip the UI can undo. Deletes, imports,
// merges and rule edits stay in the app on purpose — an advisor should never be one
// misread sentence away from destroying data.
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO date YYYY-MM-DD.");

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    "set_transaction_category",
    {
      title: "Categorize transactions",
      description:
        "Assign a category to one or more transactions (clears any auto-rule stamp — this is a manual override). Category must be an active name from `list_categories`. Returns before/after so the change can be confirmed. Ask the user before calling.",
      inputSchema: z.object({
        transactionIds: z.array(z.number().int()).min(1).max(100),
        category: z.string().min(1),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ transactionIds, category }) => {
      const categories = await getCategoryOptionsRich();
      const match = categories.find((c) => c.name.toLowerCase() === category.toLowerCase());
      if (!match) return fail(`Unknown category "${category}".`, { known: categories.filter((c) => c.active).map((c) => c.name) });
      if (!match.active) return fail(`Category "${match.name}" is disabled in Settings.`);

      const before = await db
        .select({ id: transactions.id, description: transactions.description, category: transactions.category })
        .from(transactions)
        .where(inArray(transactions.id, transactionIds));
      const missing = transactionIds.filter((id) => !before.some((b) => b.id === id));
      if (missing.length) return fail(`No transaction with id ${missing.join(", ")}.`);

      const changed = await bulkSetCategory(transactionIds, match.name);
      return ok({
        changed,
        category: match.name,
        transactions: before.map((b) => ({ transactionId: b.id, description: b.description, previousCategory: b.category })),
      });
    },
  );

  server.registerTool(
    "split_transaction",
    {
      title: "Split a transaction across categories",
      description:
        "File parts of one transaction under other categories (e.g. $40 of a $100 Target run as Household). `parts` are carved off; the transaction's own category keeps the rest, so the parts must add up to LESS than the amount. Replaces any existing split; an empty `parts` removes it. Categories must be active names from `list_categories`. Not for cash withdrawals — those are explained by offsetting purchases. Ask the user before calling.",
      inputSchema: z.object({
        transactionId: z.number().int(),
        parts: z
          .array(z.object({ category: z.string().min(1), amount: z.number().positive() }))
          .max(20),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ transactionId, parts }) => {
      const categories = await getCategoryOptionsRich();
      const resolved: { category: string; amount: number }[] = [];
      for (const p of parts) {
        const match = categories.find((c) => c.name.toLowerCase() === p.category.toLowerCase());
        if (!match) return fail(`Unknown category "${p.category}".`, { known: categories.filter((c) => c.active).map((c) => c.name) });
        if (!match.active) return fail(`Category "${match.name}" is disabled in Settings.`);
        resolved.push({ category: match.name, amount: p.amount });
      }
      const [txn] = await db
        .select({ id: transactions.id, description: transactions.description, amount: transactions.amount, category: transactions.category })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
      if (!txn) return fail(`No transaction with id ${transactionId}.`);

      const res = await setTransactionSplits(transactionId, resolved, { path: "/transactions" });
      if (!res.ok) return fail(res.error);
      const splitTotal = resolved.reduce((s, p) => s + p.amount, 0);
      return ok({
        transactionId,
        description: txn.description,
        amount: money0(txn.amount),
        stays: { category: txn.category, amount: money0((toNum(txn.amount) ?? 0) - splitTotal) },
        parts: resolved.map((p) => ({ category: p.category, amount: money0(p.amount) })),
      });
    },
  );

  server.registerTool(
    "set_bill_status",
    {
      title: "Set bill status",
      description:
        "Change the status of one or more bill instances for a month (e.g. mark 'Paid/Purchased', 'Autopay', 'Skipped'). Status must be a configured name — `list_bills` returns them with whether each counts as settled. Ask the user before calling.",
      inputSchema: z.object({
        instanceIds: z.array(z.number().int()).min(1).max(50),
        status: z.string().min(1),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ instanceIds, status }) => {
      const statuses = await getStatusConfig();
      const match = statuses.find((s) => s.name.toLowerCase() === status.toLowerCase());
      if (!match) return fail(`Unknown status "${status}".`, { known: statuses.map((s) => s.name) });

      const before = await db
        .select({ id: billInstances.id, name: billInstances.name, amount: billInstances.amount, status: billInstances.status })
        .from(billInstances)
        .where(inArray(billInstances.id, instanceIds));
      const missing = instanceIds.filter((id) => !before.some((b) => b.id === id));
      if (missing.length) return fail(`No bill instance with id ${missing.join(", ")}.`);

      const changed = await bulkSetStatus(instanceIds, match.name, "/settings/bills");
      return ok({
        changed,
        status: match.name,
        settled: match.isSettled,
        bills: before.map((b) => ({ instanceId: b.id, name: b.name, amount: money0(b.amount), previousStatus: b.status })),
      });
    },
  );

  server.registerTool(
    "add_goal_contribution",
    {
      title: "Add goal contribution",
      description:
        "Record money set aside toward a savings goal (a ledger entry — it does not move real money). Use a negative amount to record a withdrawal from the goal. Ask the user before calling.",
      inputSchema: z.object({
        goalId: z.number().int(),
        amount: z.number().refine((n) => n !== 0, "Amount can't be zero."),
        date: isoDate.optional().describe("Defaults to today."),
        note: z.string().max(255).optional(),
      }),
      annotations: WRITE,
    },
    async ({ goalId, amount, date, note }) => {
      const goals = await getGoalsWithProgress();
      const goal = goals.find((g) => g.id === goalId);
      if (!goal) return fail(`No goal with id ${goalId}.`, { known: goals.map((g) => ({ goalId: g.id, name: g.name })) });
      await addContribution(goalId, amount, date ?? todayIso(), note ?? null);
      const after = (await getGoalsWithProgress()).find((g) => g.id === goalId);
      return ok({
        goal: goal.name,
        contribution: money0(amount),
        fundedBefore: money0(goal.funded),
        fundedAfter: money0(after?.funded ?? goal.funded + amount),
        target: money0(goal.targetAmount),
      });
    },
  );

  server.registerTool(
    "update_budget_line",
    {
      title: "Update budget line",
      description:
        "Change the planned amount (and/or notes) on one budget line. Line ids come from `get_budget`. If the budget has auto-rebalance on, the app may redistribute other lines. Ask the user before calling.",
      inputSchema: z.object({
        lineId: z.number().int(),
        planned: z.number().min(0).optional(),
        notes: z.string().max(500).nullable().optional(),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ lineId, planned, notes }) => {
      if (planned === undefined && notes === undefined) return fail("Nothing to change: pass `planned` and/or `notes`.");
      const [before] = await db
        .select({ id: budgetLines.id, label: budgetLines.label, planned: budgetLines.planned, budgetId: budgetLines.budgetId })
        .from(budgetLines)
        .where(eq(budgetLines.id, lineId))
        .limit(1);
      if (!before) return fail(`No budget line with id ${lineId}.`);
      const res = await updateBudgetLine(lineId, { planned, notes });
      if (!res.ok) return fail(res.error ?? "Update rejected.");
      return ok({ lineId, label: before.label, plannedBefore: money0(before.planned), plannedAfter: planned ?? money0(before.planned) });
    },
  );

  server.registerTool(
    "set_debt_target",
    {
      title: "Set debt payoff target",
      description:
        "Make one debt line the budget's target — the debt that receives every dollar beyond the minimums (the snowball/avalanche focus). Only a `kind: \"debt\"` line qualifies. Ask the user before calling.",
      inputSchema: z.object({
        period: z.string().regex(/^\d{4}-\d{1,2}$/).describe("Budget month YYYY-MM."),
        lineId: z.number().int(),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ period, lineId }) => {
      const view = await getBudgetView(period);
      if (!view) return fail(`No budget for ${period}.`);
      const line = view.lines.find((l) => l.id === lineId);
      if (!line) return fail(`Budget ${period} has no line ${lineId}.`, { debtLines: view.lines.filter((l) => l.kind === "debt").map((l) => ({ lineId: l.id, label: l.label })) });
      const res = await setBudgetTarget(view.id, lineId);
      if (!res.ok) return fail(res.error ?? "Update rejected.");
      return ok({ period, target: line.label, previousTarget: view.lines.find((l) => l.isTarget)?.label ?? null });
    },
  );

  server.registerTool(
    "create_transaction",
    {
      title: "Record a transaction",
      description:
        "Add a manual transaction (cash purchase, something a statement missed). Debit = money out, Credit = money in. `accountNumber` is the masked number from `list_accounts`; with `adjustBalance` the account's running balance moves too. Exact duplicates (same account/date/amount/description) are ignored. Ask the user before calling.",
      inputSchema: z.object({
        date: isoDate,
        description: z.string().min(1).max(512),
        amount: z.number().positive().describe("Magnitude in dollars; sign comes from `direction`."),
        direction: z.enum(["Debit", "Credit"]),
        accountNumber: z.string().optional(),
        category: z.string().optional(),
        notes: z.string().max(1000).optional(),
        pending: z
          .boolean()
          .default(false)
          .describe("Not posted by the bank yet (card hold, tip still settling). The next statement import offers to merge the posted row into it instead of duplicating it."),
        adjustBalance: z.boolean().default(false),
      }),
      annotations: WRITE,
    },
    async (input) => {
      if (input.accountNumber) {
        const accounts = await getAccounts();
        if (!accounts.some((a) => a.accountNumber === input.accountNumber))
          return fail(`No account with number "${input.accountNumber}".`, { known: accounts.map((a) => ({ accountNumber: a.accountNumber, label: a.label })) });
      }
      if (input.category) {
        const categories = await getCategoryOptionsRich();
        const match = categories.find((c) => c.name.toLowerCase() === input.category!.toLowerCase());
        if (!match || !match.active) return fail(`Unknown or disabled category "${input.category}".`);
        input.category = match.name;
      }
      await createTransaction(
        null,
        {
          txnDate: input.date,
          description: input.description,
          amount: input.amount,
          direction: input.direction,
          accountNumber: input.accountNumber ?? null,
          category: input.category ?? null,
          notes: input.notes ?? null,
          pending: input.pending,
          adjustBalance: input.adjustBalance,
        },
        "/transactions",
      );
      // The insert is an upsert keyed by a dedup hash, so read the row back rather than
      // guessing whether it was new.
      const page = await getTransactionsPage({ search: input.description, periodLabels: [input.date.slice(0, 7)], pageSize: 5 });
      const row = page.rows.find((r) => r.txnDate === input.date && toNum(r.amount) === input.amount && r.direction === input.direction);
      return ok({
        recorded: true,
        transactionId: row?.id ?? null,
        date: input.date,
        description: input.description,
        amount: money0(input.amount),
        direction: input.direction,
        category: input.category ?? null,
        account: input.accountNumber ?? null,
      });
    },
  );

  server.registerTool(
    "record_account_balance",
    {
      title: "Record account balance",
      description:
        "Add a dated balance snapshot for an account (cash: balance on hand; credit/loan: balance OWED, optionally with credit limit, APR and minimum payment). Snapshots are append-only history; the newest one on or before a date is what every report uses. Ask the user before calling.",
      inputSchema: z.object({
        accountId: z.number().int(),
        balance: z.number().min(0),
        asOf: isoDate.optional().describe("Defaults to today."),
        note: z.string().max(255).optional(),
        creditLimit: z.number().min(0).optional(),
        apr: z.number().min(0).max(100).optional().describe("Percent, e.g. 29.99."),
        minPayment: z.number().min(0).optional(),
      }),
      annotations: WRITE,
    },
    async ({ accountId, balance, asOf, note, creditLimit, apr, minPayment }) => {
      const accounts = await getAccounts();
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return fail(`No account with id ${accountId}.`, { known: accounts.map((a) => ({ accountId: a.id, label: a.label, type: a.accountType })) });
      await addAccountBalance(accountId, balance, asOf ?? todayIso(), note ?? null, creditLimit ?? null, apr ?? null, minPayment ?? null);
      return ok({
        recorded: true,
        account: account.label ?? account.accountNumber,
        type: account.accountType,
        balance: money0(balance),
        asOf: asOf ?? todayIso(),
        creditLimit: creditLimit ?? null,
        apr: apr ?? null,
        minPayment: minPayment ?? null,
      });
    },
  );
}

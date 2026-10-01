import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getAdvisorProfile } from "./advisor-context";
import { currentPeriodLabel, fail, money, money0, ok, resolvePeriodLabel, trailingPeriodLabels } from "./result";
import {
  getAccounts,
  getBalanceTrends,
  getBudgetView,
  getCashHeld,
  getCashOnHand,
  getCashProjection,
  getCashflowByPeriod,
  getCategoryOptionsRich,
  getCategorySpend,
  getDailyCashOnHand,
  getDebtInputs,
  getGoalsWithProgress,
  getInstances,
  getLatestPeriod,
  getLiabilityAccounts,
  getPaySchedule,
  getPeriodByLabel,
  getStatusConfig,
  getTransactionsPage,
  getUncategorizedCount,
} from "@/server/queries";
import { monthlyInterest } from "@/server/lib/debt";
import { projectPayoff } from "@/server/lib/budget";
import { resolvePaydays, todayIso } from "@/server/lib/pay-schedule";
import { parsePeriodLabel } from "@/server/lib/period";
import { DEBT_STRATEGIES } from "@/constants/enums";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const periodArg = z
  .string()
  .regex(/^\d{4}-\d{1,2}$/)
  .optional()
  .describe("Month as YYYY-MM. Defaults to the current month.");

/** Bill instances for a month, decorated with whether the status means money has left. */
async function billsForPeriod(label: string) {
  const [period, statuses] = await Promise.all([getPeriodByLabel(label), getStatusConfig()]);
  if (!period) return null;
  const settled = new Map(statuses.map((s) => [s.name, s.isSettled]));
  const rows = await getInstances(period.id);
  return rows.map((b) => ({
    instanceId: b.id,
    billId: b.billId,
    name: b.name,
    amount: money(b.amount),
    dueDay: b.dueDay,
    status: b.status,
    settled: settled.get(b.status) ?? false,
    isDebt: b.isDebt,
    cancelled: b.isCancel,
    paymentType: b.paymentType,
  }));
}

export function registerReadTools(server: McpServer) {
  server.registerTool(
    "get_advisor_context",
    {
      title: "Advisor context",
      description:
        "Call this FIRST in any advisory conversation. Returns the standing financial plan (income, debt strategy, rent target, emergency fund rules), known data caveats, today's date and the latest tracked month. Static text — cheap to call.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const latest = await getLatestPeriod();
      return ok({
        today: todayIso(),
        currentPeriod: currentPeriodLabel(),
        latestTrackedPeriod: latest?.label ?? null,
        ...getAdvisorProfile(),
      });
    },
  );

  server.registerTool(
    "get_financial_snapshot",
    {
      title: "Financial snapshot",
      description:
        "One-call overview of where things stand right now: cash by account, pocket cash, every liability with balance/APR/minimum and this month's interest cost, unsettled bills for the current month, savings goals, next payday, and the uncategorized-transaction backlog. Use before answering any 'how am I doing' question.",
      inputSchema: z.object({ period: periodArg }),
      annotations: READ_ONLY,
    },
    async ({ period }) => {
      const label = resolvePeriodLabel(period);
      if (!label) return fail(`Invalid period "${period}". Use YYYY-MM.`);
      const today = todayIso();
      const [cash, pocket, liabilities, bills, goals, schedule, uncategorized] = await Promise.all([
        getCashOnHand(),
        getCashHeld(label),
        getLiabilityAccounts(),
        billsForPeriod(label),
        getGoalsWithProgress(),
        getPaySchedule(),
        getUncategorizedCount(),
      ]);

      const cashAccounts = cash.map((a) => ({
        accountId: a.id,
        label: a.label,
        accountNumber: a.accountNumber,
        type: a.accountType,
        balance: money(a.balance),
        asOf: a.asOf,
      }));
      const cashTotal = cashAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);

      const debts = liabilities
        .filter((l) => l.active)
        .map((l) => {
          const balance = money(l.balance);
          const apr = money(l.apr);
          return {
            accountId: l.id,
            label: l.label,
            institution: l.institution,
            type: l.accountType,
            balance,
            creditLimit: money(l.creditLimit),
            apr,
            minPayment: money(l.minPayment),
            monthlyInterest: money(monthlyInterest(balance, apr)),
            asOf: l.asOf,
            linkedBillId: l.billId,
          };
        });
      const debtTotal = debts.reduce((s, d) => s + (d.balance ?? 0), 0);
      const creditUsed = debts.filter((d) => d.type === "Credit").reduce((s, d) => s + (d.balance ?? 0), 0);
      const creditLimit = debts.filter((d) => d.type === "Credit").reduce((s, d) => s + (d.creditLimit ?? 0), 0);

      const unsettledBills = (bills ?? []).filter((b) => !b.settled && !b.cancelled);
      const paydays = schedule ? resolvePaydays(schedule, today) : null;

      return ok({
        today,
        period: label,
        cash: { accounts: cashAccounts, total: money0(cashTotal) },
        pocketCash: { held: money0(pocket.closing), countedOn: pocket.countedOn },
        liabilities: {
          accounts: debts,
          total: money0(debtTotal),
          monthlyInterest: money0(debts.reduce((s, d) => s + (d.monthlyInterest ?? 0), 0)),
          creditUtilization: creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 1000) / 10 : null,
        },
        netCashPosition: money0(cashTotal + pocket.closing - debtTotal),
        bills: bills
          ? {
              count: bills.length,
              unsettled: unsettledBills,
              unsettledTotal: money0(unsettledBills.reduce((s, b) => s + (b.amount ?? 0), 0)),
            }
          : { note: `No bills tracked for ${label} yet.` },
        goals: goals
          .filter((g) => g.status === "active")
          .map((g) => ({
            goalId: g.id,
            name: g.name,
            target: money0(g.targetAmount),
            funded: money0(g.funded),
            backedByAccount: money0(g.backed),
            shortfall: money0(g.shortfall),
            targetDate: g.targetDate,
          })),
        paySchedule: schedule
          ? { frequency: schedule.frequency, takeHomePerCheck: money(schedule.takeHome), nextPayday: paydays?.next ?? null }
          : null,
        uncategorizedTransactions: uncategorized,
      });
    },
  );

  server.registerTool(
    "get_period_summary",
    {
      title: "Month summary",
      description:
        "Income vs. spending for one month, spending by category, bills (planned / settled / outstanding) and the budget plan-vs-actual if a budget exists. The core tool for 'how did last month go' and 'where is my money going'. Cash withdrawals are reconciled so nothing is double counted.",
      inputSchema: z.object({ period: periodArg }),
      annotations: READ_ONLY,
    },
    async ({ period }) => {
      const label = resolvePeriodLabel(period);
      if (!label) return fail(`Invalid period "${period}". Use YYYY-MM.`);
      const [flows, categories, bills, budget] = await Promise.all([
        getCashflowByPeriod(),
        getCategorySpend(label),
        billsForPeriod(label),
        getBudgetView(label),
      ]);
      const month = flows.filter((f) => f.label === label);
      const income = money0(month.find((f) => f.direction === "Credit")?.total);
      const spending = money0(month.find((f) => f.direction === "Debit")?.total);
      const settledBills = (bills ?? []).filter((b) => b.settled && !b.cancelled);
      const openBills = (bills ?? []).filter((b) => !b.settled && !b.cancelled);

      return ok({
        period: label,
        cashflow: { income, spending, net: money0(income - spending) },
        spendingByCategory: categories.map((c) => ({ category: c.category ?? "Uncategorized", amount: money0(c.total) })),
        bills: bills
          ? {
              planned: money0((bills ?? []).filter((b) => !b.cancelled).reduce((s, b) => s + (b.amount ?? 0), 0)),
              settled: money0(settledBills.reduce((s, b) => s + (b.amount ?? 0), 0)),
              outstanding: openBills.map((b) => ({ instanceId: b.instanceId, name: b.name, amount: b.amount, dueDay: b.dueDay, status: b.status })),
            }
          : null,
        budget: budget
          ? {
              budgetId: budget.id,
              mode: budget.mode,
              strategy: budget.strategy,
              plannedIncome: money(budget.plannedIncome),
              actualIncome: money0(budget.actualIncome),
              lines: budget.lines.map((l) => ({
                lineId: l.id,
                kind: l.kind,
                label: l.label,
                category: l.category,
                accountId: l.accountId,
                planned: money0(l.planned),
                actual: money0(l.actual),
                remaining: money0(l.planned - l.actual),
                isTarget: l.isTarget,
              })),
              plannedTotal: money0(budget.lines.reduce((s, l) => s + l.planned, 0)),
              actualTotal: money0(budget.lines.reduce((s, l) => s + l.actual, 0)),
              cash: budget.cash,
            }
          : null,
      });
    },
  );

  server.registerTool(
    "get_spending_trends",
    {
      title: "Spending trends",
      description:
        "Income, spending and net for each of the last N months, plus a category × month matrix. Use to spot drift ('dining has doubled since June') and to estimate a realistic monthly burn. Remember months before ~2026-06 may be incomplete.",
      inputSchema: z.object({
        months: z.number().int().min(1).max(12).default(6).describe("How many months back from `endPeriod`."),
        endPeriod: periodArg,
      }),
      annotations: READ_ONLY,
    },
    async ({ months, endPeriod }) => {
      const end = resolvePeriodLabel(endPeriod);
      if (!end) return fail(`Invalid period "${endPeriod}". Use YYYY-MM.`);
      const labels = trailingPeriodLabels(end, months);
      const [flows, perMonth] = await Promise.all([
        getCashflowByPeriod(),
        Promise.all(labels.map((l) => getCategorySpend(l))),
      ]);
      const byLabel = new Map<string, { income: number; spending: number }>();
      for (const f of flows) {
        const row = byLabel.get(f.label) ?? { income: 0, spending: 0 };
        if (f.direction === "Credit") row.income = money0(f.total);
        else if (f.direction === "Debit") row.spending = money0(f.total);
        byLabel.set(f.label, row);
      }
      const categorySet = new Set<string>();
      perMonth.forEach((rows) => rows.forEach((r) => categorySet.add(r.category ?? "Uncategorized")));
      const matrix = [...categorySet].map((category) => ({
        category,
        byMonth: Object.fromEntries(
          labels.map((l, i) => [l, money0(perMonth[i].find((r) => (r.category ?? "Uncategorized") === category)?.total)]),
        ),
      }));
      matrix.sort((a, b) => Object.values(b.byMonth).reduce((s, v) => s + v, 0) - Object.values(a.byMonth).reduce((s, v) => s + v, 0));
      return ok({
        months: labels.map((l) => {
          const row = byLabel.get(l) ?? { income: 0, spending: 0 };
          return { period: l, income: row.income, spending: row.spending, net: money0(row.income - row.spending) };
        }),
        categories: matrix,
      });
    },
  );

  server.registerTool(
    "search_transactions",
    {
      title: "Search transactions",
      description:
        "Find transactions by text, month(s), category, account or direction. Returns the matching page plus totals over the WHOLE match (count, debits, credits). Use `list_accounts` / `list_categories` for valid ids and names. Keep pageSize modest; ask for a second page rather than dumping everything.",
      inputSchema: z.object({
        search: z.string().optional().describe("Substring match on description / notes."),
        periods: z.array(z.string().regex(/^\d{4}-\d{1,2}$/)).optional().describe("YYYY-MM labels to restrict to."),
        categories: z.array(z.string()).optional(),
        uncategorized: z.boolean().optional().describe("Only transactions with no category."),
        accountIds: z.array(z.number().int()).optional(),
        direction: z.enum(["Debit", "Credit"]).optional(),
        pending: z.boolean().optional().describe("Only charges not yet posted by the bank; omit for all."),
        sort: z.enum(["date", "amount", "description", "category", "account"]).default("date"),
        dir: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ_ONLY,
    },
    async (q) => {
      const periods = q.periods?.map((p) => resolvePeriodLabel(p));
      if (periods?.some((p) => !p)) return fail("One or more periods are invalid. Use YYYY-MM.");
      const res = await getTransactionsPage({
        search: q.search,
        periodLabels: periods as string[] | undefined,
        categories: q.categories,
        uncategorized: q.uncategorized,
        accountIds: q.accountIds,
        direction: q.direction,
        pending: q.pending,
        sort: q.sort,
        dir: q.dir,
        page: q.page,
        pageSize: q.pageSize,
      });
      return ok({
        total: res.total,
        page: res.page,
        pages: res.pages,
        totals: { debits: money0(res.sumDebit), credits: money0(res.sumCredit), net: money0(res.sumNet) },
        transactions: res.rows.map((t) => ({
          transactionId: t.id,
          date: t.txnDate,
          description: t.description,
          amount: money0(t.amount),
          direction: t.direction,
          category: t.category,
          notes: t.notes,
          account: t.accountLabel ?? t.accountNumber,
          accountId: t.accountId,
          period: t.periodLabel,
          billId: t.billId,
          // Parts filed under other categories; `category` holds whatever they don't claim.
          ...(t.splits.length
            ? { splits: t.splits.map((p) => ({ category: p.category, amount: money0(p.amount) })) }
            : {}),
          pending: t.pending,
        })),
      });
    },
  );

  server.registerTool(
    "list_bills",
    {
      title: "List bills",
      description:
        "Every bill instance for a month with amount, due day, status and whether that status counts as settled (money gone). Includes cancelled rows flagged `cancelled`. Use the `instanceId` with `set_bill_status`.",
      inputSchema: z.object({
        period: periodArg,
        onlyOutstanding: z.boolean().default(false).describe("Drop settled and cancelled bills."),
      }),
      annotations: READ_ONLY,
    },
    async ({ period, onlyOutstanding }) => {
      const label = resolvePeriodLabel(period);
      if (!label) return fail(`Invalid period "${period}". Use YYYY-MM.`);
      const [bills, statuses] = await Promise.all([billsForPeriod(label), getStatusConfig()]);
      if (!bills) return fail(`No month "${label}" exists yet.`);
      const rows = onlyOutstanding ? bills.filter((b) => !b.settled && !b.cancelled) : bills;
      return ok({
        period: label,
        statuses: statuses.map((s) => ({ name: s.name, settled: s.isSettled })),
        total: money0(rows.filter((b) => !b.cancelled).reduce((s, b) => s + (b.amount ?? 0), 0)),
        bills: rows,
      });
    },
  );

  server.registerTool(
    "get_debts",
    {
      title: "Debts and payoff projection",
      description:
        "Every liability (balance, APR, minimum, credit limit, monthly interest cost) plus a month-by-month payoff simulation. `monthlyBudget` is the TOTAL paid toward the high-interest debts each month (defaults to the sum of their minimums — pass more to model an aggressive plan). Debts at or under 10% APR ride at their minimum and are listed in `excluded`. Compare strategies by calling twice.",
      inputSchema: z.object({
        strategy: z.enum(DEBT_STRATEGIES).default("avalanche"),
        monthlyBudget: z.number().min(0).optional().describe("Total monthly payment across eligible debts. Default: sum of minimums."),
        startPeriod: periodArg,
      }),
      annotations: READ_ONLY,
    },
    async ({ strategy, monthlyBudget, startPeriod }) => {
      const label = resolvePeriodLabel(startPeriod);
      if (!label) return fail(`Invalid period "${startPeriod}". Use YYYY-MM.`);
      const { year, month } = parsePeriodLabel(label)!;
      const [liabilities, inputs] = await Promise.all([getLiabilityAccounts(), getDebtInputs()]);
      const minimums = inputs.reduce((s, d) => s + (d.minPayment ?? 0), 0);
      const budget = monthlyBudget ?? minimums;
      const projection = projectPayoff({
        debts: inputs,
        strategy,
        monthlyBudget: budget,
        startYear: year,
        startMonth: month,
        compareToMinimums: true,
      });
      return ok({
        debts: liabilities
          .filter((l) => l.active)
          .map((l) => ({
            accountId: l.id,
            label: l.label,
            institution: l.institution,
            type: l.accountType,
            balance: money(l.balance),
            apr: money(l.apr),
            minPayment: money(l.minPayment),
            creditLimit: money(l.creditLimit),
            originalPrincipal: money(l.originalPrincipal),
            monthlyInterest: money(monthlyInterest(money(l.balance), money(l.apr))),
            asOf: l.asOf,
            notes: l.notes,
          })),
        totals: {
          balance: money0(inputs.reduce((s, d) => s + d.balance, 0)),
          minimums: money0(minimums),
          monthlyInterest: money0(inputs.reduce((s, d) => s + (monthlyInterest(d.balance, d.apr) ?? 0), 0)),
        },
        projection: {
          strategy,
          monthlyBudget: money0(budget),
          months: projection.months,
          debtFreeOn: projection.debtFreeOn,
          totalInterest: money0(projection.totalInterest),
          stalls: projection.stalls,
          order: projection.steps.map((s) => ({
            accountId: s.accountId,
            label: s.label,
            paidOffOn: s.paidOffOn,
            monthsToPayoff: s.monthsToPayoff,
            interestPaid: money0(s.interestPaid),
          })),
          minimumsOnly: projection.minimumsOnly
            ? { months: projection.minimumsOnly.months, totalInterest: money0(projection.minimumsOnly.totalInterest), debtFreeOn: projection.minimumsOnly.debtFreeOn }
            : null,
          excludedLowApr: projection.excluded,
          aprThreshold: projection.minApr,
        },
      });
    },
  );

  server.registerTool(
    "get_cash_projection",
    {
      title: "Cash projection",
      description:
        "Day-by-day cash-on-hand forecast to month end from the month's budget: paydays in, bills and debt payments out, everyday spending spread across the remaining days. Returns the projected low point and end balance — the tool for 'can I afford X this month'. Needs a budget for the month; otherwise returns the recorded daily balances only.",
      inputSchema: z.object({ period: periodArg }),
      annotations: READ_ONLY,
    },
    async ({ period }) => {
      const label = resolvePeriodLabel(period);
      if (!label) return fail(`Invalid period "${period}". Use YYYY-MM.`);
      const [view, daily] = await Promise.all([getBudgetView(label), getDailyCashOnHand(label)]);
      const projection = view ? await getCashProjection(view) : null;
      const recorded = daily.filter((d) => d.recorded).map((d) => ({ date: d.date, cash: money0(d.total) }));
      if (!projection) {
        return ok({
          period: label,
          projection: null,
          note: view
            ? "A budget exists but no cash snapshot is recorded for the month, so nothing can be projected."
            : `No budget for ${label}. Create one in the app (/budget) to unlock projections.`,
          recordedDailyCash: recorded.slice(-31),
        });
      }
      return ok({
        period: label,
        projection: {
          asOf: projection.asOf,
          cashNow: money0(projection.start),
          cashMonthStart: money(projection.monthStart),
          projectedEnd: money0(projection.endBalance),
          lowPoint: { date: projection.low.date, cash: money0(projection.low.balance) },
          // Every cash figure above INCLUDES money reserved by savings goals (an emergency fund).
          // These are the same landmarks with it taken out — the ones to advise against.
          spendable: {
            reserved: money0(projection.spendable.reserved),
            now: money0(projection.spendable.now),
            end: money0(projection.spendable.end),
            atLowPoint: money0(projection.spendable.low.balance),
          },
          totals: {
            inflow: money0(projection.totals.inflow),
            bills: money0(projection.totals.bills),
            debt: money0(projection.totals.debt),
            spending: money0(projection.totals.spending),
          },
          everydaySpendPerDay: money0(projection.spreadDaily),
          savingsPlanned: money0(projection.savingsPlanned),
          // Why the projected inflow is what it is. A payday whose `arrived` already covers
          // `expected` adds nothing further — the money is inside cashNow. An incomplete one whose
          // date has passed means a deposit the payroll matcher didn't recognise, not missing money.
          paydays: projection.paydays.map((m) => ({
            date: m.date,
            expected: money0(m.expected),
            arrived: money0(m.arrived),
            stillComing: money0(m.residual),
            deposits: m.deposits.length,
          })),
          // Credits in the month that matched no payday — income the plan didn't anticipate.
          unexpectedIncome: money0(projection.months[projection.focusIndex]?.unexpectedIncome ?? 0),
          // How today's projection compares with what earlier days said it would be.
          forecastHistory: (projection.trend?.series ?? []).map((s) => ({ takenOn: s.takenOn, projectedEnd: money0(s.endBalance) })),
          upcomingEvents: projection.events.map((e) => ({ date: e.date, kind: e.kind, label: e.label, amount: money0(e.amount) })),
          debt: {
            highInterestNow: money0(projection.debt.hotNow),
            highInterestEnd: money0(projection.debt.hotEnd),
            allNow: money0(projection.debt.allNow),
            allEnd: money0(projection.debt.allEnd),
            monthInterest: money0(projection.debt.interest),
            plannedPayments: money0(projection.debt.payments),
          },
        },
        recordedDailyCash: recorded.slice(-31),
      });
    },
  );

  server.registerTool(
    "get_goals",
    {
      title: "Savings goals",
      description:
        "Savings goals with target, amount contributed, and the reality check: how much of the contributed total the funding account actually still holds (`backed`) and any `shortfall`. Includes contribution counts and status.",
      inputSchema: z.object({ includeInactive: z.boolean().default(false) }),
      annotations: READ_ONLY,
    },
    async ({ includeInactive }) => {
      const goals = await getGoalsWithProgress();
      return ok({
        goals: goals
          .filter((g) => includeInactive || g.status === "active")
          .map((g) => ({
            goalId: g.id,
            name: g.name,
            type: g.goalType,
            status: g.status,
            target: money0(g.targetAmount),
            targetDate: g.targetDate,
            funded: money0(g.funded),
            remaining: money0(g.targetAmount - g.funded),
            contributions: g.contributionCount,
            fundingAccount: g.fundingAccountLabel ?? g.fundingAccountNumber,
            fundingAccountId: g.fundingAccountId,
            fundingAccountBalance: money(g.accountBalance),
            backed: money0(g.backed),
            shortfall: money0(g.shortfall),
            notes: g.notes,
          })),
      });
    },
  );

  server.registerTool(
    "get_budget",
    {
      title: "Budget for a month",
      description:
        "The month's budget plan with every line's planned vs. actual, the debt target, planned vs. actual income, and cash at month start vs. now. Returns null when the month has no budget.",
      inputSchema: z.object({ period: periodArg }),
      annotations: READ_ONLY,
    },
    async ({ period }) => {
      const label = resolvePeriodLabel(period);
      if (!label) return fail(`Invalid period "${period}". Use YYYY-MM.`);
      const budget = await getBudgetView(label);
      if (!budget) return ok({ period: label, budget: null, note: "No budget for this month." });
      return ok({
        period: label,
        budget: {
          budgetId: budget.id,
          mode: budget.mode,
          strategy: budget.strategy,
          autoRebalance: budget.autoRebalance,
          plannedIncome: money(budget.plannedIncome),
          actualIncome: money0(budget.actualIncome),
          cash: budget.cash,
          unassignedDebtPayments: money0(budget.unassignedDebtPayments),
          notes: budget.notes,
          lines: budget.lines.map((l) => ({
            lineId: l.id,
            kind: l.kind,
            label: l.label,
            category: l.category,
            accountId: l.accountId,
            planned: money0(l.planned),
            actual: money0(l.actual),
            remaining: money0(l.planned - l.actual),
            minimum: money(l.minimum),
            isTarget: l.isTarget,
            balance: money(l.balance),
            balanceStart: money(l.balanceStart),
            apr: money(l.apr),
            notes: l.notes,
          })),
        },
      });
    },
  );

  server.registerTool(
    "get_balance_trends",
    {
      title: "Balance trends",
      description:
        "Month-end cash on hand, credit-card debt and loan balances for every tracked month — the net-worth trajectory. Null means no snapshot existed by that month's end.",
      inputSchema: z.object({ months: z.number().int().min(1).max(36).default(12) }),
      annotations: READ_ONLY,
    },
    async ({ months }) => {
      const rows = await getBalanceTrends();
      return ok({
        trend: rows.slice(-months).map((r) => ({
          period: r.label,
          cash: money(r.cash),
          credit: money(r.credit),
          loans: money(r.loans),
          net: r.cash == null ? null : money0(r.cash - (r.credit ?? 0) - (r.loans ?? 0)),
        })),
      });
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description: "Every tracked account (cash and liability) with its id, masked number, label, institution and type. Use the ids/numbers with search and write tools.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const rows = await getAccounts();
      return ok({
        accounts: rows.map((a) => ({
          accountId: a.id,
          accountNumber: a.accountNumber,
          label: a.label,
          institution: a.institution,
          type: a.accountType,
          active: a.active,
          linkedBillId: a.billId,
        })),
      });
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description: "Transaction categories as configured in Settings. Only `active` ones may be assigned with `set_transaction_category`.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const rows = await getCategoryOptionsRich();
      return ok({ categories: rows.map((c) => ({ name: c.name, active: c.active })) });
    },
  );
}

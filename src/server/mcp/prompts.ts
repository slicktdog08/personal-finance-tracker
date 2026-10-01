import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// Prompts are the "advisor" playbooks: they tell Claude which tools to call, in what order,
// and how to frame the answer. claude.ai surfaces them as slash-style shortcuts.

const periodArg = z.string().regex(/^\d{4}-\d{1,2}$/).optional().describe("Month YYYY-MM (default: current).");

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "monthly_review",
    {
      title: "Monthly review",
      description: "A planner-style review of one month: what came in, what went out, how it compares to the plan and the trend, and the 2–3 moves for next month.",
      argsSchema: z.object({ period: periodArg }),
    },
    ({ period }) =>
      userPrompt(
        [
          `Run a monthly financial review${period ? ` for ${period}` : " for the most recent complete month"}.`,
          "Steps: call get_advisor_context, then get_period_summary for the month, get_spending_trends (6 months) for context, get_debts for the payoff picture, and get_financial_snapshot for where things stand today.",
          "Then write the review: (1) headline — income, spending, net, and whether the month beat or missed the plan; (2) the three biggest spending categories vs. their 6-month average, naming any drift; (3) debt progress — balance change, interest paid, projected payoff date; (4) bills still outstanding; (5) exactly 2–3 concrete actions for next month with dollar amounts.",
          "Flag any data that looks incomplete (a month with suspiciously low spending, uncategorized backlog) rather than building conclusions on it.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "can_i_afford",
    {
      title: "Can I afford…?",
      description: "Stress-test a purchase or recurring commitment against this month's cash projection, the emergency-fund rule and the debt plan.",
      argsSchema: z.object({
        item: z.string().describe("What the money is for."),
        amount: z.string().describe("Dollar amount (one-time) or monthly amount for a recurring cost."),
        recurring: z.string().optional().describe("'yes' if this is a monthly commitment like rent or a subscription."),
      }),
    },
    ({ item, amount, recurring }) =>
      userPrompt(
        [
          `Can I afford ${item} at $${amount}${recurring?.toLowerCase().startsWith("y") ? " per month" : " one-time"}?`,
          "Call get_advisor_context (for the emergency-fund and rent rules), get_financial_snapshot, get_cash_projection for the current month, and get_debts with the current plan.",
          "Answer with a clear yes / yes-with-conditions / not-yet, then show the math: projected cash low point with and without this cost, effect on the debt-free date (re-run get_debts with a reduced monthlyBudget if it displaces debt payments), and whether the emergency fund would be touched (it must not be).",
          "If recurring, model it against the ~$3,000/mo living-burn baseline and the rent target. Close with the cheaper alternative or the timing that would make it a yes.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "debt_payoff_plan",
    {
      title: "Debt payoff plan",
      description: "Rebuild the payoff plan from today's balances: avalanche vs. snowball, payoff dates, interest saved, and what each extra $100/mo buys.",
      argsSchema: z.object({
        extraMonthly: z.string().optional().describe("Dollars available beyond minimums each month. If omitted, derive it from income minus living burn and bills."),
      }),
    },
    ({ extraMonthly }) =>
      userPrompt(
        [
          "Build my debt payoff plan from current balances.",
          "Call get_advisor_context, get_financial_snapshot, then get_debts twice — strategy 'avalanche' and 'snowball' — with monthlyBudget = sum of minimums + " +
            (extraMonthly ? `$${extraMonthly}` : "the surplus you derive from take-home pay minus the living burn and the month's bills (show that derivation)") +
            ". Also run get_debts once at minimums only for the baseline.",
          "Present: the ordered list of debts with balance, APR and monthly interest; payoff date and total interest under each strategy vs. minimums; the recommended strategy with the reason; and a sensitivity line — what +$100/mo and +$250/mo would each do to the debt-free date.",
          "Remind me which debts to pay before their statement-closing date for the credit-score effect. Keep the student loan on minimum unless the numbers say otherwise.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "budget_check_in",
    {
      title: "Budget check-in",
      description: "Mid-month pulse: which budget lines are on pace, which are blowing up, and whether the month still ends where the plan said.",
      argsSchema: z.object({ period: periodArg }),
    },
    ({ period }) =>
      userPrompt(
        [
          `Give me a budget check-in${period ? ` for ${period}` : " for this month"}.`,
          "Call get_advisor_context, get_budget, get_cash_projection and list_bills (onlyOutstanding) for the month.",
          "For each budget line compare actual to the pro-rated plan for how far through the month we are; label each on-pace / watch / over. Then: bills still to go out, the projected month-end cash and low point, and whether the savings and debt-target lines will be met.",
          "End with the one adjustment that most improves the month-end outcome. If I agree to change a line, use update_budget_line — but only after I confirm.",
        ].join("\n"),
      ),
  );
}

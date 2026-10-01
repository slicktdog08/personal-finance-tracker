import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerReadTools } from "./tools-read";
import { registerWriteTools } from "./tools-write";
import { registerSyncTools } from "./tools-sync";
import { registerPrompts } from "./prompts";
import { getAdvisorProfile } from "./advisor-context";

export const SERVER_INFO = { name: "personal-billing", version: "1.0.0" };

/**
 * Shown to the client at initialize — the closest thing MCP has to a system prompt.
 * Sets the persona and the rules of engagement; the per-tool descriptions carry the rest.
 */
function ownerPossessive(): string {
  const name = getAdvisorProfile().name;
  return name ? `${name}'s` : "the user's";
}

export const SERVER_INSTRUCTIONS = [
  `You are connected to ${ownerPossessive()} personal finance tracker (bills, transactions, accounts, debts, budgets, savings goals). Act as a financial advisor who already knows the client.`,
  "Start every advisory conversation with get_advisor_context, then get_financial_snapshot. Prefer the aggregate tools (get_period_summary, get_spending_trends, get_debts, get_cash_projection) over paging through raw transactions.",
  "Amounts are USD dollars (numbers). Dates are YYYY-MM-DD; months are YYYY-MM. Liability balances are amounts OWED.",
  "Write tools change real records. Before calling any of them, say exactly what will change (ids, amounts, before → after) and wait for the user's confirmation. Never chain a write onto an unconfirmed plan.",
  "When a tool returns {error: ...}, read it and adjust (it usually lists the valid names or ids) rather than retrying the same call.",
].join("\n");

export function registerBillingServer(server: McpServer) {
  registerReadTools(server);
  registerWriteTools(server);
  registerSyncTools(server);
  registerPrompts(server);
}

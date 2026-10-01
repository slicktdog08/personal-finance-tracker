import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { toNum } from "@/server/lib/money";
import { todayIso } from "@/server/lib/pay-schedule";
import { parsePeriodLabel, periodLabel } from "@/server/lib/period";

/**
 * Tool results are JSON in a text block. Claude reads JSON reliably, and one shape for
 * every tool keeps the prompts simple. `structuredContent` is skipped on purpose — it
 * would double the payload against claude.ai's ~150k-character result cap.
 */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** A tool-level failure Claude should read and recover from (bad id, unknown category…). */
export function fail(message: string, extra?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }) }],
  };
}

/** DECIMAL strings → dollars as a number (2dp), null when unknown. */
export function money(v: string | number | null | undefined): number | null {
  const n = toNum(v);
  return n == null ? null : Math.round(n * 100) / 100;
}

export function money0(v: string | number | null | undefined): number {
  return money(v) ?? 0;
}

/** Current month as a period label (YYYY-MM). */
export function currentPeriodLabel(): string {
  const today = todayIso();
  return today.slice(0, 7);
}

/** Validates a YYYY-MM label, defaulting to the current month. */
export function resolvePeriodLabel(label?: string | null): string | null {
  if (!label) return currentPeriodLabel();
  const parsed = parsePeriodLabel(label);
  return parsed ? periodLabel(parsed.year, parsed.month) : null;
}

/** The N labels ending at (and including) `end`, oldest first. */
export function trailingPeriodLabels(end: string, count: number): string[] {
  const parsed = parsePeriodLabel(end);
  if (!parsed) return [];
  const out: string[] = [];
  let { year, month } = parsed;
  for (let i = 0; i < count; i++) {
    out.unshift(periodLabel(year, month));
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

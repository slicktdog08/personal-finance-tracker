// Registry of statement parsers. To add support for a new bank's PDF, write a parser
// (copy parsers/robinhood.ts) and add it to this list — nothing else changes.
import type { ParserResult, StatementParser } from "@/server/lib/pdf/types";
import { robinhoodParser } from "@/server/lib/pdf/parsers/robinhood";
import { capitalOneParser } from "@/server/lib/pdf/parsers/capitalone";

export const PARSERS: StatementParser[] = [robinhoodParser, capitalOneParser];

export interface DetectResult {
  parser: StatementParser | null;
  /** One entry per account the statement covers (usually one). Empty when unrecognized. */
  results: ParserResult[];
}

// Find the first parser that recognizes this statement and run it.
export function detectAndParse(lines: string[], text: string): DetectResult {
  const parser = PARSERS.find((p) => p.detect(text)) ?? null;
  if (!parser) return { parser: null, results: [] };
  const r = parser.parse(lines, text);
  return { parser, results: Array.isArray(r) ? r : [r] };
}

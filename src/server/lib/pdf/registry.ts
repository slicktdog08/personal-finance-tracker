// Registry of statement parsers. To add support for a new bank's PDF, write a parser
// (copy parsers/robinhood.ts) and add it to this list — nothing else changes.
import type { ParserResult, StatementParser } from "@/server/lib/pdf/types";
import type { PositionedItem } from "@/server/lib/pdf/lines";
import { robinhoodParser } from "@/server/lib/pdf/parsers/robinhood";
import { robinhoodCryptoParser } from "@/server/lib/pdf/parsers/robinhood-crypto";
import { robinhoodBrokerageParser } from "@/server/lib/pdf/parsers/robinhood-brokerage";
import { capitalOneParser } from "@/server/lib/pdf/parsers/capitalone";
import { capitalOneCardParser } from "@/server/lib/pdf/parsers/capitalone-card";
import { chaseCardParser } from "@/server/lib/pdf/parsers/chase-card";

// First match wins, so the narrow sniffs (a titled Spending / Crypto statement) come before
// the brokerage one, whose statement has no title of its own.
export const PARSERS: StatementParser[] = [
  robinhoodParser,
  robinhoodCryptoParser,
  robinhoodBrokerageParser,
  capitalOneParser,
  capitalOneCardParser,
  chaseCardParser,
];

export interface DetectResult {
  parser: StatementParser | null;
  /** One entry per account the statement covers (usually one). Empty when unrecognized. */
  results: ParserResult[];
}

// Find the first parser that recognizes this statement and run it.
export function detectAndParse(lines: string[], text: string, pages?: PositionedItem[][]): DetectResult {
  const parser = PARSERS.find((p) => p.detect(text)) ?? null;
  if (!parser) return { parser: null, results: [] };
  const r = parser.parse(lines, text, pages);
  return { parser, results: Array.isArray(r) ? r : [r] };
}

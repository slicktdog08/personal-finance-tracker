// Pure helpers that turn a statement's parsed trades and positions into rows for
// investment_trades / investment_positions. No DB access, so they are unit-testable.
import { createHash } from "crypto";
import type { ParsedPosition, ParsedTrade } from "@/server/lib/pdf/types";

const fixed = (n: number | null, places: number) => (n == null ? null : n.toFixed(places));

// A trade's identity: everything the statement prints about it, plus an occurrence index so two
// genuinely identical fills on one day both survive while a re-import of the statement is a no-op.
// Mirrors lib/dedup.ts, which does the same for transactions.
export function tradeHashes(trades: ParsedTrade[], accountNumber: string): string[] {
  const seen = new Map<string, number>();
  return trades.map((t) => {
    const base = [
      "trade",
      accountNumber.trim(),
      t.dateIso ?? "",
      t.action.trim().toUpperCase(),
      (t.symbol ?? "").toUpperCase(),
      t.name.trim().replace(/\s+/g, " ").toUpperCase(),
      fixed(t.quantity, 8) ?? "",
      fixed(t.price, 8) ?? "",
      fixed(t.amount, 2) ?? "",
      t.direction ?? "",
    ].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(n > 1 ? `${base}|#${n}` : base).digest("hex");
  });
}

/** Rows for investment_trades. Trades without a date can't be placed and are dropped. */
export function tradeRows(trades: ParsedTrade[], accountNumber: string, accountId: number) {
  const hashes = tradeHashes(trades, accountNumber);
  return trades.flatMap((t, i) =>
    t.dateIso
      ? [
          {
            accountId,
            tradeDate: t.dateIso,
            kind: t.kind,
            action: t.action.slice(0, 16),
            assetClass: t.assetClass,
            symbol: t.symbol ? t.symbol.slice(0, 32) : null,
            name: t.name.slice(0, 255),
            quantity: fixed(t.quantity, 8),
            price: fixed(t.price, 8),
            amount: fixed(t.amount, 2),
            direction: t.direction,
            dedupHash: hashes[i],
          },
        ]
      : [],
  );
}

/** Rows for investment_positions, all as of one date. */
export function positionRows(positions: ParsedPosition[], asOf: string, accountId: number) {
  return positions.map((p) => ({
    accountId,
    asOf,
    assetClass: p.assetClass,
    symbol: p.symbol ? p.symbol.slice(0, 32) : null,
    name: p.name.slice(0, 255),
    quantity: p.quantity.toFixed(8),
    price: fixed(p.price, 8),
    marketValue: fixed(p.marketValue, 2),
  }));
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchScore, pairPending, type MatchSide } from "@/server/lib/pending-match";

const side = (p: Partial<MatchSide> & Pick<MatchSide, "id" | "txnDate" | "amount" | "description">): MatchSide => ({
  accountNumber: "1234",
  direction: "Debit",
  ...p,
});

// The two false positives reported from the pending review: same card, a few dollars apart,
// but different merchants — and the "posted" row is dated BEFORE the pending one.
test("bank-synced pending rows don't pair with an unrelated merchant", () => {
  const heb = side({ id: 1, txnDate: "2026-10-07", amount: 24.87, description: "H-E-B #599", handEntered: false });
  const ojos = side({ id: 2, txnDate: "2026-10-05", amount: 29.33, description: "TST*OJOS LOCOS - SOUTHWE" });
  assert.equal(matchScore(heb, ojos), null);

  const link = side({ id: 3, txnDate: "2026-10-08", amount: 1.6, description: "LINK.COM* SIMPLEFIN BR", handEntered: false });
  const csc = side({ id: 4, txnDate: "2026-10-05", amount: 3.0, description: "CTLP*CSC SERVICEWORKS" });
  assert.equal(matchScore(link, csc), null);
});

test("the same two pairs are rejected even if the pending rows had been typed by hand", () => {
  // No shared words, so only a settle-shaped pair passes — and these posted before the entry.
  assert.equal(
    matchScore(
      side({ id: 1, txnDate: "2026-10-07", amount: 24.87, description: "H-E-B #599" }),
      side({ id: 2, txnDate: "2026-10-05", amount: 29.33, description: "TST*OJOS LOCOS - SOUTHWE" }),
    ),
    null,
  );
  assert.equal(
    matchScore(
      side({ id: 3, txnDate: "2026-10-08", amount: 1.6, description: "LINK.COM* SIMPLEFIN BR" }),
      side({ id: 4, txnDate: "2026-10-08", amount: 3.0, description: "CTLP*CSC SERVICEWORKS" }),
    ),
    null,
    "nearly doubling is not a tip",
  );
});

test("a bank-synced pending row still pairs with its posted twin (tip added, name kept)", () => {
  const pending = side({ id: 1, txnDate: "2026-10-05", amount: 24.87, description: "TST* OJOS LOCOS", handEntered: false });
  const posted = side({ id: 2, txnDate: "2026-10-07", amount: 29.33, description: "TST*OJOS LOCOS - SOUTHWE" });
  assert.ok((matchScore(pending, posted) ?? 0) > 0);
});

test("hand-typed rows still match the bank's wording", () => {
  // Shared word: the usual tolerance applies.
  assert.ok(
    (matchScore(
      side({ id: 1, txnDate: "2026-10-03", amount: 40, description: "Dinner at Joe's grill" }),
      side({ id: 2, txnDate: "2026-10-05", amount: 48, description: "SQ *JOES GRILL 8842" }),
    ) ?? 0) > 0,
  );
  // No shared words, but a coffee that settled next day with a $1 tip.
  assert.ok(
    (matchScore(
      side({ id: 3, txnDate: "2026-10-03", amount: 4, description: "Coffee" }),
      side({ id: 4, txnDate: "2026-10-04", amount: 5, description: "STARBUCKS 1123" }),
    ) ?? 0) > 0,
  );
  // No shared words but the exact amount: trusted even a couple of days early (typo'd date).
  assert.ok(
    (matchScore(
      side({ id: 5, txnDate: "2026-10-05", amount: 63.12, description: "Groceries" }),
      side({ id: 6, txnDate: "2026-10-03", amount: 63.12, description: "KROGER #331" }),
    ) ?? 0) > 0,
  );
});

test("a dismissed pair is never offered again, and the rows can pair elsewhere", () => {
  const pending = side({ id: 1, txnDate: "2026-10-03", amount: 40, description: "Dinner at Joe's grill" });
  const a = side({ id: 2, txnDate: "2026-10-04", amount: 40, description: "SQ *JOES GRILL" });
  const b = side({ id: 3, txnDate: "2026-10-06", amount: 46, description: "JOES GRILL TIP" });
  assert.equal(pairPending([pending], [a, b])[0].postedId, 2);
  assert.equal(pairPending([pending], [a, b], new Set(["1:2"]))[0].postedId, 3);
  assert.equal(pairPending([pending], [a], new Set(["1:2"])).length, 0);
});

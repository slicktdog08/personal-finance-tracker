import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spendingPower, type SpendingPowerCard } from "@/server/lib/spending-power";

const card = (id: number, balance: number | null, creditLimit: number | null, active = true): SpendingPowerCard => ({
  id,
  name: `Card ${String.fromCharCode(64 + id)}`,
  active,
  balance,
  creditLimit,
});

describe("spendingPower", () => {
  test("adds cash to the unused credit on each card", () => {
    const p = spendingPower(2000, [card(1, 400, 1000), card(2, 1500, 5000)]);
    assert.equal(p.creditAvailable, 4100);
    assert.equal(p.total, 6100);
    assert.deepEqual(p.cards.map((c) => c.available), [3500, 600]);
  });

  test("a card over its limit adds nothing rather than subtracting", () => {
    const p = spendingPower(500, [card(1, 1200, 1000), card(2, 0, 300)]);
    assert.equal(p.creditAvailable, 300);
    assert.equal(p.total, 800);
  });

  test("skips closed cards and counts open cards without a limit as missing", () => {
    const p = spendingPower(100, [card(1, 0, 2000, false), card(2, 50, null), card(3, null, 700)]);
    assert.equal(p.creditAvailable, 700);
    assert.equal(p.missingLimit, 1);
    assert.equal(p.cards.length, 1);
  });

  test("a credit balance (overpaid card) doesn't raise the room above the limit", () => {
    const p = spendingPower(0, [card(1, -50, 1000)]);
    assert.equal(p.creditAvailable, 1000);
  });
});

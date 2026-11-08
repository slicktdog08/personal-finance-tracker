import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitCardPayments } from "@/server/lib/debt";

describe("splitCardPayments", () => {
  test("payments only beyond the month's new charges count as payoff", () => {
    assert.deepEqual(splitCardPayments(1080, 300), { rebalance: 300, payoff: 780 });
  });
  test("paying back exactly what was charged pays nothing off", () => {
    assert.deepEqual(splitCardPayments(450.25, 450.25), { rebalance: 450.25, payoff: 0 });
  });
  test("charging more than was paid never goes negative", () => {
    assert.deepEqual(splitCardPayments(200, 500), { rebalance: 200, payoff: 0 });
  });
  test("no charges (or net refunds) leave the whole payment as payoff", () => {
    assert.deepEqual(splitCardPayments(500, 0), { rebalance: 0, payoff: 500 });
    assert.deepEqual(splitCardPayments(500, -40), { rebalance: 0, payoff: 500 });
  });
});

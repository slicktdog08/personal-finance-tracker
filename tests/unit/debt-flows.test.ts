import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeDebtFlows, type DebtFlowTxn } from "@/server/lib/debt-flows";

// Checking A = 1, Card A = 10 (bill 100), Loan B = 20 (bill 200).
const CHECKING = 1;
const CARD = 10;
const LOAN = 20;
const liabilities = [
  { id: CARD, billId: 100 },
  { id: LOAN, billId: 200 },
];

const t = (o: Partial<DebtFlowTxn> & Pick<DebtFlowTxn, "accountId" | "direction" | "amount">): DebtFlowTxn => ({
  period: "2026-03",
  category: null,
  billId: null,
  partnerAccountId: null,
  ...o,
});

const flow = (txns: DebtFlowTxn[]) => computeDebtFlows(txns, liabilities).get("2026-03")!;

describe("computeDebtFlows", () => {
  test("paying off this month's card purchases is a rebalance, not paydown", () => {
    // $2,000 lands in checking; $150 of groceries goes on Card A and checking pays it off.
    const f = flow([
      t({ accountId: CARD, direction: "Debit", amount: 150, category: "Food/Groceries" }),
      t({ accountId: CHECKING, direction: "Debit", amount: 150, category: "Debt Repayment", billId: 100 }),
      t({ accountId: CARD, direction: "Credit", amount: 150, category: "Transfer" }),
    ]);
    assert.deepEqual(f.accounts.get(CARD), { paid: 150, charged: 150, paydown: 0 });
    assert.equal(f.paydown, 0);
    // The checking debit is what a non-Transfer outgoing rollup counted — it gets backed out.
    assert.equal(f.countedPayments, 150);
    assert.equal(f.mirrorCredits, 0);
  });

  test("paying more than the new charges is paydown — the balance trend", () => {
    const f = flow([
      t({ accountId: CARD, direction: "Debit", amount: 150, category: "Gas" }),
      t({ accountId: CARD, direction: "Debit", amount: 20, category: "Interest" }),
      t({ accountId: CHECKING, direction: "Debit", amount: 500, category: "Debt Repayment", billId: 100 }),
    ]);
    // Interest raised the balance too, so it's a charge: 500 − 170 = 330 off the balance.
    assert.deepEqual(f.accounts.get(CARD), { paid: 500, charged: 170, paydown: 330 });
    assert.equal(f.paydown, 330);
  });

  test("charging more than was paid shows as negative paydown (the balance grew)", () => {
    const f = flow([
      t({ accountId: CARD, direction: "Debit", amount: 400, category: "Discretionary" }),
      t({ accountId: CHECKING, direction: "Debit", amount: 100, category: "Debt Repayment", billId: 100 }),
    ]);
    assert.equal(f.accounts.get(CARD)!.paydown, -300);
    assert.equal(f.paydown, -300);
  });

  test("refunds on the card lower the month's net charges", () => {
    const f = flow([
      t({ accountId: CARD, direction: "Debit", amount: 100, category: "Discretionary" }),
      t({ accountId: CARD, direction: "Credit", amount: 30, category: "Discretionary" }),
      t({ accountId: CHECKING, direction: "Debit", amount: 70, category: "Debt Repayment", billId: 100 }),
    ]);
    assert.deepEqual(f.accounts.get(CARD), { paid: 70, charged: 70, paydown: 0 });
  });

  test("a card-side payment credit filed as Debt Repayment is the mirror, not income or a refund", () => {
    const f = flow([
      t({ accountId: CHECKING, direction: "Debit", amount: 200, category: "Debt Repayment", billId: 100 }),
      t({ accountId: CARD, direction: "Credit", amount: 200, category: "Debt Repayment", billId: 100 }),
    ]);
    assert.deepEqual(f.accounts.get(CARD), { paid: 200, charged: 0, paydown: 200 });
    assert.equal(f.mirrorCredits, 200);
  });

  test("a payment filed as a linked Transfer still pays the card, but isn't backed out of outgoing", () => {
    const f = flow([
      t({ accountId: CARD, direction: "Debit", amount: 80, category: "Gas" }),
      t({ accountId: CHECKING, direction: "Debit", amount: 300, category: "Transfer", partnerAccountId: CARD }),
      t({ accountId: CARD, direction: "Credit", amount: 300, category: "Transfer", partnerAccountId: CHECKING }),
    ]);
    assert.deepEqual(f.accounts.get(CARD), { paid: 300, charged: 80, paydown: 220 });
    // Transfers were never in outgoing, so there's nothing to back out.
    assert.equal(f.countedPayments, 0);
    assert.equal(f.mirrorCredits, 0);
  });

  test("Debt Repayment no tracked debt claims counts as paydown in full", () => {
    const f = flow([
      t({ accountId: CHECKING, direction: "Debit", amount: 50, category: "Debt Repayment" }),
      t({ accountId: CHECKING, direction: "Debit", amount: 60, category: "Debt Repayment", billId: 999 }),
    ]);
    assert.equal(f.unattributed, 110);
    assert.equal(f.countedPayments, 110);
    assert.equal(f.paydown, 110);
  });

  test("a loan with no account-side rows: every payment is paydown", () => {
    const f = flow([t({ accountId: CHECKING, direction: "Debit", amount: 120, category: "Debt Repayment", billId: 200 })]);
    assert.deepEqual(f.accounts.get(LOAN), { paid: 120, charged: 0, paydown: 120 });
  });

  test("paying the loan WITH the card moves debt between them — net zero", () => {
    const f = flow([t({ accountId: CARD, direction: "Debit", amount: 120, category: "Debt Repayment", billId: 200 })]);
    assert.deepEqual(f.accounts.get(LOAN), { paid: 120, charged: 0, paydown: 120 });
    assert.deepEqual(f.accounts.get(CARD), { paid: 0, charged: 120, paydown: -120 });
    assert.equal(f.paydown, 0);
  });

  test("a card's own rows linked to its bill are charges, never payments to itself", () => {
    const f = flow([t({ accountId: CARD, direction: "Debit", amount: 25, category: "Fees", billId: 100 })]);
    assert.deepEqual(f.accounts.get(CARD), { paid: 0, charged: 25, paydown: -25 });
  });

  test("months are kept apart", () => {
    const flows = computeDebtFlows(
      [
        t({ accountId: CARD, direction: "Debit", amount: 90, category: "Gas", period: "2026-03" }),
        t({ accountId: CHECKING, direction: "Debit", amount: 90, category: "Debt Repayment", billId: 100, period: "2026-04" }),
      ],
      liabilities,
    );
    assert.equal(flows.get("2026-03")!.paydown, -90);
    assert.equal(flows.get("2026-04")!.paydown, 90);
  });
});

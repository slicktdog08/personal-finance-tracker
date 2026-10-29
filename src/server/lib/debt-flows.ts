// Pure debt-flow math: how much a month actually paid DOWN each debt, as opposed to how much
// it paid TO it. No DB — queries.ts feeds it rows, unit tests feed it fixtures.
//
// The pattern this exists for: pay lands in checking, a purchase goes on a card, and checking
// pays the card off a few days later. The purchase is already counted as spending (Groceries,
// Gas, …), so counting the card payment as outgoing too charges the same dollars twice — and
// filing all of it as "debt repayment" claims progress the balance never made. The payment
// that only covers this month's new charges is a REBALANCE, like a transfer. What's left over is
// real paydown, and it's what the balance trend shows:
//
//   paydown(card) = payments to it − new charges on it      (negative = the balance grew)
//   outgoing      = spending + Σ paydown                    (cash that actually left)
//
// So income − outgoing tracks the change in cash on hand, and income − spending is what the
// month really kept (paydown is saving, not spending).
//
// Classification, per row:
// - A Debit NOT on liability L that's linked to L's bill, or whose transfer partner sits on L,
//   is a payment to L — whatever its category (a payment filed as Transfer still moved cash).
// - Any other non-Transfer "Debt Repayment" Debit pays a debt the app can't attribute (a person,
//   an untracked loan, or a card payment nobody linked yet): all of it counts as paydown.
// - Every Debit ON L is a new charge — purchases, interest, fees, cash advances alike: each one
//   raised the balance.
// - A Credit ON L that's a payment (Transfer, Debt Repayment, linked to L's own bill, or a linked
//   transfer) is the card's mirror of a payment already counted from the bank side, so it's
//   ignored here — and, when it isn't a Transfer, it must also come OUT of income. Any other
//   Credit on L is a refund and lowers the month's net charges.

export const DEBT_REPAYMENT_CATEGORY = "Debt Repayment";
const TRANSFER = "Transfer";

export interface DebtFlowTxn {
  period: string;
  accountId: number | null;
  direction: string; // Debit | Credit
  category: string | null;
  billId: number | null;
  /** Account of the linked transfer partner, if the row is one side of a linked transfer. */
  partnerAccountId: number | null;
  amount: number; // positive magnitude
}

export interface DebtFlowLiability {
  id: number;
  billId: number | null;
}

export interface AccountDebtFlow {
  /** Paid TO the debt from elsewhere this month. */
  paid: number;
  /** New charges on it this month, net of refunds. */
  charged: number;
  /** paid − charged: how far the balance moved down (negative = it grew). */
  paydown: number;
}

export interface PeriodDebtFlow {
  accounts: Map<number, AccountDebtFlow>;
  /** Debt Repayment debits that aren't attributable to a tracked liability — all paydown. */
  unattributed: number;
  /** Payment debits that a non-Transfer rollup counts as outgoing (to be backed out of it). */
  countedPayments: number;
  /** Payment credits on a liability that a non-Transfer rollup counts as income. */
  mirrorCredits: number;
  /** Σ account paydown + unattributed. */
  paydown: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function emptyDebtFlow(): PeriodDebtFlow {
  return { accounts: new Map(), unattributed: 0, countedPayments: 0, mirrorCredits: 0, paydown: 0 };
}

export function computeDebtFlows(
  txns: DebtFlowTxn[],
  liabilities: DebtFlowLiability[],
): Map<string, PeriodDebtFlow> {
  const liabIds = new Set(liabilities.map((l) => l.id));
  const liabByBill = new Map<number, number>();
  for (const l of liabilities) if (l.billId != null) liabByBill.set(l.billId, l.id);
  const billOf = new Map(liabilities.map((l) => [l.id, l.billId]));

  const out = new Map<string, PeriodDebtFlow>();
  const flowFor = (period: string) => {
    let f = out.get(period);
    if (!f) out.set(period, (f = emptyDebtFlow()));
    return f;
  };
  const acctFor = (f: PeriodDebtFlow, id: number) => {
    let a = f.accounts.get(id);
    if (!a) f.accounts.set(id, (a = { paid: 0, charged: 0, paydown: 0 }));
    return a;
  };

  for (const t of txns) {
    if (!(t.amount > 0)) continue;
    const f = flowFor(t.period);
    const onLiab = t.accountId != null && liabIds.has(t.accountId);
    const isTransfer = t.category === TRANSFER;

    if (t.direction === "Debit") {
      // Which debt (if any) this debit pays — never the account it was charged on.
      let target: number | null = null;
      if (t.billId != null && liabByBill.has(t.billId)) target = liabByBill.get(t.billId)!;
      if (target == null && t.partnerAccountId != null && liabIds.has(t.partnerAccountId)) target = t.partnerAccountId;
      if (target === t.accountId) target = null;

      if (target != null) {
        acctFor(f, target).paid += t.amount;
        if (!isTransfer) f.countedPayments += t.amount;
      } else if (t.category === DEBT_REPAYMENT_CATEGORY) {
        f.unattributed += t.amount;
        f.countedPayments += t.amount;
      }
      if (onLiab) acctFor(f, t.accountId!).charged += t.amount;
      continue;
    }

    if (!onLiab) continue;
    const isPayment =
      isTransfer ||
      t.category === DEBT_REPAYMENT_CATEGORY ||
      t.partnerAccountId != null ||
      (t.billId != null && t.billId === billOf.get(t.accountId!));
    if (isPayment) {
      if (!isTransfer) f.mirrorCredits += t.amount;
    } else {
      acctFor(f, t.accountId!).charged -= t.amount;
    }
  }

  for (const f of out.values()) {
    let sum = f.unattributed;
    for (const a of f.accounts.values()) {
      a.paid = r2(a.paid);
      a.charged = r2(a.charged);
      a.paydown = r2(a.paid - a.charged);
      sum += a.paydown;
    }
    f.unattributed = r2(f.unattributed);
    f.countedPayments = r2(f.countedPayments);
    f.mirrorCredits = r2(f.mirrorCredits);
    f.paydown = r2(sum);
  }
  return out;
}

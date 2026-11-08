import type {
  DateRange,
  ExternalAccountType,
  ProviderAccount,
  ProviderBalances,
  ProviderTransaction,
  TxnDirection,
} from "../sync/provider";
import type { PlaidAccount, PlaidTransaction } from "./types";

// Pure Plaid → app mapping (tests/unit/plaid.test.ts).
//
// Sign convention (Plaid docs, verified in Sandbox 2026-10-10): `amount` is positive when
// money LEAVES the account and negative when it comes in, for every account type. So a card
// purchase or a checking debit is positive (Debit); a deposit, refund or card payment is
// negative (Credit). The opposite of SimpleFIN.
export function plaidDirection(amount: number): TxnDirection {
  return amount > 0 ? "Debit" : "Credit";
}

// Plaid has five account types; the engine knows two. Loans are owed money like cards;
// investment/brokerage/other are treated as cash-like for display only (balances use the
// mapped local account's type anyway).
export function plaidAccountType(type: string): ExternalAccountType {
  return type === "credit" || type === "loan" ? "credit" : "depository";
}

export function mapAccount(
  a: PlaidAccount,
  item: { itemId: string; institutionId: string | null; institutionName: string | null },
): ProviderAccount {
  return {
    externalId: a.account_id,
    enrollmentId: item.itemId,
    name: (a.name || a.official_name || "Account").slice(0, 128),
    type: plaidAccountType(a.type),
    subtype: a.subtype?.slice(0, 32) ?? null,
    lastFour: a.mask && /^\d{2,4}$/.test(a.mask) ? a.mask.slice(-4) : null,
    currency: a.balances.iso_currency_code,
    institutionId: item.institutionId,
    institutionName: item.institutionName,
    status: "open",
  };
}

// A posted transaction carries `pending_transaction_id` pointing at the pending one it
// settles, but gets a NEW transaction_id. Using the pending id as the stable external id
// makes the engine update the pending row in place (a promotion that keeps edits, D9)
// instead of inserting the posted row and expiring the pending one days later.
export function stableTxnId(t: Pick<PlaidTransaction, "transaction_id" | "pending_transaction_id">): string {
  return t.pending_transaction_id ?? t.transaction_id;
}

// When it happened: authorized_date (set once posted) else date. A pending row's `date` is
// its authorization date, so this keeps the row's date stable when it posts.
export function txnDateOf(t: Pick<PlaidTransaction, "authorized_date" | "date">): string {
  return t.authorized_date ?? t.date;
}

export function mapTransaction(t: PlaidTransaction): ProviderTransaction {
  const pfc = t.personal_finance_category;
  const transfer = pfc?.primary === "TRANSFER_IN" || pfc?.primary === "TRANSFER_OUT";
  return {
    externalId: stableTxnId(t),
    externalAccountId: t.account_id,
    txnDate: txnDateOf(t),
    description: (t.name ?? "").trim() || (t.merchant_name ?? "").trim() || "(no description)",
    amount: Math.abs(t.amount),
    direction: plaidDirection(t.amount),
    status: t.pending ? "pending" : "posted",
    rawCategory: pfc?.detailed ?? pfc?.primary ?? null,
    kind: transfer ? "transfer" : (t.payment_channel ?? null),
    counterparty: t.merchant_name?.trim() || null,
    runningBalance: null,
    raw: t,
  };
}

// One response can hold both the pending row and the posted row that settles it (Plaid
// keeps returning the pending one for a while). Both map to the same stable id; the posted
// one wins. Rows are kept only when their *posted* date (`date`) is in range — Plaid
// filters on that, and a pending row is always kept so it is never expired by a window cut.
export function mapTransactions(rows: PlaidTransaction[], range: DateRange): ProviderTransaction[] {
  const settled = new Set(rows.filter((t) => !t.pending && t.pending_transaction_id).map((t) => t.pending_transaction_id!));
  const out = new Map<string, ProviderTransaction>();
  for (const t of rows) {
    if (t.pending && settled.has(t.transaction_id)) continue;
    if (!t.pending && (t.date < range.startDate || t.date > range.endDate)) continue;
    const m = mapTransaction(t);
    const prev = out.get(m.externalId);
    if (!prev || (prev.status === "pending" && m.status === "posted")) out.set(m.externalId, m);
  }
  return [...out.values()];
}

// /accounts/get balances: `current` is the balance for cash accounts and the amount owed
// (positive) for credit and loans, so no sign flip is needed for either type.
export function mapBalances(a: PlaidAccount): ProviderBalances {
  return { ledger: a.balances.current, available: a.balances.available };
}

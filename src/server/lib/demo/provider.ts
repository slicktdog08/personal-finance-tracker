// The demo's bank: a SyncProvider with no bank behind it. Registered only when DEMO_MODE=1
// (see ../sync/provider.ts), where it REPLACES the real providers — a demo instance has no way
// to reach SimpleFIN or Plaid. Everything it returns comes from the deterministic feed in
// ./bank.ts, so the sync engine, reconciliation, pending → posted and balance recording all run
// for real against made-up data.

import {
  SyncProviderError,
  type DateRange,
  type ExternalAccountType,
  type ProviderAccount,
  type ProviderBalances,
  type ProviderTransaction,
  type ProviderWebhookEvent,
  type SyncProvider,
} from "../sync/provider";
import {
  DEMO_ACCOUNTS,
  DEMO_ENROLLMENT_ID,
  DEMO_INSTITUTION,
  DEMO_PROVIDER_ID,
  decodeDemoToken,
  demoBalances,
  demoFeed,
  demoIsPending,
  eachDay,
  kindOfExternalId,
  type DemoTokenState,
} from "./bank";

function now(): { today: string; hour: number } {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { today, hour: d.getHours() };
}

function stateOf(token: string): DemoTokenState {
  const state = decodeDemoToken(token);
  if (!state) {
    throw new SyncProviderError("The Demo Bank connection is invalid. Re-seed the demo data.", { code: "demo_bad_token", disconnected: true });
  }
  return state;
}

export const demoProvider: SyncProvider = {
  id: DEMO_PROVIDER_ID,

  async listAccounts(accessToken: string): Promise<ProviderAccount[]> {
    stateOf(accessToken);
    return (["checking", "card"] as const).map((kind) => ({
      externalId: DEMO_ACCOUNTS[kind].externalId,
      enrollmentId: DEMO_ENROLLMENT_ID,
      name: DEMO_ACCOUNTS[kind].name,
      type: kind === "checking" ? "depository" : "credit",
      subtype: kind === "checking" ? "checking" : "credit_card",
      lastFour: DEMO_ACCOUNTS[kind].lastFour,
      currency: "USD",
      institutionId: "demo-bank",
      institutionName: DEMO_INSTITUTION,
      status: "open",
    }));
  },

  async listTransactions(accessToken: string, account: { externalId: string; type: ExternalAccountType }, range: DateRange): Promise<ProviderTransaction[]> {
    stateOf(accessToken);
    const kind = kindOfExternalId(account.externalId);
    if (!kind) throw new SyncProviderError(`Demo Bank has no account ${account.externalId}.`, { code: "demo_no_account", accountClosed: true });
    const { today, hour } = now();
    const end = range.endDate < today ? range.endDate : today;
    if (range.startDate > end) return [];
    const out: ProviderTransaction[] = [];
    for (const day of eachDay(range.startDate, end)) {
      for (const item of demoFeed(kind, day)) {
        if (day === today && item.hour > hour) continue; // hasn't happened yet
        out.push({
          externalId: item.externalId,
          externalAccountId: account.externalId,
          txnDate: item.date,
          description: item.description,
          amount: item.amount,
          direction: item.direction,
          status: demoIsPending(day, today) ? "pending" : "posted",
          rawCategory: null,
          kind: "card_payment",
          counterparty: item.counterparty,
          runningBalance: null,
          raw: { demo: true, id: item.externalId },
        });
      }
    }
    return out;
  },

  async getBalances(accessToken: string, account: { externalId: string; type: ExternalAccountType }): Promise<ProviderBalances> {
    const state = stateOf(accessToken);
    const kind = kindOfExternalId(account.externalId);
    if (!kind) return { ledger: null, available: null };
    const { today, hour } = now();
    const { ledger, pending } = demoBalances(state, kind, today, hour);
    if (kind === "checking") return { ledger, available: Math.round((ledger - pending) * 100) / 100 };
    const limit = DEMO_ACCOUNTS.card.creditLimit ?? 0;
    return { ledger, available: Math.round((limit - ledger - pending) * 100) / 100 };
  },

  // Nothing exists on a provider's side to revoke.
  async deleteEnrollment(): Promise<void> {},

  // Demo Bank sends no webhooks, so nothing can ever carry a valid signature.
  verifyWebhook(): ProviderWebhookEvent | null {
    return null;
  },

  debugResponse(accessToken: string): unknown {
    return { demo: true, state: decodeDemoToken(accessToken) };
  },
};

// The bank-sync provider contract. Everything the app stores or shows is provider-agnostic
// (transactions.source/external_id, the sync_* tables); the only code that talks to an
// aggregator is a SyncProvider implementation, and the only caller of a SyncProvider is
// sync.ts. Readers — pages, queries, MCP tools, the CLI's status commands — never touch a
// provider (planning/features/bank-sync.md, D11).
//
// Registered: SimpleFIN Bridge (src/server/lib/simplefin/) and Plaid (src/server/lib/plaid/). Teller, the first provider built
// against this contract, shut its API down in July 2026. Adding another = a folder
// implementing this interface + one line in PROVIDERS. The e2e suite exercises the whole
// engine through an in-memory provider (tests/e2e/helpers.ts).

export type SyncProviderId = string;

export type ExternalAccountType = "depository" | "credit";
export type TxnDirection = "Debit" | "Credit";
export type TxnStatus = "posted" | "pending";

export interface ProviderAccount {
  externalId: string;
  enrollmentId: string;
  name: string;
  type: ExternalAccountType;
  subtype: string | null;
  lastFour: string | null;
  currency: string | null;
  institutionId: string | null;
  institutionName: string | null;
  status: "open" | "closed";
}

// Already normalized to the app's conventions: `amount` is the absolute value and
// `direction` carries the sign (Debit = money out / charge, Credit = money in / payment),
// exactly like every CSV/PDF row. Provider-specific sign rules live in the provider's map.
export interface ProviderTransaction {
  externalId: string;
  externalAccountId: string;
  txnDate: string; // ISO YYYY-MM-DD
  description: string;
  amount: number;
  direction: TxnDirection;
  status: TxnStatus;
  // Provider enrichment, used as hints only: `rawCategory` feeds rules on field=raw_category,
  // `kind` (e.g. "transfer", "atm") is stored for transfer pairing, `counterparty` is a
  // cleaned merchant name.
  rawCategory: string | null;
  kind: string | null;
  counterparty: string | null;
  runningBalance: number | null;
  raw: unknown;
}

export interface ProviderBalances {
  // For depository: ledger = booked, available = ledger minus holds/pending.
  // For credit: ledger = amount owed, available = remaining credit.
  ledger: number | null;
  available: number | null;
}

export interface DateRange {
  startDate: string; // inclusive ISO
  endDate: string; // inclusive ISO
}

export type ProviderWebhookEvent =
  | { type: "transactions.processed"; enrollmentId: string }
  | { type: "enrollment.disconnected"; enrollmentId: string; reason: string | null }
  | { type: "test" }
  | { type: "other"; raw: unknown };

export interface SyncProvider {
  readonly id: string; // a SyncProviderId in the app; tests register throwaway ids
  // Whether an account missing from listAccounts has been closed (default true). False for
  // providers that drop an account from a response while its bank connection is failing.
  readonly unlistedMeansClosed?: boolean;
  listAccounts(accessToken: string): Promise<ProviderAccount[]>;
  // `account.type` is passed because sign conventions differ by account type at most
  // aggregators; sync.ts already knows it from sync_accounts.
  listTransactions(
    accessToken: string,
    account: { externalId: string; type: ExternalAccountType },
    range: DateRange,
  ): Promise<ProviderTransaction[]>;
  // `account.type` is the cash/credit view of the LOCAL account it feeds (the ledger's own
  // account type is the truth), for providers whose balances need a sign decision.
  getBalances(accessToken: string, account: { externalId: string; type: ExternalAccountType }): Promise<ProviderBalances>;
  // Revoke our access on the provider's side. Idempotent: an already-deleted enrollment is
  // not an error.
  deleteEnrollment(accessToken: string, enrollmentId: string): Promise<void>;
  // Returns null when the signature doesn't verify (caller responds 401) — never throws
  // on bad input, since the input is attacker-controlled. May be async (Plaid fetches its
  // signing key).
  verifyWebhook(rawBody: string, headers: Headers): ProviderWebhookEvent | null | Promise<ProviderWebhookEvent | null>;
  // Optional diagnostics: the raw response the last calls for this token were served from,
  // trimmed to a reasonable size. Dry runs store it in the run's details so the settings
  // page / CLI can show exactly what the provider sent.
  debugResponse?(accessToken: string): unknown;
}

// Thrown by providers for any non-2xx or transport failure. `disconnected` means the
// enrollment itself is broken and needs a reconnect (not a retry); `accountClosed` means
// this one account is gone from the provider's view; `retryAfterSec` is set on 429.
export class SyncProviderError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retryAfterSec: number | null;
  readonly disconnected: boolean;
  readonly accountClosed: boolean;

  constructor(
    message: string,
    opts: {
      code: string;
      httpStatus?: number | null;
      retryAfterSec?: number | null;
      disconnected?: boolean;
      accountClosed?: boolean;
    },
  ) {
    super(message);
    this.name = "SyncProviderError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.disconnected = opts.disconnected ?? false;
    this.accountClosed = opts.accountClosed ?? false;
  }
}

// Lazy registry so importing the contract never pulls in a provider's transport code.
//
// Demo mode (DEMO_MODE=1) swaps the whole registry for the in-process Demo Bank: a public demo
// must have no path to a real aggregator, so the real providers are not merely hidden there —
// they are not registered, and `getProvider("simplefin")` throws.
const PROVIDERS: Record<string, () => Promise<SyncProvider>> =
  process.env.DEMO_MODE === "1"
    ? { demo: async () => (await import("../demo/provider")).demoProvider }
    : {
        simplefin: async () => (await import("../simplefin")).simplefinProvider,
        plaid: async () => (await import("../plaid")).plaidProvider,
      };

export async function getProvider(id: string): Promise<SyncProvider> {
  const load = PROVIDERS[id];
  if (!load) throw new Error(`Unknown sync provider "${id}"`);
  return load();
}

export function isKnownProvider(id: string): id is SyncProviderId {
  return Object.hasOwn(PROVIDERS, id);
}

// Register a provider at runtime — used by tests for the in-memory provider. Refused in
// production so a stray import can never widen what the app will talk to; real providers
// go in PROVIDERS above.
export function registerSyncProvider(provider: SyncProvider): void {
  if (process.env.NODE_ENV === "production") throw new Error("registerSyncProvider is for tests only");
  PROVIDERS[provider.id] = async () => provider;
}

export function registeredProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}

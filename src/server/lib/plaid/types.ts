// Plaid wire types (API version 2020-09-14) — only the fields this app reads.

export interface PlaidError {
  error_type: string; // ITEM_ERROR | INVALID_INPUT | RATE_LIMIT_EXCEEDED | API_ERROR | ...
  error_code: string; // ITEM_LOGIN_REQUIRED | PRODUCT_NOT_READY | ...
  error_message: string;
  display_message: string | null;
  request_id?: string;
}

export interface PlaidBalances {
  available: number | null;
  current: number | null; // depository: balance; credit/loan: amount owed (positive)
  limit: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: "depository" | "credit" | "loan" | "investment" | "brokerage" | "other" | string;
  subtype: string | null;
  balances: PlaidBalances;
}

export interface PlaidItem {
  item_id: string;
  institution_id: string | null;
  institution_name?: string | null;
  webhook: string | null;
  error: PlaidError | null;
}

export interface PlaidAccountsResponse {
  accounts: PlaidAccount[];
  item: PlaidItem;
  request_id: string;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money OUT of the account, for every account type
  iso_currency_code: string | null;
  date: string; // posted date (or occurred date while pending)
  authorized_date: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  name: string;
  merchant_name: string | null;
  original_description?: string | null;
  payment_channel: string | null;
  personal_finance_category: { primary: string; detailed: string; confidence_level?: string } | null;
}

export interface PlaidTransactionsGetResponse {
  accounts: PlaidAccount[];
  transactions: PlaidTransaction[];
  total_transactions: number;
  item: PlaidItem;
  request_id: string;
}

export interface PlaidLinkTokenResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

export interface PlaidExchangeResponse {
  access_token: string;
  item_id: string;
  request_id: string;
}

export interface PlaidWebhookBody {
  webhook_type: string; // TRANSACTIONS | ITEM | ...
  webhook_code: string;
  item_id?: string;
  error?: PlaidError | null;
  environment?: string;
}

// SimpleFIN protocol v2 wire types (https://www.simplefin.org/protocol.html). Amounts and
// balances arrive as decimal strings; timestamps are unix seconds. Fields the spec marks
// optional — and the extras Bridge sends beyond the spec (payee, memo, mcc, holdings) — are
// optional here too.

export interface SfinError {
  code: string; // gen.* | con.* | act.* (e.g. con.auth, act.failed)
  msg: string;
  conn_id?: string;
  account_id?: string;
}

export interface SfinConnection {
  conn_id: string;
  name: string;
  org_id: string;
  org_name?: string;
  org_url?: string;
  sfin_url?: string;
}

export interface SfinTransaction {
  id: string; // unique within its account only
  posted: number; // 0 while pending
  amount: string; // + deposit, − withdrawal, for every account type
  description: string;
  transacted_at?: number;
  pending?: boolean;
  payee?: string;
  memo?: string;
  mcc?: string;
  extra?: Record<string, unknown>;
}

export interface SfinAccount {
  id: string;
  name: string;
  conn_id?: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SfinTransaction[];
  extra?: Record<string, unknown>;
}

export interface SfinAccountSet {
  errlist?: SfinError[];
  connections?: SfinConnection[];
  accounts: SfinAccount[];
}

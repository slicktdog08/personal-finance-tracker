import { createHash } from "crypto";
import type {
  DateRange,
  ExternalAccountType,
  ProviderAccount,
  ProviderBalances,
  ProviderTransaction,
  TxnDirection,
} from "../sync/provider";
import type { SfinAccount, SfinConnection, SfinTransaction } from "./types";

// Pure SimpleFIN → app mapping. No I/O, so it is exercised with fixtures
// (tests/unit/simplefin-map.test.ts).
//
// Sign convention (protocol spec, and verified against Bridge's demo data 2026-10-08):
// every amount is from the account holder's side — positive = money into the account,
// negative = money out — for checking AND cards alike. So a card purchase is negative
// (Debit) and a card payment positive (Credit); no per-type mirror like Teller had.
// Balances follow the same rule: a card's balance is negative while money is owed.
export function sfinDirection(signedAmount: number): TxnDirection {
  return signedAmount < 0 ? "Debit" : "Credit";
}

export function num(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Unix seconds → YYYY-MM-DD in the server's local zone, the same zone todayIso() and
// queryRange() use.
export function unixToLocalIso(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// YYYY-MM-DD → unix seconds at local midnight.
export function localIsoToUnix(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

// external_id columns are VARCHAR(64). Account ids pass through when they fit (they are
// shown in the UI and CLI); anything longer is hashed.
export function externalAccountId(id: string): string {
  return id.length <= 64 ? id : `sfa_${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

// Transaction ids are only unique within their account (Bridge's demo reuses the same id
// across accounts), while transactions.external_id is unique per source. So the stored id
// is a hash of both.
export function externalTxnId(accountId: string, txnId: string): string {
  return `sft_${createHash("sha256").update(`${accountId}\u0000${txnId}`).digest("hex").slice(0, 40)}`;
}

// SimpleFIN has no account type. A negative balance (money owed) or a card-ish name means
// credit; everything else is depository. Only used for display and auto-mapping — the
// sync writer takes cash-vs-credit from the mapped local account.
const CARD_WORDS = /\b(credit|card|visa|mastercard|master\s*card|amex|american express|discover)\b/i;
export function inferAccountType(a: Pick<SfinAccount, "name" | "balance">): ExternalAccountType {
  if (CARD_WORDS.test(a.name)) return "credit";
  return (num(a.balance) ?? 0) < 0 ? "credit" : "depository";
}

// Banks usually end the account name with the last four: "Checking (1234)",
// "CREDIT CARD ...5678", "Quicksilver - 9012".
export function lastFourOf(name: string): string | null {
  const m = /(?:^|\D)(\d{4})\D{0,3}$/.exec(name.trim());
  return m ? m[1] : null;
}

export function mapAccount(a: SfinAccount, connections: Map<string, SfinConnection>, enrollmentId: string): ProviderAccount {
  const conn = a.conn_id ? connections.get(a.conn_id) : undefined;
  return {
    externalId: externalAccountId(a.id),
    enrollmentId,
    name: a.name.slice(0, 128),
    type: inferAccountType(a),
    // SimpleFIN has no subtype; the bank connection's name goes here so the settings list
    // shows which bank each account belongs to (sync_accounts.subtype is VARCHAR(32)).
    subtype: (conn?.name ?? conn?.org_name ?? null)?.slice(0, 32) ?? null,
    lastFour: lastFourOf(a.name),
    currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : null,
    institutionId: conn?.org_id ?? a.conn_id ?? null,
    institutionName: conn?.name ?? conn?.org_name ?? null,
    status: "open",
  };
}

function isPending(t: SfinTransaction): boolean {
  return t.pending === true || !t.posted;
}

// The date shown on the row: when it happened (transacted_at) if the bank says, else when it
// posted. Using the same field before and after posting keeps a pending row's date stable
// when it settles.
export function txnDateOf(t: SfinTransaction, today: string): string {
  if (t.transacted_at) return unixToLocalIso(t.transacted_at);
  if (t.posted) return unixToLocalIso(t.posted);
  return today;
}

export function mapTransaction(t: SfinTransaction, account: SfinAccount, today: string): ProviderTransaction {
  const signed = num(t.amount) ?? 0;
  const description = (t.description ?? "").trim() || (t.payee ?? "").trim() || (t.memo ?? "").trim() || "(no description)";
  return {
    externalId: externalTxnId(account.id, t.id),
    externalAccountId: externalAccountId(account.id),
    txnDate: txnDateOf(t, today),
    description,
    amount: Math.abs(signed),
    direction: sfinDirection(signed),
    status: isPending(t) ? "pending" : "posted",
    rawCategory: null,
    kind: null,
    counterparty: t.payee?.trim() || null,
    runningBalance: null,
    raw: { ...t, account_id: account.id },
  };
}

// Which of an account's transactions belong to a requested range. Posted rows are judged by
// their POSTED date — that is what Bridge filters on — so a charge made before the window
// but posted inside it still arrives to settle its pending row. Pending rows are always
// returned: the engine already pulls the range back to the oldest pending row it holds, and
// a pending row missing from the response would be expired.
export function transactionsInRange(account: SfinAccount, range: DateRange, today: string): ProviderTransaction[] {
  const out: ProviderTransaction[] = [];
  for (const t of account.transactions ?? []) {
    if (!isPending(t)) {
      const posted = unixToLocalIso(t.posted);
      if (posted < range.startDate || posted > range.endDate) continue;
    }
    out.push(mapTransaction(t, account, today));
  }
  return out;
}

// `type` is the cash/credit view of the mapped LOCAL account (see SyncProvider.getBalances).
// Credit: ledger = amount owed, i.e. the negated balance. Depository: ledger = balance,
// available = available-balance, or null when the bank didn't really report one — sync then
// records the balance and says so in the snapshot's note.
//
// Capital One (360 checking/savings, 2026-10-08) sends available-balance "0.00" as a placeholder
// for "not reported": $0 was recorded against ~$1.4k. A zero available next to a non-zero balance
// is treated as missing. (Both zero is a genuinely empty account, and stays 0.)
export function mapBalances(a: SfinAccount, type: ExternalAccountType): ProviderBalances {
  const balance = num(a.balance);
  let available = num(a["available-balance"]);
  if (available === 0 && balance != null && balance !== 0) available = null;
  if (type === "credit") return { ledger: balance == null ? null : -balance, available };
  return { ledger: balance, available };
}

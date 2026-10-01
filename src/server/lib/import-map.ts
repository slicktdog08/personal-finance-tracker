// Pure CSV parsing + column-mapping logic (no DB / server-only imports), so it can
// be unit-tested and reused. The app's transaction direction is ALWAYS "Debit" or
// "Credit" — a bank's free-form "Type"/"Category" column never leaks into it.
import Papa from "papaparse";
import { parseMoney } from "@/server/lib/money";
import { parseDateToIso } from "@/server/lib/period";
import type { ColumnMapping, BalanceSnapshot } from "@/server/lib/import-types";

export function parseRows(csvText: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const content = csvText.replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  const rows = parsed.data.filter((r) => Object.values(r).some((v) => (v ?? "").trim() !== ""));
  return { headers, rows };
}

const low = (s: string) => s.trim().toLowerCase();

// Values that unambiguously denote a Debit/Credit column. A taxonomy column like
// Chase's "Type" (Sale/Payment/Fee/Refund/Adjustment) does NOT qualify — those are
// not directions, so we fall back to the amount sign instead.
const DIR_VALUE = /^(debit|credit|dr|cr|withdrawal|deposit)$/;

// A masked account/card reference: "****1234", "xxxx-1234", "•••• 1234", "ending in 1234".
// These are unambiguous even when the column is named oddly.
const isMaskedAccountRef = (v: string) =>
  /(?:[*x•·#]{2,}|ending(?:\s+in)?)[\s-]*\d{2,6}$/i.test(v.trim());

// Does a cell value look like an account/card reference at all? Either masked (above), or a
// token that is essentially just a number — a bare last-4 ("1234") or a full account/card
// number (8–19 digits, optional spaces/hyphens). Anything with other letters is rejected so
// we don't grab descriptions, statuses, etc.
export function looksLikeAccountRef(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (isMaskedAccountRef(s)) return true;
  if (/[^\d\s*x•·#.-]/i.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return (digits.length >= 3 && digits.length <= 4) || (digits.length >= 8 && digits.length <= 19);
}

// Resiliently pick the account/card column. Header names vary wildly across banks
// ("Account Number", "Card No.", "Acct #", "Member", or something bespoke), so we SCORE each
// candidate on both its header name AND the shape of its sampled values, rather than trusting a
// single header regex. A masked column ("****1234") is recognized even with an unhelpful name;
// a bare-number column needs at least a weak naming hint so we don't grab a check-# / ZIP / phone
// column. `used` are columns already claimed by other fields — never reuse them.
export function guessAccountColumn(
  headers: string[],
  sample: Record<string, string>[],
  used: (string | undefined)[],
): string | undefined {
  const skip = new Set(used.filter(Boolean) as string[]);
  let best: string | undefined;
  let bestScore = 0;
  for (const h of headers) {
    if (skip.has(h)) continue;
    const name = low(h);
    let score = 0;
    // Header-name signal.
    if (/account|acct|\bacc\b|\bcards?\b|member|ending|last ?4/.test(name)) score += 3;
    else if (/\bno\.?\b|number|#/.test(name) && !/check|cheque|ref|conf|auth|seq|trans/.test(name))
      score += 1;
    if (/check|cheque|routing|\bref\b|confirmation/.test(name)) score -= 3;
    // Value-shape signal.
    const vals = sample.map((r) => (r[h] ?? "").trim()).filter(Boolean);
    if (vals.length) {
      const masked = vals.filter(isMaskedAccountRef).length / vals.length;
      const ref = vals.filter(looksLikeAccountRef).length / vals.length;
      if (masked >= 0.6) score += 3;
      else if (ref >= 0.8) score += 2;
      else if (ref >= 0.5) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  // Require a combined confidence of 3: a naming hint, a masked column, or a weak name + numeric
  // values. Pure numbers with no naming hint (check #, ZIP) score ≤2 and are intentionally ignored.
  return bestScore >= 3 ? best : undefined;
}

export function guessMapping(headers: string[], sample: Record<string, string>[]): ColumnMapping {
  const find = (re: RegExp) => headers.find((h) => re.test(low(h)));
  const exact = (name: string) => headers.find((h) => low(h) === name);

  const date =
    find(/transaction date|trans date|posted date|post date/) ?? find(/date/) ?? headers[0] ?? "";
  const description =
    exact("description") ?? find(/description|memo|name|payee|details/) ?? headers[1] ?? "";
  // An amount-ish header: "Amount" / "Amt" (word-bounded so it won't hit "Payment"),
  // but never a net / balance / available / fee / limit / interest column.
  const isAmt = (h: string) =>
    /\bam(?:oun)?t\b/.test(low(h)) &&
    !/\bnet\b|balance|\bbal\b|avail|\bfee\b|limit|interest/.test(low(h));
  const amount =
    exact("amount") ??
    // Prefer a transaction/posted amount over any other amount-ish column.
    headers.find((h) => /transaction|txn|\btrans\b|posted|posting/.test(low(h)) && isAmt(h)) ??
    headers.find(isAmt) ??
    find(/amount|amt|debit/) ??
    "";
  const netAmount = find(/net.*am(?:oun)?t/);
  const category = exact("category");
  // A balance column (e.g. "Available Balance", "Balance", "Running Bal"). Prefer an
  // available-balance column when present — that's what the ledger tracks here.
  const balanceCol =
    headers.find((h) => /avail.*bal|bal.*avail/.test(low(h))) ??
    headers.find((h) => /balance|bal\b/.test(low(h)));

  // Split debit/credit layout (e.g. Capital One): the amount lives in EITHER a Debit column
  // OR a Credit column, and which one it's in is the direction. Detected only when both a
  // debit-ish and a distinct credit-ish column exist.
  const debitCol = headers.find((h) => /^debit$|debit ?amount|amount ?debit|withdrawal|money ?out/.test(low(h)));
  const creditCol = headers.find(
    (h) => h !== debitCol && /^credit$|credit ?amount|amount ?credit|deposit|money ?in/.test(low(h)),
  );
  const split = !!debitCol && !!creditCol;

  // Account/card column — scored on name + value shape, excluding columns already claimed.
  const accountCol = guessAccountColumn(headers, sample, [
    date,
    description,
    amount,
    netAmount,
    category,
    balanceCol,
    debitCol,
    creditCol,
  ]);

  // Only treat a column as a direction column when its sampled values are truly
  // Debit/Credit-like — never a Sale/Payment/Fee taxonomy.
  const dirCol = headers.find((h) => {
    const vals = sample.map((r) => low(r[h] ?? "")).filter(Boolean);
    return vals.length > 0 && vals.every((v) => DIR_VALUE.test(v));
  });

  return {
    date,
    description,
    amount,
    netAmount: netAmount || undefined,
    category: category || undefined,
    balanceColumn: balanceCol || undefined,
    accountMode: accountCol ? "column" : "fixed",
    accountColumn: accountCol || undefined,
    fixedAccountNumber: "",
    amountMode: split ? "split" : "single",
    debitColumn: split ? debitCol : undefined,
    creditColumn: split ? creditCol : undefined,
    directionMode: dirCol ? "column" : "sign",
    directionColumn: dirCol || undefined,
    negativeIs: "Debit",
  };
}

export function last4(s: string): string {
  const digits = s.replace(/\D/g, "");
  return digits.length > 4 ? digits.slice(-4) : digits;
}

// Map a value from a *true* Debit/Credit column to the app's strict direction.
// Conservative on purpose: ambiguous words (e.g. "Payment", which is money-in on a
// credit card but money-out on checking) are not guessed here — use amount-sign for those.
export function normalizeDirection(v: string): "Debit" | "Credit" {
  const s = low(v);
  if (/^(credit|cr|deposit)$/.test(s) || /\bcredit\b|\bdeposit\b/.test(s)) return "Credit";
  return "Debit";
}

export interface Mapped {
  description: string;
  accountNumber: string;
  rawCategory: string;
  amount: number | null;
  netAmount: number | null;
  balance: number | null; // running/current balance from the mapped balance column, if any
  direction: "Debit" | "Credit";
  dateIso: string | null;
  raw: Record<string, string>;
}

export function extract(r: Record<string, string>, m: ColumnMapping): Mapped {
  const get = (h?: string) => (h ? (r[h] ?? "").trim() : "");
  const dateIso = parseDateToIso(get(m.date));
  const rawAmt = parseMoney(get(m.amount));

  let direction: "Debit" | "Credit";
  let amount: number | null;
  let netAmount: number | null;

  if (m.amountMode === "split") {
    // Amount is in the Debit column OR the Credit column; the filled one sets the direction.
    // A blank or 0.00 in a column means "not this direction".
    const dr = parseMoney(get(m.debitColumn));
    const cr = parseMoney(get(m.creditColumn));
    const hasCr = cr != null && cr !== 0;
    const hasDr = dr != null && dr !== 0;
    if (hasCr) {
      direction = "Credit";
      amount = Math.abs(cr);
    } else if (hasDr) {
      direction = "Debit";
      amount = Math.abs(dr);
    } else {
      direction = "Debit";
      amount = null; // neither column filled → flagged as an error row downstream
    }
    netAmount = m.netAmount
      ? parseMoney(get(m.netAmount))
      : amount == null
        ? null
        : direction === "Credit"
          ? amount
          : -amount;
  } else if (m.directionMode === "column") {
    direction = normalizeDirection(get(m.directionColumn));
    amount = rawAmt == null ? null : Math.abs(rawAmt);
    netAmount = m.netAmount
      ? parseMoney(get(m.netAmount))
      : rawAmt == null
        ? null
        : direction === "Credit"
          ? Math.abs(rawAmt)
          : -Math.abs(rawAmt);
  } else {
    // Direction from the sign of the amount (robust for any bank).
    direction =
      rawAmt == null
        ? "Debit"
        : rawAmt < 0
          ? m.negativeIs
          : m.negativeIs === "Debit"
            ? "Credit"
            : "Debit";
    amount = rawAmt == null ? null : Math.abs(rawAmt);
    netAmount = m.netAmount ? parseMoney(get(m.netAmount)) : rawAmt;
  }

  return {
    description: get(m.description),
    accountNumber:
      m.accountMode === "column" ? last4(get(m.accountColumn)) : (m.fixedAccountNumber ?? "").trim(),
    rawCategory: m.category ? get(m.category) : "",
    amount,
    netAmount,
    balance: m.balanceColumn ? parseMoney(get(m.balanceColumn)) : null,
    direction,
    dateIso,
    raw: r,
  };
}

// Collapse per-row running balances into one dated snapshot per (account, day) — the
// end-of-day balance — for the account_balances ledger. Bank CSVs list one balance per
// transaction; the ledger only cares about the settled balance at day's end. We auto-detect
// file order (newest-first vs oldest-first) so we keep the right row when a day has several.
export function buildBalanceSnapshots(mapped: Mapped[]): BalanceSnapshot[] {
  const usable = mapped.filter(
    (m): m is Mapped & { balance: number; dateIso: string } =>
      m.balance != null && !!m.dateIso && !!m.accountNumber,
  );
  if (!usable.length) return [];

  // Detect direction from the first vs last usable date. Descending (newest-first) →
  // the first file occurrence of a date is the end-of-day row; ascending → the last one.
  const descending = usable[0].dateIso > usable[usable.length - 1].dateIso;

  const byKey = new Map<string, BalanceSnapshot>();
  for (const m of usable) {
    const key = `${m.accountNumber}|${m.dateIso}`;
    if (descending && byKey.has(key)) continue; // keep first-seen (end-of-day) when newest-first
    byKey.set(key, { accountNumber: m.accountNumber, asOf: m.dateIso, balance: m.balance });
  }
  return [...byKey.values()].sort((a, b) =>
    a.accountNumber === b.accountNumber
      ? a.asOf.localeCompare(b.asOf)
      : a.accountNumber.localeCompare(b.accountNumber),
  );
}

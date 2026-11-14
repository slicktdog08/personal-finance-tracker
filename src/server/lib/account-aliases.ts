import "server-only";
import { db } from "@/server/db";
import { accounts, accountAliases } from "@/server/db/schema";
import { sql } from "drizzle-orm";

// An account is recognized by its number (usually the last four), and a reissued card gets a
// new one. `account_aliases` holds the numbers an account used to go by, so anything that
// knows an account only by number — CSV/PDF imports, a transaction typed in by hand — must
// resolve it here rather than against `accounts.account_number` alone.
//
// A statement keeps the number printed on it all the way through the import: the dedup hash is
// built from that number, so re-importing an old statement after a merge still recognizes its
// own rows. Only the account *id* is resolved through the alias.

export interface AccountLookup {
  /** Every number an account answers to — its own and its former ones — to the account id. */
  idByNumber: Map<string, number>;
  /** The account's current number. */
  numberById: Map<number, string>;
  /** The other numbers the account behind `n` answers to (empty when it has none, or is unknown). */
  otherNumbers(n: string): string[];
}

export async function loadAccountLookup(): Promise<AccountLookup> {
  const [rows, aliases] = await Promise.all([
    db.select({ id: accounts.id, n: accounts.accountNumber }).from(accounts),
    db.select({ id: accountAliases.accountId, n: accountAliases.accountNumber }).from(accountAliases),
  ]);
  const idByNumber = new Map<string, number>();
  for (const a of aliases) idByNumber.set(a.n, a.id);
  // A real account always wins over a former number that happens to match it.
  for (const r of rows) idByNumber.set(r.n, r.id);
  const numbersById = new Map<number, string[]>();
  for (const [n, id] of idByNumber) numbersById.set(id, [...(numbersById.get(id) ?? []), n]);
  return {
    idByNumber,
    numberById: new Map(rows.map((r) => [r.id, r.n])),
    otherNumbers: (n) => (numbersById.get(idByNumber.get(n) ?? -1) ?? []).filter((x) => x !== n),
  };
}

export async function accountIdsByNumber(): Promise<Map<string, number>> {
  return (await loadAccountLookup()).idByNumber;
}

/**
 * Get-or-create: makes an account for every number that isn't one already and isn't a former
 * number of one, then returns the id each number resolves to.
 */
export async function ensureAccounts(numbers: Iterable<string>): Promise<Map<string, number>> {
  const wanted = [...new Set([...numbers].map((n) => n.trim()).filter(Boolean))];
  const known = await accountIdsByNumber();
  const missing = wanted.filter((n) => !known.has(n));
  if (!missing.length) return known;
  await db
    .insert(accounts)
    .values(missing.map((n) => ({ accountNumber: n })))
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  return accountIdsByNumber();
}

/** Former numbers per account id, oldest first — for "formerly ··1234" on account rows. */
export async function getAccountAliases(): Promise<Map<number, string[]>> {
  const rows = await db
    .select({ id: accountAliases.accountId, n: accountAliases.accountNumber })
    .from(accountAliases)
    .orderBy(accountAliases.id);
  const out = new Map<number, string[]>();
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.n]);
  return out;
}

/**
 * Dedup hashes for the same rows as if each had been imported under one of its account's other
 * numbers. A hash is built from the number a row was imported with, so after an account is
 * merged or renumbered the same transaction may already be stored under a different one; a row
 * whose hash under any of these exists is a duplicate too. One array per alternative, each
 * index-aligned with `rows` (a row whose account has fewer alternatives keeps its own hash).
 */
export function alternateHashes<R extends { accountNumber?: string | null }>(
  rows: R[],
  lookup: AccountLookup,
  hash: (rows: R[]) => string[],
): string[][] {
  const alts = rows.map((r) => lookup.otherNumbers((r.accountNumber ?? "").trim()));
  const most = Math.max(0, ...alts.map((a) => a.length));
  return Array.from({ length: most }, (_, j) => hash(rows.map((r, i) => (alts[i][j] ? { ...r, accountNumber: alts[i][j] } : r))));
}

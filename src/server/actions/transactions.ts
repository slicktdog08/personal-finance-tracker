"use server";

import { db } from "@/server/db";
import { transactions, accounts, accountBalances, periods, bills, billInstances, syncIgnored } from "@/server/db/schema";
import { and, eq, sql, desc, like, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { dedupHash, type DedupParts } from "@/server/lib/dedup";
import { normalizeMerchant } from "@/server/lib/merchant";
import { DEFAULT_NEW_MONTH_STATUS, LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import { createPeriod } from "@/server/actions/periods";
import { addAccountBalance } from "@/server/actions/accounts";
import type { AllocateResult } from "@/server/actions/cash";
import { requireSession } from "@/server/auth/session";

export async function updateTransactionCategory(
  id: number,
  category: string | null,
  path: string,
): Promise<void> {
  await requireSession();
  // A hand-picked category is no longer "set by rule X" — clear the stamp so the
  // row stops advertising the rule (and a later rule edit won't reconcile it).
  await db
    .update(transactions)
    .set({ category: category || null, categoryRuleId: null })
    .where(eq(transactions.id, id));
  revalidatePath(path);
}

// Save just the long-form note for a transaction. Split out from
// updateTransaction so the table can edit a note inline without re-validating
// (and re-hashing) the whole row. Blank clears it.
export async function updateTransactionNotes(
  id: number,
  notes: string | null,
  path: string,
): Promise<void> {
  await requireSession();
  const trimmed = (notes ?? "").trim();
  await db
    .update(transactions)
    .set({ notes: trimmed || null })
    .where(eq(transactions.id, id));
  revalidatePath(path);
}

export async function linkTransactionToBill(
  id: number,
  billInstanceId: number | null,
  path: string,
): Promise<void> {
  await requireSession();
  await db
    .update(transactions)
    .set({ billInstanceId })
    .where(eq(transactions.id, id));
  revalidatePath(path);
}

// Detach a transaction from its bill entirely (both the durable bill link and
// any per-month instance). The bill and its instances are untouched — this only
// says "this payment wasn't for that bill". Passing a bill id instead moves the
// transaction to that bill: the instance link is re-pointed to the target bill's
// instance in the transaction's own month when one exists, otherwise cleared.
// Nothing else is auto-linked — a move is a one-row correction.
export async function setTransactionBill(
  id: number,
  billId: number | null,
  path: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const [txn] = await db
    .select({ id: transactions.id, periodId: transactions.periodId })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!txn) return { ok: false, error: "Transaction not found." };

  let billInstanceId: number | null = null;
  if (billId != null) {
    const [bill] = await db.select({ id: bills.id }).from(bills).where(eq(bills.id, billId)).limit(1);
    if (!bill) return { ok: false, error: "Bill not found." };
    billInstanceId = await instanceInPeriod(billId, txn.periodId);
  }
  await db
    .update(transactions)
    .set({ billId, billInstanceId })
    .where(eq(transactions.id, id));
  revalidatePath(path);
  revalidatePath("/settings/bills");
  revalidatePath("/transactions");
  return { ok: true };
}

// A bill is only added to the current month if the charge has been seen within
// this many months of it — older/dormant charges get linked but not put on the
// current sheet.
const RECENT_MONTHS = 2;

// One other occurrence of the same merchant, as shown in the link preview so the
// user can confirm (or exclude) it before anything is linked.
export interface MatchCandidate {
  id: number;
  txnDate: string;
  amount: string | null;
  direction: string;
  description: string;
}

// Gather every occurrence of a merchant (by normalized key) in one pass: the
// OTHER unlinked occurrences (candidates to link), and the latest date the
// merchant was seen across ALL occurrences (to decide recency). MySQL 5.7 has no
// REGEXP_REPLACE, so we can't normalize in SQL — anchor a cheap LIKE on the first
// merchant word (safe: the key is [A-Z0-9 ] only) and refine in JS by exact key.
async function merchantGroup(
  key: string,
  excludeId: number,
): Promise<{ matches: MatchCandidate[]; latestDate: string | null }> {
  if (!key) return { matches: [], latestDate: null };
  const firstWord = key.split(" ")[0];
  const anchor = firstWord.length >= 3 ? firstWord : key;
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      direction: transactions.direction,
      billId: transactions.billId,
    })
    .from(transactions)
    // Pending rows aren't offered as link candidates (bank-sync.md D2).
    .where(and(like(transactions.description, `%${anchor}%`), eq(transactions.pending, false)))
    .orderBy(desc(transactions.txnDate), desc(transactions.id));
  const matches: MatchCandidate[] = [];
  let latestDate: string | null = null;
  for (const r of rows) {
    if (normalizeMerchant(r.description) !== key) continue;
    if (latestDate == null || r.txnDate > latestDate) latestDate = r.txnDate;
    if (r.id !== excludeId && r.billId == null) {
      matches.push({
        id: r.id,
        txnDate: r.txnDate,
        amount: r.amount,
        direction: r.direction,
        description: r.description,
      });
    }
  }
  return { matches, latestDate };
}

// The bill's instance on a given month's sheet, if it has one. Never creates.
async function instanceInPeriod(billId: number, periodId: number | null): Promise<number | null> {
  if (periodId == null) return null;
  const inst = await db
    .select({ id: billInstances.id })
    .from(billInstances)
    .where(and(eq(billInstances.periodId, periodId), eq(billInstances.billId, billId)))
    .orderBy(desc(billInstances.id))
    .limit(1);
  return inst[0]?.id ?? null;
}

// Whole months from `isoDate` up to the given period's month (0 = same month).
function monthsAgo(isoDate: string, year: number, month: number): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return year * 12 + month - (y * 12 + m);
}

// Preview what "Convert to bill" would do for a transaction: the suggested bill
// name, the other occurrences that COULD be linked (the user picks which), and
// whether the charge is recent enough to be added to the current month.
export async function previewBillConversion(transactionId: number): Promise<{
  name: string;
  amount: string | null;
  matches: MatchCandidate[];
  alreadyLinked: boolean;
  recent: boolean;
  lastSeen: string | null;
} | null> {
  await requireSession();
  const [txn] = await db
    .select({
      description: transactions.description,
      amount: transactions.amount,
      txnDate: transactions.txnDate,
      billId: transactions.billId,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!txn) return null;
  const [period] = await db
    .select({ year: periods.year, month: periods.month })
    .from(periods)
    .orderBy(desc(periods.year), desc(periods.month))
    .limit(1);
  const { matches, latestDate } = await merchantGroup(
    normalizeMerchant(txn.description),
    transactionId,
  );
  const lastSeen = latestDate && latestDate > txn.txnDate ? latestDate : txn.txnDate;
  const recent = period ? monthsAgo(lastSeen, period.year, period.month) <= RECENT_MONTHS : false;
  return {
    name: txn.description.trim(),
    amount: txn.amount,
    matches,
    alreadyLinked: txn.billId != null,
    recent,
    lastSeen,
  };
}

export type AttachResult =
  | { ok: true; billId: number; instanceId: number | null; linkedCount: number; onCurrentMonth: boolean }
  | { ok: false; error: string };

// Which other occurrences of the merchant to link alongside the source
// transaction. `"all"` links every unlinked match (the Bills-screen recurring
// suggestions, where the whole group is what's being confirmed); an explicit id
// list links only those — the transactions screen previews the matches and the
// user ticks the ones that belong. Ids are always re-checked against the merchant
// group server-side, so a stale or foreign id can't be linked by accident.
export type LinkOthers = "all" | number[];

// Shared core for both "convert to a new bill" and "link to an existing bill":
// link the source transaction (and the confirmed other occurrences of the same
// merchant) to the bill, and — only when the charge is recent and the bill isn't
// already on the current sheet — add it to the CURRENT month. Nothing retroactive.
// Matching is always driven by the source transaction's description, not the name.
async function attachToBill(opts: {
  transactionId: number;
  sourceDescription: string;
  sourceTxnDate: string;
  sourcePeriodId: number | null;
  billId: number;
  instanceName: string;
  amount: string | null;
  dueDay: number | null;
  paymentType: string | null;
  isDebt: boolean;
  linkOthers: LinkOthers;
  path: string;
}): Promise<{ instanceId: number | null; linkedCount: number; onCurrentMonth: boolean } | { error: string }> {
  // "Current month" = the latest period sheet the user is budgeting in.
  const [latest] = await db
    .select({ id: periods.id, year: periods.year, month: periods.month })
    .from(periods)
    .orderBy(desc(periods.year), desc(periods.month))
    .limit(1);
  if (!latest) return { error: "No month exists yet — create a month first." };
  const periodId = latest.id;

  // Everything about the merchant in one pass: what could be linked + when last seen.
  const { matches, latestDate } = await merchantGroup(
    normalizeMerchant(opts.sourceDescription),
    opts.transactionId,
  );
  const lastSeen = latestDate && latestDate > opts.sourceTxnDate ? latestDate : opts.sourceTxnDate;
  const recent = monthsAgo(lastSeen, latest.year, latest.month) <= RECENT_MONTHS;
  const chosen = opts.linkOthers === "all" ? new Set(matches.map((m) => m.id)) : new Set(opts.linkOthers);
  const matchIds = matches.filter((m) => chosen.has(m.id)).map((m) => m.id);

  // Reuse the bill's existing instance if it's already on this month's sheet
  // (never add a duplicate). Otherwise create one only when the charge is recent.
  let instanceId = await instanceInPeriod(opts.billId, periodId);
  if (instanceId == null && recent) {
    const max = await db
      .select({ m: sql<number>`COALESCE(MAX(${billInstances.sortOrder}), -1)` })
      .from(billInstances)
      .where(eq(billInstances.periodId, periodId));
    await db.insert(billInstances).values({
      periodId,
      billId: opts.billId,
      name: opts.instanceName,
      amount: opts.amount,
      status: DEFAULT_NEW_MONTH_STATUS,
      dueDay: opts.dueDay,
      paymentType: opts.paymentType,
      isDebt: opts.isDebt,
      sortOrder: (max[0]?.m ?? -1) + 1,
    });
    instanceId = await instanceInPeriod(opts.billId, periodId);
  }

  // Link the source txn to the bill (durable, cross-month) and to the instance on
  // ITS OWN month's sheet — the current one when the payment is from this month,
  // otherwise the bill's existing instance for that month if there is one. An old
  // payment must never be recorded against the current sheet.
  const sourceInstanceId =
    opts.sourcePeriodId === periodId
      ? instanceId
      : await instanceInPeriod(opts.billId, opts.sourcePeriodId);
  await db
    .update(transactions)
    .set({ billId: opts.billId, billInstanceId: sourceInstanceId })
    .where(eq(transactions.id, opts.transactionId));

  // Link the confirmed other occurrences of the same merchant to the bill.
  if (matchIds.length) {
    await db.update(transactions).set({ billId: opts.billId }).where(inArray(transactions.id, matchIds));
  }

  revalidatePath(opts.path);
  revalidatePath("/settings/bills");
  revalidatePath("/transactions");
  return { instanceId, linkedCount: matchIds.length, onCurrentMonth: instanceId != null };
}

// Turn a transaction into a NEW recurring bill (get-or-create the `bills` row by
// name), seeding the bill's default amount from the transaction.
export async function convertTransactionToBill(
  transactionId: number,
  billName: string,
  path: string,
  linkOthers: LinkOthers = "all",
): Promise<AttachResult> {
  await requireSession();
  const [txn] = await db
    .select({
      description: transactions.description,
      amount: transactions.amount,
      txnDate: transactions.txnDate,
      periodId: transactions.periodId,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!txn) return { ok: false, error: "Transaction not found." };

  const name = (billName || txn.description).trim() || "New bill";

  // Get-or-create the recurring bill by its unique name; seed defaults from the txn.
  const existing = await db.select().from(bills).where(eq(bills.name, name)).limit(1);
  let billId: number;
  let defaults = {
    amount: txn.amount as string | null,
    dueDay: null as number | null,
    paymentType: null as string | null,
    isDebt: false,
  };
  if (existing.length) {
    billId = existing[0].id;
    defaults = {
      amount: existing[0].defaultAmount ?? txn.amount,
      dueDay: existing[0].defaultDueDay,
      paymentType: existing[0].defaultPaymentType,
      isDebt: existing[0].isDebt,
    };
  } else {
    await db.insert(bills).values({ name, defaultAmount: txn.amount });
    const created = await db
      .select({ id: bills.id })
      .from(bills)
      .where(eq(bills.name, name))
      .limit(1);
    billId = created[0].id;
  }

  const r = await attachToBill({
    transactionId,
    sourceDescription: txn.description,
    sourceTxnDate: txn.txnDate,
    sourcePeriodId: txn.periodId,
    billId,
    instanceName: name,
    amount: defaults.amount,
    dueDay: defaults.dueDay,
    paymentType: defaults.paymentType,
    isDebt: defaults.isDebt,
    linkOthers,
    path,
  });
  if ("error" in r) return { ok: false, error: r.error };
  return {
    ok: true,
    billId,
    instanceId: r.instanceId,
    linkedCount: r.linkedCount,
    onCurrentMonth: r.onCurrentMonth,
  };
}

// Link a transaction to an EXISTING bill. Same effect as convert (current-month
// instance + link source + link the confirmed other occurrences) but reuses the
// chosen bill.
export async function linkTransactionToExistingBill(
  transactionId: number,
  billId: number,
  path: string,
  linkOthers: LinkOthers = "all",
): Promise<AttachResult> {
  await requireSession();
  const [txn] = await db
    .select({
      description: transactions.description,
      amount: transactions.amount,
      txnDate: transactions.txnDate,
      periodId: transactions.periodId,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!txn) return { ok: false, error: "Transaction not found." };

  const [bill] = await db.select().from(bills).where(eq(bills.id, billId)).limit(1);
  if (!bill) return { ok: false, error: "Bill not found." };

  const r = await attachToBill({
    transactionId,
    sourceDescription: txn.description,
    sourceTxnDate: txn.txnDate,
    sourcePeriodId: txn.periodId,
    billId,
    instanceName: bill.name,
    amount: bill.defaultAmount ?? txn.amount,
    dueDay: bill.defaultDueDay,
    paymentType: bill.defaultPaymentType,
    isDebt: bill.isDebt,
    linkOthers,
    path,
  });
  if ("error" in r) return { ok: false, error: r.error };
  return {
    ok: true,
    billId,
    instanceId: r.instanceId,
    linkedCount: r.linkedCount,
    onCurrentMonth: r.onCurrentMonth,
  };
}

export interface NewTransaction {
  txnDate: string; // ISO
  description: string;
  amount: number;
  direction: string; // Debit | Credit
  accountNumber?: string | null;
  category?: string | null;
  /** Free-form explanation of the charge; never part of the dedup identity. */
  notes?: string | null;
  /**
   * Not posted by the bank yet (a card hold, a tip still settling). When the statement row
   * arrives, the import offers to merge it into this one. See
   * planning/features/pending-transactions.md.
   */
  pending?: boolean;
  /**
   * When true (manual entry only), also record a dated snapshot against the
   * account so its running balance moves with this transaction: a Credit adds,
   * a Debit subtracts. No-op without a resolvable account.
   */
  adjustBalance?: boolean;
  /**
   * Cash entry only: the withdrawals this purchase was paid out of, so the same money isn't
   * counted twice (once as the ATM rows, once as what they bought). Several entries split the
   * purchase across withdrawals — a $470 purchase can drain a $300 withdrawal and take the
   * rest from a $200 one. A null amount means "as much as both sides allow".
   * See planning/features/cash-offsets.md.
   */
  offsets?: { withdrawalId: number; amount?: number | null }[] | null;
}

// Append a new account_balances snapshot reflecting this transaction. Balances
// are absolute snapshots, not deltas, so we read the latest balance as of the
// transaction's date and record base ± amount at that same date.
//
// For cash accounts, a Credit (income) increases the balance and a Debit
// (expense) decreases it. Liability accounts track amount *owed*, so the sign
// inverts: a Debit (charge) increases the balance owed and a Credit (payment)
// decreases it.
async function applyBalanceAdjustment(
  accountId: number,
  data: NewTransaction,
): Promise<void> {
  const acct = await db
    .select({ accountType: accounts.accountType })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  const isLiability = LIABILITY_ACCOUNT_TYPES.includes(acct[0]?.accountType ?? "");
  const base = await db
    .select({ balance: accountBalances.balance })
    .from(accountBalances)
    .where(
      and(
        eq(accountBalances.accountId, accountId),
        lte(accountBalances.asOf, data.txnDate),
      ),
    )
    .orderBy(desc(accountBalances.asOf), desc(accountBalances.id))
    .limit(1);
  const prev = base[0] ? Number(base[0].balance) : 0;
  const magnitude = Math.abs(data.amount);
  // Cash: Credit adds, Debit subtracts. Liability: inverted (owed balance).
  const addsToBalance =
    data.direction === "Credit" ? !isLiability : isLiability;
  const delta = addsToBalance ? magnitude : -magnitude;
  const next = Math.round((prev + delta) * 100) / 100;
  await addAccountBalance(
    accountId,
    next,
    data.txnDate,
    `Txn: ${data.description.trim().slice(0, 120)}`,
  );
}

// Find the period whose year/month contains this ISO date, creating the month
// if it doesn't exist yet. Used when a transaction is added outside any single
// month's context (e.g. the all-months Transactions screen). Returns null only
// when the date can't be parsed.
async function ensurePeriodForIsoDate(iso: string): Promise<number | null> {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const found = async () =>
    db
      .select({ id: periods.id })
      .from(periods)
      .where(and(eq(periods.year, year), eq(periods.month, month)))
      .limit(1);
  const existing = await found();
  if (existing.length) return existing[0].id;
  await createPeriod(year, month); // creates the month + adopts orphan transactions
  const created = await found();
  return created[0]?.id ?? null;
}

// Get-or-create the account by its last-4 so a transaction can name an account
// that isn't registered yet. Blank number → no account.
async function resolveAccountId(accountNumber: string | null | undefined): Promise<number | null> {
  const num = (accountNumber ?? "").trim();
  if (!num) return null;
  await db
    .insert(accounts)
    .values({ accountNumber: num })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const a = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.accountNumber, num))
    .limit(1);
  return a[0]?.id ?? null;
}

/**
 * Returns the outcome of the cash offset when one was requested, so the caller can surface
 * "the withdrawal was already fully accounted for" instead of dropping it — the transaction
 * itself is saved either way.
 */
export async function createTransaction(
  periodId: number | null,
  data: NewTransaction,
  path: string,
): Promise<{ offset?: AllocateResult }> {
  await requireSession();
  const num = (data.accountNumber ?? "").trim();
  const accountId = await resolveAccountId(num);
  // Callers scoped to a month pass its id; the all-months screen passes null,
  // so derive the period from the transaction's date.
  const pid = periodId ?? (await ensurePeriodForIsoDate(data.txnDate));
  const hash = dedupHash({
    accountNumber: num,
    date: data.txnDate,
    amount: Math.abs(data.amount),
    description: data.description,
    direction: data.direction,
  });
  await db
    .insert(transactions)
    .values({
      accountId,
      periodId: pid,
      txnDate: data.txnDate,
      description: data.description.slice(0, 512),
      notes: (data.notes ?? "").trim() || null,
      category: data.category || null,
      pending: !!data.pending,
      amount: String(Math.abs(data.amount)),
      netAmount: data.direction === "Credit" ? String(-Math.abs(data.amount)) : String(Math.abs(data.amount)),
      direction: data.direction,
      dedupHash: hash,
      source: "manual",
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  if (data.adjustBalance && accountId) {
    await applyBalanceAdjustment(accountId, data);
  }
  // Tie the purchase to the withdrawals that funded it. The insert above is an upsert, so the
  // id comes back by dedup hash — the same lookup whether the row was new or already there.
  let offset: AllocateResult | undefined;
  if (data.offsets?.length) {
    const [row] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.dedupHash, hash))
      .limit(1);
    if (!row) {
      offset = { ok: false, error: "Saved, but the transaction couldn't be found to offset." };
    } else {
      const { allocateCash } = await import("@/server/actions/cash");
      // One at a time on purpose: each allocation clamps against what the earlier ones took.
      let total = 0;
      const errors: string[] = [];
      for (const o of data.offsets) {
        const res = await allocateCash(o.withdrawalId, row.id, o.amount ?? null);
        if (res.ok) total += res.amount;
        else errors.push(res.error);
      }
      offset = errors.length
        ? { ok: false, error: errors.join(" ") }
        : { ok: true, amount: Math.round(total * 100) / 100 };
    }
  }
  revalidatePath(path);
  return { offset };
}

export interface TransactionEdit {
  txnDate: string; // ISO
  description: string;
  amount: number;
  direction: string; // Debit | Credit
  accountNumber?: string | null;
  category?: string | null;
  /**
   * Long-form note. Optional in the type, but `undefined` and `null` mean the
   * same thing here — callers that omit it clear the note, so every edit form
   * must send the current value back.
   */
  notes?: string | null;
  /**
   * Pending flag; unlike `notes`, omitting it leaves the flag as it is. Ignored for
   * bank-synced rows — the provider owns whether one of those has posted.
   */
  pending?: boolean;
}

export type UpdateTransactionResult = { ok: true } | { ok: false; error: string };

// The dedup hash is unique, so an edit can collide with an existing row — either
// with a real duplicate, or legitimately (two identical $150 payments on the same
// day). Imports resolve that with an occurrence suffix; do the same here and take
// the first free slot, so an edit is never blocked by a genuine twin.
async function freeDedupHash(
  parts: Omit<DedupParts, "occurrence">,
  excludeId: number,
): Promise<string | null> {
  const candidates = Array.from({ length: 20 }, (_, i) =>
    dedupHash({ ...parts, occurrence: i + 1 }),
  );
  const rows = await db
    .select({ id: transactions.id, dedupHash: transactions.dedupHash })
    .from(transactions)
    .where(inArray(transactions.dedupHash, candidates));
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.dedupHash));
  return candidates.find((h) => !taken.has(h)) ?? null;
}

// Edit an existing transaction's core fields (date, description, amount,
// direction, account, category) in place, so a mistake doesn't require deleting
// and re-adding the row. The bill links, transfer partner and import batch are
// left untouched, as is any account_balances snapshot recorded when the
// transaction was first added — balances are their own ledger.
export async function updateTransaction(
  id: number,
  data: TransactionEdit,
  path: string,
): Promise<UpdateTransactionResult> {
  await requireSession();
  const [existing] = await db
    .select({ id: transactions.id, category: transactions.category, externalId: transactions.externalId, dedupHash: transactions.dedupHash })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!existing) return { ok: false, error: "Transaction not found." };

  const description = data.description.trim().slice(0, 512);
  if (!description) return { ok: false, error: "Description is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.txnDate.trim())) {
    return { ok: false, error: "A valid date is required." };
  }
  const txnDate = data.txnDate.trim();
  const amount = Math.abs(data.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, error: "Amount must be a non-zero number." };
  }
  const direction = data.direction === "Credit" ? "Credit" : "Debit";

  const num = (data.accountNumber ?? "").trim();
  const accountId = await resolveAccountId(num);
  // Moving the date can move the transaction to a different month; re-derive the
  // period from the (new) date, creating that month if it doesn't exist yet.
  const periodId = await ensurePeriodForIsoDate(txnDate);

  // Bank-synced rows keep their provider-id hash (bank-sync.md D3): the sync writer matches
  // them by external id, and a content hash could collide with a CSV row of the same charge.
  const hash = existing.externalId
    ? existing.dedupHash
    : await freeDedupHash({ accountNumber: num, date: txnDate, amount, description, direction }, id);
  if (!hash) return { ok: false, error: "Too many identical transactions already exist." };

  await db
    .update(transactions)
    .set({
      accountId,
      periodId,
      txnDate,
      description,
      notes: (data.notes ?? "").trim() || null,
      category: data.category || null,
      // Changing the category by hand un-attributes it from whatever rule set it.
      ...((data.category || null) !== existing.category ? { categoryRuleId: null } : {}),
      amount: String(amount),
      netAmount: direction === "Credit" ? String(-amount) : String(amount),
      direction,
      dedupHash: hash,
      ...(data.pending !== undefined && !existing.externalId ? { pending: data.pending } : {}),
    })
    .where(eq(transactions.id, id));

  // An edit can invalidate a cash offset (amount cut below what's allocated, purchase moved
  // off the wallet), and a stale offset would understate spending. No-op when there are none.
  // Splits first: a smaller amount can't keep parts that add up to more than it, and trimming
  // a Cash part (cash back) shrinks what the offsets below are allowed to draw on.
  const { reconcileSplitsAfterEdit } = await import("@/server/actions/splits");
  await reconcileSplitsAfterEdit(id);
  const { reconcileAllocationsAfterEdit } = await import("@/server/actions/cash");
  await reconcileAllocationsAfterEdit(id);

  revalidatePath(path);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/months");
  return { ok: true };
}

// Mark a transaction as pending (entered before the bank posted it) or clear the flag — e.g.
// when it turns out the statement will never carry it, so it should stop asking to be merged.
//
// Bank-synced rows are refused: whether one of those has posted comes from the provider on the
// next run, so a hand-set flag would silently disagree with the bank until then.
export async function setTransactionPending(
  id: number,
  pending: boolean,
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const [row] = await db
    .select({ externalId: transactions.externalId })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "Transaction not found." };
  if (row.externalId) return { ok: false, error: "This row is bank-synced; the bank decides when it posts." };
  await db.update(transactions).set({ pending }).where(eq(transactions.id, id));
  revalidatePath(path);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { ok: true };
}

// The statement row for a pending charge has arrived as its own transaction: fold the
// hand-entered one into it so the charge counts once. The posted row keeps the bank's
// details and inherits the user's category, notes and links. See src/server/pending.ts.
export async function mergePendingTransaction(
  enteredId: number,
  postedId: number,
  path: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { mergeIntoPosted } = await import("@/server/pending");
  const res = await mergeIntoPosted(enteredId, postedId);
  if (res.ok) {
    revalidatePath(path);
    revalidatePath("/transactions");
    revalidatePath("/dashboard");
    revalidatePath("/months");
  }
  return res;
}

export async function deleteTransaction(id: number, path: string): Promise<void> {
  await requireSession();
  // A bank-synced row would be re-inserted by the next run while it is still inside the
  // re-query window, so deleting one leaves a tombstone the sync writer honours.
  const [row] = await db
    .select({ source: transactions.source, externalId: transactions.externalId })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (row?.externalId && !["import", "pdf", "manual"].includes(row.source)) {
    await db
      .insert(syncIgnored)
      .values({ source: row.source, externalId: row.externalId })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  await db.delete(transactions).where(eq(transactions.id, id));
  revalidatePath(path);
}

// Re-link any transactions that have no month to the period matching their date.
// Safety net for transactions imported before their month existed.
export async function resyncTransactionPeriods(): Promise<number> {
  await requireSession();
  const res = await db.execute(
    sql`UPDATE transactions t
        JOIN periods p ON YEAR(t.txn_date) = p.year AND MONTH(t.txn_date) = p.month
        SET t.period_id = p.id
        WHERE t.period_id IS NULL`,
  );
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/months");
  const header = (res as unknown as [{ affectedRows?: number }])[0];
  return header?.affectedRows ?? 0;
}

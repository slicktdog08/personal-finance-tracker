"use server";

import { db } from "@/server/db";
import {
  transactions,
  accounts,
  accountBalances,
  importBatches,
  categoryMappings,
  periods,
} from "@/server/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hashRows } from "@/server/lib/dedup";
import { findPendingMatches, findSyncedDuplicates } from "@/server/lib/sync/import-guard";
import { ensurePeriod } from "@/server/periods";
import { dateToYearMonth } from "@/server/lib/period";
import { categorize, type CategoryRule } from "@/server/lib/categorize";
import { TXN_CATEGORIES } from "@/constants/enums";
import { parseRows, guessMapping, extract, buildBalanceSnapshots, last4 } from "@/server/lib/import-map";
import type {
  PreviewResult,
  PreviewRow,
  BalanceSnapshot,
  CommitResult,
  ColumnMapping,
  InspectResult,
} from "@/server/lib/import-types";
import { requireSession } from "@/server/auth/session";
import { attachPendingMatches, mergeIntoPosted, settledNotes } from "@/server/pending";

const KNOWN_CATS = new Set(TXN_CATEGORIES.map((c) => c.toLowerCase()));

export async function inspectCsv(csvText: string): Promise<InspectResult> {
  await requireSession();
  const { headers, rows } = parseRows(csvText);
  const sample = rows.slice(0, 5);
  const suggestion = guessMapping(headers, sample);

  // If an Account/Card column resolves to a single account across the whole file, preselect
  // that account (fixed mode) — nicer for single-account exports. The client dropdown will
  // auto-select the matching account if it already exists; the user can still change it or
  // switch back to per-row "From a column". Multiple distinct values → leave it column-mode.
  if (suggestion.accountMode === "column" && suggestion.accountColumn) {
    const col = suggestion.accountColumn;
    const values = new Set(rows.map((r) => last4((r[col] ?? "").trim())).filter(Boolean));
    if (values.size === 1) {
      suggestion.accountMode = "fixed";
      suggestion.fixedAccountNumber = [...values][0];
    }
  }

  return { headers, sample, rowCount: rows.length, suggestion };
}

export async function analyzeWithMapping(
  csvText: string,
  filename: string,
  mapping: ColumnMapping,
): Promise<PreviewResult> {
  await requireSession();
  const { rows: rawRows } = parseRows(csvText);
  const mapped = rawRows.map((r) => extract(r, mapping));

  const validIdx: number[] = [];
  mapped.forEach((mm, i) => {
    if (mm.dateIso && mm.amount != null) validIdx.push(i);
  });
  const hashes = hashRows(
    validIdx.map((i) => ({
      accountNumber: mapped[i].accountNumber,
      date: mapped[i].dateIso!,
      amount: mapped[i].amount!,
      description: mapped[i].description,
      direction: mapped[i].direction,
    })),
  );
  const hashByIdx = new Map<number, string>();
  validIdx.forEach((i, k) => hashByIdx.set(i, hashes[k]));

  const ruleRows = await db.select().from(categoryMappings);
  const rules: CategoryRule[] = ruleRows.map((r) => ({
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    category: r.category,
    billId: r.billId,
    priority: r.priority,
  }));

  const allHashes = [...hashByIdx.values()];
  const existing = allHashes.length
    ? await db
        .select({ h: transactions.dedupHash })
        .from(transactions)
        .where(inArray(transactions.dedupHash, allHashes))
    : [];
  const existingSet = new Set(existing.map((e) => e.h));
  // Money-based checks run in order and each skips rows the earlier ones already claimed,
  // so a row that is a plain duplicate can't consume the match a later genuine row needs:
  //  1. content hash (above) → 2. synced twin (bank sync, different hash) → 3. pending
  //  placeholder entered by hand (settled on commit).
  const candidates = validIdx.map((i) => ({
    accountNumber: mapped[i].accountNumber,
    date: mapped[i].dateIso!,
    amount: mapped[i].amount!,
    direction: mapped[i].direction,
  }));
  const hashDupeK = new Set(validIdx.map((i, k) => (existingSet.has(hashByIdx.get(i)!) ? k : -1)).filter((k) => k >= 0));
  const syncedDupes = await findSyncedDuplicates(candidates, hashDupeK);
  const syncedDupeIdx = new Set(validIdx.filter((_, k) => syncedDupes.has(k)));
  const pendingMatches = await findPendingMatches(candidates, new Set([...hashDupeK, ...syncedDupes.keys()]));
  const pendingByIdx = new Map(validIdx.map((i, k) => [i, pendingMatches.get(k)] as const));

  const rows: PreviewRow[] = mapped.map((mm, i) => {
    if (!mm.dateIso || mm.amount == null) {
      return {
        dedupHash: "",
        txnDate: mm.dateIso ?? "",
        description: mm.description,
        accountNumber: mm.accountNumber,
        category: null,
        categoryRuleId: null,
        amount: mm.amount,
        netAmount: mm.netAmount,
        direction: mm.direction,
        status: "error",
        error: !mm.dateIso ? "Unparseable date" : "Missing/!number amount",
        raw: mm.raw,
      };
    }
    const hash = hashByIdx.get(i)!;
    const cat = categorize({ description: mm.description, rawCategory: mm.rawCategory }, rules);
    const category =
      cat.matchedRuleId != null
        ? cat.category
        : mm.rawCategory && KNOWN_CATS.has(mm.rawCategory.toLowerCase())
          ? mm.rawCategory
          : null;
    const isDupe = existingSet.has(hash) || syncedDupeIdx.has(i);
    const pend = isDupe ? undefined : pendingByIdx.get(i);
    return {
      dedupHash: hash,
      txnDate: mm.dateIso,
      description: mm.description,
      accountNumber: mm.accountNumber,
      category,
      categoryRuleId: cat.matchedRuleId,
      amount: mm.amount,
      netAmount: mm.netAmount,
      direction: mm.direction,
      status: isDupe ? "duplicate" : pend ? "finalizes" : "new",
      pendingMatchId: pend?.id ?? null,
      pendingMatchDescription: pend?.description ?? null,
      pendingMatchCategory: pend?.category ?? null,
      raw: mm.raw,
    };
  });

  // Hand-entered (pending) transactions this file is the posted version of.
  await attachPendingMatches(rows);

  return {
    filename,
    rows,
    total: rows.length,
    newCount: rows.filter((r) => r.status === "new").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
    finalizeCount: rows.filter((r) => r.status === "finalizes").length,
    errorCount: rows.filter((r) => r.status === "error").length,
    balances: mapping.balanceColumn ? buildBalanceSnapshots(mapped) : [],
  };
}

export async function commitImport(
  filename: string,
  rows: PreviewRow[],
  balances: BalanceSnapshot[] = [],
  // transactions.source for the new rows: "import" (CSV) or "pdf".
  source: "import" | "pdf" = "import",
): Promise<CommitResult> {
  await requireSession();
  const toInsert = rows.filter((r) => r.status === "new" && r.dedupHash);
  const toFinalize = rows.filter((r) => r.status === "finalizes" && r.dedupHash && r.pendingMatchId != null);
  const duplicates = rows.filter((r) => r.status === "duplicate").length;
  const errors = rows.filter((r) => r.status === "error").length;
  // Nothing at all to do — nothing to insert, nothing to settle, no balance snapshots.
  // `toFinalize` belongs in this guard: a statement whose only row settles a pending
  // placeholder has an empty `toInsert`, and leaving it out returned early and silently
  // skipped the settle loop below.
  if (!toInsert.length && !toFinalize.length && !balances.length) {
    return { inserted: 0, duplicates, finalized: 0, errors, batchId: null, balancesRecorded: 0, merged: 0 };
  }

  // Every account referenced by a new transaction OR a balance snapshot must exist first.
  const acctNums = [
    ...new Set([...toInsert, ...toFinalize, ...balances].map((r) => r.accountNumber).filter(Boolean)),
  ];
  if (acctNums.length) {
    await db
      .insert(accounts)
      .values(acctNums.map((n) => ({ accountNumber: n })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  const acctRows = await db.select().from(accounts);
  const acctMap = new Map(acctRows.map((a) => [a.accountNumber, a.id]));

  // Record dated balance snapshots into the account_balances ledger. Idempotent per
  // (account, as-of date) — re-importing the same file won't pile up duplicate rows.
  let balancesRecorded = 0;
  for (const b of balances) {
    const acctId = acctMap.get(b.accountNumber);
    if (!acctId) continue;
    const existing = await db
      .select({ id: accountBalances.id })
      .from(accountBalances)
      .where(and(eq(accountBalances.accountId, acctId), eq(accountBalances.asOf, b.asOf)))
      .limit(1);
    if (existing.length) continue;
    await db.insert(accountBalances).values({
      accountId: acctId,
      balance: String(b.balance),
      asOf: b.asOf,
      note: b.note ?? `Imported from ${filename}`,
    });
    balancesRecorded++;
  }

  if (!toInsert.length && !toFinalize.length) {
    if (balancesRecorded) {
      revalidatePath("/accounts");
      revalidatePath("/debts");
      revalidatePath("/dashboard");
      revalidatePath("/import");
    }
    return { inserted: 0, duplicates, finalized: 0, errors, batchId: null, balancesRecorded, merged: 0 };
  }

  const periodRows = await db
    .select({ id: periods.id, year: periods.year, month: periods.month })
    .from(periods);
  const periodMap = new Map(periodRows.map((p) => [`${p.year}-${p.month}`, p.id]));

  await db.insert(importBatches).values({
    filename,
    totalRows: rows.length,
    insertedCount: toInsert.length + toFinalize.length,
    duplicateCount: duplicates,
    errorCount: errors,
  });
  const batchRow = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .orderBy(sql`${importBatches.id} DESC`)
    .limit(1);
  const batchId = batchRow[0]?.id ?? null;

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    await db
      .insert(transactions)
      .values(
        chunk.map((r) => {
          const ym = dateToYearMonth(r.txnDate);
          return {
            accountId: r.accountNumber ? acctMap.get(r.accountNumber) ?? null : null,
            periodId: ym ? periodMap.get(`${ym.year}-${ym.month}`) ?? null : null,
            txnDate: r.txnDate,
            description: r.description.slice(0, 512),
            notes: (r.notes ?? "").trim() || null,
            category: r.category,
            categoryRuleId: r.category ? r.categoryRuleId ?? null : null,
            amount: String(r.amount),
            netAmount: r.netAmount == null ? null : String(r.netAmount),
            direction: r.direction,
            dedupHash: r.dedupHash,
            importBatchId: batchId,
            raw: r.raw,
            source,
          };
        }),
      )
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
    inserted += chunk.length;
  }

  // Settle pending rows the preview matched unambiguously. The pending row is updated in place,
  // so everything the user added to it stays — category, notes, bill link, transfer partner,
  // cash offsets, split — and what they called the charge moves into notes when it differs
  // from the bank's name. The statement supplies the bank's facts: the description (the
  // title), the settled amount, the posting date (and so the month), and the bookkeeping that
  // makes a re-import of the same statement a no-op (dedup hash, batch, raw, source).
  // If the row was already settled or deleted since the preview, the import row is inserted
  // instead.
  //
  // This is the automatic half of settling. The `mergeWith` loop below is the other half —
  // fuzzier candidates the user confirmed in the preview. They never overlap: a row matched
  // here is status "finalizes", and attachPendingMatches only offers `mergeWith` on "new" rows.
  let finalized = 0;
  for (const r of toFinalize) {
    const ym = dateToYearMonth(r.txnDate);
    // The posted date may land in a month with no sheet yet (typed 9/29, posts 10/1):
    // create it, like editing a transaction's date does, so the row never vanishes from
    // the month views. Inserted rows keep the lazy `null → adopted later` behaviour.
    let periodId = ym ? (periodMap.get(`${ym.year}-${ym.month}`) ?? null) : null;
    if (ym && periodId == null) {
      periodId = await ensurePeriod(ym.year, ym.month);
      periodMap.set(`${ym.year}-${ym.month}`, periodId);
    }
    const [placeholder] = await db
      .select({
        id: transactions.id,
        description: transactions.description,
        category: transactions.category,
        categoryRuleId: transactions.categoryRuleId,
        notes: transactions.notes,
        pending: transactions.pending,
      })
      .from(transactions)
      .where(eq(transactions.id, r.pendingMatchId!))
      .limit(1);
    const base = {
      accountId: r.accountNumber ? (acctMap.get(r.accountNumber) ?? null) : null,
      periodId,
      txnDate: r.txnDate,
      description: r.description.slice(0, 512),
      amount: String(r.amount),
      netAmount: r.netAmount == null ? null : String(r.netAmount),
      direction: r.direction,
      dedupHash: r.dedupHash,
      importBatchId: batchId,
      raw: r.raw,
      source,
      pending: false,
    };
    if (placeholder && placeholder.pending) {
      // The user's category stays unless they picked another one in the preview; a pending
      // row with no category takes whatever the import found for it.
      const cat =
        r.categoryPicked || !placeholder.category
          ? { category: r.category, categoryRuleId: r.category ? (r.categoryRuleId ?? null) : null }
          : { category: placeholder.category, categoryRuleId: placeholder.categoryRuleId };
      await db
        .update(transactions)
        .set({ ...base, ...cat, notes: settledNotes(r.description, placeholder, r.notes) })
        .where(eq(transactions.id, placeholder.id));
      finalized++;
    } else {
      await db
        .insert(transactions)
        .values({
          ...base,
          notes: (r.notes ?? "").trim() || null,
          category: r.category,
          categoryRuleId: r.category ? (r.categoryRuleId ?? null) : null,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      inserted++;
    }
  }

  // Fold each hand-entered (pending) transaction the user chose to merge into the row that
  // just posted for it, so the charge isn't in the list twice. Each hand-entered row can only
  // be merged once — a second claim on it (two statements in one PDF batch) is skipped.
  let merged = 0;
  const toMerge = toInsert.filter((r) => r.mergeWith != null);
  if (toMerge.length) {
    const ids = await db
      .select({ id: transactions.id, h: transactions.dedupHash })
      .from(transactions)
      .where(inArray(transactions.dedupHash, toMerge.map((r) => r.dedupHash)));
    const idByHash = new Map(ids.map((x) => [x.h, x.id]));
    const done = new Set<number>();
    for (const r of toMerge) {
      const postedId = idByHash.get(r.dedupHash);
      if (postedId == null || done.has(r.mergeWith!)) continue;
      const res = await mergeIntoPosted(r.mergeWith!, postedId, { keepPostedCategory: !!r.categoryPicked });
      if (res.ok) {
        merged++;
        done.add(r.mergeWith!);
      }
    }
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/import");
  if (balancesRecorded) {
    revalidatePath("/accounts");
    revalidatePath("/debts");
  }
  return {
    inserted,
    duplicates,
    finalized,
    errors,
    batchId,
    balancesRecorded,
    merged,
  };
}

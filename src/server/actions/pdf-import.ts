"use server";

import { db } from "@/server/db";
import { transactions, accounts, accountBalances, categoryMappings } from "@/server/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hashRows } from "@/server/lib/dedup";
import { findPendingMatches, findSyncedDuplicates } from "@/server/lib/sync/import-guard";
import { categorize, type CategoryRule } from "@/server/lib/categorize";
import { commitImport } from "@/server/actions/import";
import { extractPdf } from "@/server/lib/pdf/extract";
import { detectAndParse } from "@/server/lib/pdf/registry";
import { prettyPeriod, dateToYearMonth } from "@/server/lib/period";
import type { PreviewRow } from "@/server/lib/import-types";
import type {
  ParsedStatement,
  ParsedTxn,
  PdfFileInput,
  CommitStatementInput,
  PdfCommitResult,
  StatementBalance,
} from "@/server/lib/pdf/types";
import { requireSession } from "@/server/auth/session";
import { attachPendingMatches } from "@/server/pending";

async function loadRules(): Promise<CategoryRule[]> {
  const ruleRows = await db.select().from(categoryMappings);
  return ruleRows.map((r) => ({
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    category: r.category,
    billId: r.billId,
    priority: r.priority,
  }));
}

// Build dedup-aware, category-aware preview rows for one statement's transactions and a
// chosen account. Mirrors the CSV analyze in actions/import.ts so both paths dedup and
// categorize identically.
async function analyzeRows(
  txns: ParsedTxn[],
  accountNumber: string,
  rules: CategoryRule[],
): Promise<{
  rows: PreviewRow[];
  total: number;
  newCount: number;
  duplicateCount: number;
  finalizeCount: number;
  errorCount: number;
}> {
  const valid = txns.filter((t) => t.dateIso && t.amount != null);
  const hashes = hashRows(
    valid.map((t) => ({
      accountNumber,
      date: t.dateIso!,
      amount: t.amount!,
      description: t.description,
      direction: t.direction,
    })),
  );
  const existing = hashes.length
    ? await db
        .select({ h: transactions.dedupHash })
        .from(transactions)
        .where(inArray(transactions.dedupHash, hashes))
    : [];
  const existingSet = new Set(existing.map((e) => e.h));
  // Same ordering as the CSV analyzer: hash duplicates → synced twins → pending placeholders,
  // each skipping rows the earlier checks already claimed.
  const candidates = valid.map((t) => ({ accountNumber, date: t.dateIso!, amount: t.amount!, direction: t.direction }));
  const hashDupeK = new Set(hashes.map((h, k) => (existingSet.has(h) ? k : -1)).filter((k) => k >= 0));
  const syncedDupes = await findSyncedDuplicates(candidates, hashDupeK);
  const pendingMatches = await findPendingMatches(candidates, new Set([...hashDupeK, ...syncedDupes.keys()]));

  let vi = 0;
  const rows: PreviewRow[] = txns.map((t) => {
    if (!t.dateIso || t.amount == null) {
      return {
        dedupHash: "",
        txnDate: t.dateIso ?? "",
        description: t.description,
        accountNumber,
        category: null,
        categoryRuleId: null,
        amount: t.amount,
        netAmount: null,
        direction: t.direction,
        status: "error",
        error: !t.dateIso ? "Unparseable date" : "Missing amount",
        raw: t.raw,
      };
    }
    const k = vi++;
    const hash = hashes[k];
    const cat = categorize({ description: t.description, rawCategory: "" }, rules);
    const net = t.direction === "Credit" ? t.amount : -t.amount;
    return {
      dedupHash: hash,
      txnDate: t.dateIso,
      description: t.description,
      accountNumber,
      category: cat.matchedRuleId != null ? cat.category : null,
      categoryRuleId: cat.matchedRuleId,
      amount: t.amount,
      netAmount: net,
      direction: t.direction,
      status: existingSet.has(hash) || syncedDupes.has(k) ? "duplicate" : pendingMatches.has(k) ? "finalizes" : "new",
      pendingMatchId: existingSet.has(hash) || syncedDupes.has(k) ? null : (pendingMatches.get(k)?.id ?? null),
      pendingMatchDescription: existingSet.has(hash) || syncedDupes.has(k) ? null : (pendingMatches.get(k)?.description ?? null),
      pendingMatchCategory: existingSet.has(hash) || syncedDupes.has(k) ? null : (pendingMatches.get(k)?.category ?? null),
      raw: t.raw,
    };
  });

  // Hand-entered (pending) transactions this statement is the posted version of.
  await attachPendingMatches(rows);

  return {
    rows,
    total: rows.length,
    newCount: rows.filter((r) => r.status === "new").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
    finalizeCount: rows.filter((r) => r.status === "finalizes").length,
    errorCount: rows.filter((r) => r.status === "error").length,
  };
}

function buildBalanceSuggestions(
  institution: string | null,
  opening: number | null,
  closing: number | null,
  periodStart: string | null,
  periodEnd: string | null,
  firstTxnDate: string | null,
  lastTxnDate: string | null,
): StatementBalance[] {
  const inst = institution ?? "Statement";
  const periodLabel = (asOf: string) => {
    const ym = dateToYearMonth(asOf);
    return ym ? ` (${prettyPeriod(ym.year, ym.month)})` : "";
  };
  const out: StatementBalance[] = [];
  const openAsOf = periodStart ?? firstTxnDate;
  if (opening != null && openAsOf) {
    out.push({
      kind: "opening",
      balance: opening,
      asOf: openAsOf,
      creditLimit: null,
      note: `${inst} opening balance${periodLabel(openAsOf)}`,
    });
  }
  const closeAsOf = periodEnd ?? lastTxnDate;
  if (closing != null && closeAsOf) {
    out.push({
      kind: "closing",
      balance: closing,
      asOf: closeAsOf,
      creditLimit: null,
      note: `${inst} closing balance${periodLabel(closeAsOf)}`,
    });
  }
  return out;
}

export async function parsePdfStatements(files: PdfFileInput[]): Promise<ParsedStatement[]> {
  await requireSession();
  const rules = await loadRules();
  const out: ParsedStatement[] = [];

  for (const f of files) {
    const bytes = new Uint8Array(Buffer.from(f.dataB64, "base64"));
    let extracted;
    try {
      extracted = await extractPdf(bytes);
    } catch (e) {
      out.push(unrecognized(f.name, [], 0, [`Could not read PDF: ${e instanceof Error ? e.message : String(e)}`]));
      continue;
    }

    const { parser, result } = detectAndParse(extracted.lines, extracted.text);
    if (!parser || !result) {
      out.push(
        unrecognized(f.name, extracted.lines.slice(0, 12), extracted.pageCount, [
          "Unrecognized statement format — no parser matched.",
        ]),
      );
      continue;
    }

    const m = result.meta;
    const analyzed = await analyzeRows(result.txns, m.accountNumber, rules);
    const txnDates = result.txns
      .map((t) => t.dateIso)
      .filter((d): d is string => !!d)
      .sort();
    const firstTxnDate = txnDates[0] ?? null;
    const lastTxnDate = txnDates[txnDates.length - 1] ?? null;

    out.push({
      filename: f.name,
      parserId: parser.id,
      parserLabel: parser.label,
      detected: true,
      pageCount: extracted.pageCount,
      lineCount: extracted.lines.length,
      accountNumber: m.accountNumber,
      institution: m.institution,
      accountType: m.accountType,
      openingBalance: m.openingBalance,
      closingBalance: m.closingBalance,
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      txns: result.txns,
      ...analyzed,
      balanceSuggestions: buildBalanceSuggestions(
        m.institution,
        m.openingBalance,
        m.closingBalance,
        m.periodStart,
        m.periodEnd,
        firstTxnDate,
        lastTxnDate,
      ),
      notes: result.notes,
      sampleLines: extracted.lines.slice(0, 12),
    });
  }

  return out;
}

function unrecognized(
  filename: string,
  sampleLines: string[],
  pageCount: number,
  notes: string[],
): ParsedStatement {
  return {
    filename,
    parserId: null,
    parserLabel: "Unrecognized",
    detected: false,
    pageCount,
    lineCount: sampleLines.length,
    accountNumber: "",
    institution: null,
    accountType: null,
    openingBalance: null,
    closingBalance: null,
    periodStart: null,
    periodEnd: null,
    txns: [],
    rows: [],
    total: 0,
    newCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    balanceSuggestions: [],
    notes,
    sampleLines,
  };
}

// Re-run analysis when the user changes the account for a statement (dedup hashes
// depend on the account, so duplicate detection must be recomputed).
export async function analyzeStatement(input: {
  txns: ParsedTxn[];
  accountNumber: string;
}): Promise<{
  rows: PreviewRow[];
  total: number;
  newCount: number;
  duplicateCount: number;
  finalizeCount: number;
  errorCount: number;
}> {
  await requireSession();
  const rules = await loadRules();
  return analyzeRows(input.txns, input.accountNumber, rules);
}

export async function commitPdfStatements(
  statements: CommitStatementInput[],
): Promise<PdfCommitResult> {
  await requireSession();
  let inserted = 0;
  let duplicates = 0;
  let finalized = 0;
  let errors = 0;
  let balancesRecorded = 0;
  let merged = 0;

  // Ensure every referenced account exists (covers balance-only statements too).
  const acctNums = [...new Set(statements.map((s) => s.accountNumber).filter(Boolean))];
  if (acctNums.length) {
    await db
      .insert(accounts)
      .values(acctNums.map((n) => ({ accountNumber: n })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  const acctRows = await db.select().from(accounts);
  const acctMap = new Map(acctRows.map((a) => [a.accountNumber, a.id]));

  // Stamp institution/type on accounts that don't have them yet (best-effort enrichment).
  for (const s of statements) {
    const id = s.accountNumber ? acctMap.get(s.accountNumber) : undefined;
    if (!id) continue;
    const cur = acctRows.find((a) => a.id === id);
    const patch: Record<string, unknown> = {};
    if (cur && !cur.institution && s.institution) patch.institution = s.institution;
    if (cur && !cur.accountType && s.accountType) patch.accountType = s.accountType;
    if (Object.keys(patch).length) {
      await db.update(accounts).set(patch).where(eq(accounts.id, id));
    }
  }

  // Occurrence indexes in dedupHash are assigned per-statement, so the SAME transaction
  // appearing in two statements committed together (same file twice, or overlapping
  // periods) would otherwise be counted as two inserts. Track hashes across the whole
  // batch and fold cross-statement repeats into the duplicate count.
  const seenHashes = new Set<string>();

  for (const s of statements) {
    // Rows already carry the chosen account (the client re-analyzes on account change),
    // but stamp it again defensively so account linking is consistent.
    const rows: PreviewRow[] = [];
    for (const r of s.rows) {
      const row = { ...r, accountNumber: s.accountNumber };
      if ((row.status === "new" || row.status === "finalizes") && row.dedupHash) {
        if (seenHashes.has(row.dedupHash)) {
          duplicates++;
          continue;
        }
        seenHashes.add(row.dedupHash);
      }
      rows.push(row);
    }
    if (rows.length) {
      const res = await commitImport(s.filename, rows, [], "pdf");
      inserted += res.inserted;
      duplicates += res.duplicates;
      finalized += res.finalized;
      errors += res.errors;
      merged += res.merged;
    }
    const acctId = s.accountNumber ? acctMap.get(s.accountNumber) : undefined;
    if (acctId) {
      for (const bal of s.balances) {
        // Idempotent: don't re-record a snapshot for the same account + as-of date
        // (re-uploading the same statement shouldn't pile up duplicate balance rows).
        const existing = await db
          .select({ id: accountBalances.id })
          .from(accountBalances)
          .where(and(eq(accountBalances.accountId, acctId), eq(accountBalances.asOf, bal.asOf)))
          .limit(1);
        if (existing.length === 0) {
          await db.insert(accountBalances).values({
            accountId: acctId,
            balance: String(bal.balance),
            creditLimit: bal.creditLimit == null ? null : String(bal.creditLimit),
            asOf: bal.asOf,
            note: bal.note || null,
          });
          balancesRecorded++;
        }
      }
    }
  }

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/import");
  return { statements: statements.length, inserted, duplicates, finalized, errors, balancesRecorded, merged };
}

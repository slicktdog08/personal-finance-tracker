"use server";

import { db } from "@/server/db";
import { transactions, accounts, accountBalances, investmentPositions, investmentTrades } from "@/server/db/schema";
import { positionRows, tradeRows } from "@/server/lib/pdf/investments";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hashRows } from "@/server/lib/dedup";
import { findPendingMatches, findSyncedDuplicates } from "@/server/lib/sync/import-guard";
import { categorize, type CategoryRule } from "@/server/lib/categorize";
import { loadRules } from "@/server/lib/rules";
import { accountIdsByNumber, ensureAccounts } from "@/server/lib/account-aliases";
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
import { dayBefore, planBalanceWrites, statementPoints } from "@/server/lib/pdf/balances";
import { attachPendingMatches } from "@/server/pending";

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
  const accountId = (await accountIdsByNumber()).get(accountNumber) ?? null;
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
    const cat = categorize(
      { description: t.description, rawCategory: "", accountId, amount: t.amount, direction: t.direction },
      rules,
    );
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
  creditLimit: number | null = null,
  // What a loan statement adds to its closing snapshot: the rate, the payment, a note suffix.
  extra: { apr?: number | null; minPayment?: number | null; detail?: string | null } = {},
): StatementBalance[] {
  const inst = institution ?? "Statement";
  const periodLabel = (asOf: string) => {
    const ym = dateToYearMonth(asOf);
    return ym ? ` (${prettyPeriod(ym.year, ym.month)})` : "";
  };
  const out: StatementBalance[] = [];
  // The opening balance is the balance at the end of the day before the period starts.
  const openAsOf = periodStart ? dayBefore(periodStart) : firstTxnDate;
  if (opening != null && openAsOf) {
    out.push({
      kind: "opening",
      balance: opening,
      asOf: openAsOf,
      creditLimit: null,
      note: `${inst} opening balance${periodLabel(periodStart ?? openAsOf)}`,
    });
  }
  const closeAsOf = periodEnd ?? lastTxnDate;
  if (closing != null && closeAsOf) {
    out.push({
      kind: "closing",
      balance: closing,
      asOf: closeAsOf,
      // The printed limit is the one in force at the close; the opening snapshot stays without.
      creditLimit,
      apr: extra.apr ?? null,
      minPayment: extra.minPayment ?? null,
      note: `${inst} closing balance${periodLabel(closeAsOf)}${extra.detail ? ` — ${extra.detail}` : ""}`,
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

    const { parser, results } = detectAndParse(extracted.lines, extracted.text, extracted.items);
    if (!parser || results.length === 0) {
      out.push(
        unrecognized(f.name, extracted.lines.slice(0, 12), extracted.pageCount, [
          parser ? `${parser.label}: no accounts found in this statement.` : "Unrecognized statement format — no parser matched.",
        ]),
      );
      continue;
    }

    // One reviewable statement per account the PDF covers.
    for (const result of results) {
      const m = result.meta;
      const analyzed = await analyzeRows(result.txns, m.accountNumber, rules);
      const txnDates = result.txns
        .map((t) => t.dateIso)
        .filter((d): d is string => !!d)
        .sort();
      const firstTxnDate = txnDates[0] ?? null;
      const lastTxnDate = txnDates[txnDates.length - 1] ?? null;
      const net = result.txns.reduce((n, t) => n + (t.direction === "Credit" ? 1 : -1) * (t.amount ?? 0), 0);
      const reconciled =
        result.reconciled !== undefined
          ? result.reconciled
          : m.openingBalance != null && m.closingBalance != null
            ? Math.abs(m.openingBalance + net - m.closingBalance) < 0.005
            : null;

      out.push({
        filename: f.name,
        parserId: parser.id,
        parserLabel: parser.label,
        detected: true,
        pageCount: extracted.pageCount,
        lineCount: extracted.lines.length,
        accountNumber: m.accountNumber,
        accountLabel: m.accountLabel ?? null,
        institution: m.institution,
        accountType: m.accountType,
        openingBalance: m.openingBalance,
        closingBalance: m.closingBalance,
        periodStart: m.periodStart,
        periodEnd: m.periodEnd,
        txns: result.txns,
        ...analyzed,
        balanceSuggestions: buildBalanceSuggestions(
          [m.institution, m.accountLabel].filter(Boolean).join(" ") || null,
          m.openingBalance,
          m.closingBalance,
          m.periodStart,
          m.periodEnd,
          firstTxnDate,
          lastTxnDate,
          m.creditLimit ?? null,
          { apr: m.apr, minPayment: m.minPayment, detail: m.balanceDetail },
        ),
        trades: result.trades ?? [],
        positions: result.positions ?? null,
        dailyBalances: result.dailyBalances ?? [],
        reconciled,
        notes: result.notes,
        sampleLines: extracted.lines.slice(0, 12),
      });
    }
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
    accountLabel: null,
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
    trades: [],
    positions: null,
    dailyBalances: [],
    reconciled: null,
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
  let billsLinked = 0;
  let tradesRecorded = 0;
  let positionsRecorded = 0;

  // Ensure every referenced account exists (covers balance-only statements too).
  const acctNums = [...new Set(statements.map((s) => s.accountNumber).filter(Boolean))];
  // A former number of a merged account resolves to that account rather than making a new one.
  const acctMap = await ensureAccounts(acctNums);
  const acctRows = await db.select().from(accounts);

  // Stamp institution/type on accounts that don't have them yet (best-effort enrichment).
  for (const s of statements) {
    const id = s.accountNumber ? acctMap.get(s.accountNumber) : undefined;
    if (!id) continue;
    const cur = acctRows.find((a) => a.id === id);
    const patch: Record<string, unknown> = {};
    if (cur && !cur.institution && s.institution) patch.institution = s.institution;
    if (cur && !cur.accountType && s.accountType) patch.accountType = s.accountType;
    if (cur && !cur.label && s.accountLabel) patch.label = s.accountLabel.slice(0, 64);
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
      billsLinked += res.billsLinked;
    }
    const acctId = s.accountNumber ? acctMap.get(s.accountNumber) : undefined;
    if (acctId) {
      // Holdings movements: their own ledger, deduplicated by hash so re-importing a statement
      // (or its corrected reissue) adds nothing.
      const tRows = tradeRows(s.trades ?? [], s.accountNumber, acctId);
      for (let k = 0; k < tRows.length; k += 500) {
        const chunk = tRows.slice(k, k + 500);
        const had = await db
          .select({ h: investmentTrades.dedupHash })
          .from(investmentTrades)
          .where(inArray(investmentTrades.dedupHash, chunk.map((r) => r.dedupHash)));
        const known = new Set(had.map((r) => r.h));
        const fresh = chunk.filter((r) => !known.has(r.dedupHash));
        if (fresh.length) {
          await db.insert(investmentTrades).values(fresh).onDuplicateKeyUpdate({ set: { id: sql`id` } });
          tradesRecorded += fresh.length;
        }
      }
      // Holdings at the close: one snapshot per account + date, replaced whole so a re-import
      // refreshes it. A statement listing nothing still clears the date — the account was empty.
      if (s.positionsAsOf && s.positions) {
        const asOf = s.positionsAsOf;
        const pRows = positionRows(s.positions, asOf, acctId);
        await db.transaction(async (tx) => {
          await tx
            .delete(investmentPositions)
            .where(and(eq(investmentPositions.accountId, acctId), eq(investmentPositions.asOf, asOf)));
          if (pRows.length) await tx.insert(investmentPositions).values(pRows);
        });
        positionsRecorded += pRows.length;
      }
      const name = [s.institution, s.accountLabel].filter(Boolean).join(" ") || "Statement";
      const points = statementPoints(s.balances, s.dailyBalances ?? [], `${name} end-of-day balance`);
      if (points.length) {
        // One snapshot per account + date: re-uploading a statement refreshes its own rows and
        // never piles up duplicates or overwrites a balance entered by hand.
        const existing = await db
          .select({
            id: accountBalances.id,
            asOf: accountBalances.asOf,
            balance: accountBalances.balance,
            source: accountBalances.source,
          })
          .from(accountBalances)
          .where(
            and(
              eq(accountBalances.accountId, acctId),
              inArray(accountBalances.asOf, points.map((p) => p.asOf)),
            ),
          );
        const plan = planBalanceWrites(
          points,
          existing.map((e) => ({ ...e, balance: Number(e.balance) })),
        );
        for (let k = 0; k < plan.inserts.length; k += 500) {
          await db.insert(accountBalances).values(
            plan.inserts.slice(k, k + 500).map((p) => ({
              accountId: acctId,
              balance: p.balance.toFixed(2),
              creditLimit: p.creditLimit == null ? null : p.creditLimit.toFixed(2),
              apr: p.apr == null ? null : p.apr.toFixed(2),
              minPayment: p.minPayment == null ? null : p.minPayment.toFixed(2),
              asOf: p.asOf,
              note: p.note,
              source: p.source,
            })),
          );
        }
        for (const u of plan.updates) {
          await db
            .update(accountBalances)
            .set({
              balance: u.point.balance.toFixed(2),
              note: u.point.note,
              source: u.point.source,
              // Only when the statement prints them — a refresh never blanks a known rate.
              ...(u.point.apr != null && { apr: u.point.apr.toFixed(2) }),
              ...(u.point.minPayment != null && { minPayment: u.point.minPayment.toFixed(2) }),
            })
            .where(eq(accountBalances.id, u.id));
        }
        balancesRecorded += plan.inserts.length + plan.updates.length;
      }
    }
  }

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/import");
  return {
    statements: statements.length,
    inserted,
    duplicates,
    finalized,
    errors,
    balancesRecorded,
    merged,
    billsLinked,
    tradesRecorded,
    positionsRecorded,
  };
}

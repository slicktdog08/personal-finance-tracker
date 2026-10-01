/**
 * One-time (idempotent) loader for the Notion export in ../notion_data.
 * Run: npx tsx scripts/seed-history.ts
 *
 * Safe to re-run: accounts/bills/periods upsert on their unique keys, a period's
 * bill instances are only inserted if that period has none yet, and transactions
 * insert by unique dedup_hash so duplicates are skipped. See planning/design/04-migration-and-seed.md.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import Papa from "papaparse";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql, inArray } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import { periods, bills, accounts, billInstances, transactions } from "../src/server/db/schema";
import { parseMoney } from "../src/server/lib/money";
import { hashRows } from "../src/server/lib/dedup";
import { parseDbUrl } from "../src/server/lib/db-url";
import {
  parseFolderPeriod,
  periodLabel,
  monthBounds,
  parseDateToIso,
  dateToYearMonth,
} from "../src/server/lib/period";

const DATA_DIR = join(process.cwd(), "notion_data");
// Account last-4s to create even if no exported transaction mentions them (e.g. an account
// with no activity yet). Comma-separated, e.g. SEED_KNOWN_ACCOUNTS=1234,5678. When unset,
// accounts are derived purely from the account numbers seen in the transaction exports.
const KNOWN_ACCOUNTS = (process.env.SEED_KNOWN_ACCOUNTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Conservative merges where two months clearly mean the same recurring bill. Add your own
// entries when the same bill was named differently across months, e.g.
//   "Example Card Credit Card": "Example Card",
const NAME_ALIASES: Record<string, string> = {};
const canonical = (name: string) => (NAME_ALIASES[name.trim()] ?? name.trim());

// ---- CSV helpers -------------------------------------------------------------
function parseCsv(path: string): Record<string, string>[] {
  const content = readFileSync(path, "utf8").replace(/^﻿/, "");
  const out = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
  });
  return out.data.filter((r) => Object.values(r).some((v) => (v ?? "").trim() !== ""));
}

function field(row: Record<string, string>, ...candidates: string[]): string {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const k = keys.find((kk) => kk.trim().toLowerCase() === cand.toLowerCase());
    if (k) return (row[k] ?? "").trim();
  }
  // contains fallback
  for (const cand of candidates) {
    const k = keys.find((kk) => kk.trim().toLowerCase().includes(cand.toLowerCase()));
    if (k) return (row[k] ?? "").trim();
  }
  return "";
}

const yesNo = (v: string) => /^yes$/i.test(v.trim());
function dueDayOf(v: string): number | null {
  const n = parseInt(v.trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

// ---- Types -------------------------------------------------------------------
interface BillRow {
  name: string;
  amount: number | null;
  status: string;
  dueDay: number | null;
  paymentType: string | null;
  isDebt: boolean;
  isCancel: boolean;
  sortOrder: number;
}
interface TxRow {
  description: string;
  accountNumber: string;
  rawCategory: string;
  amount: number;
  netAmount: number | null;
  direction: string;
  dateIso: string;
  raw: Record<string, string>;
}
interface MonthData {
  year: number;
  month: number;
  billRows: BillRow[];
  txRows: TxRow[];
}

// ---- Walk the export ---------------------------------------------------------
function findBillCsv(yearDir: string, monthDir: string): string | null {
  const inside = readdirSync(monthDir).filter(
    (f) => /\.csv$/i.test(f) && (/^payments /i.test(f) || /^manual bills /i.test(f)),
  );
  if (inside.length) return join(monthDir, inside[0]);
  // 2024 style: sibling CSV next to the folder in the year dir
  const base = monthDir.split("/").pop()!;
  const sib = readdirSync(yearDir).filter(
    (f) => /\.csv$/i.test(f) && f.startsWith(base + " "),
  );
  return sib.length ? join(yearDir, sib[0]) : null;
}

function findTxCsv(monthDir: string): string | null {
  const t = readdirSync(monthDir).filter((f) => /\.csv$/i.test(f) && /^transactions /i.test(f));
  return t.length ? join(monthDir, t[0]) : null;
}

function collectMonths(): MonthData[] {
  const months: MonthData[] = [];
  const yearDirs = readdirSync(DATA_DIR).filter((d) => /Bills$/.test(d));
  for (const yd of yearDirs) {
    const yearDir = join(DATA_DIR, yd);
    for (const md of readdirSync(yearDir)) {
      const monthDir = join(yearDir, md);
      if (!statSync(monthDir).isDirectory()) continue;
      const per = parseFolderPeriod(md);
      if (!per) continue;

      const billRows: BillRow[] = [];
      const billCsv = findBillCsv(yearDir, monthDir);
      if (billCsv) {
        parseCsv(billCsv).forEach((r, i) => {
          const name = field(r, "Name");
          if (!name) return;
          const status = field(r, "Status") || "Unpaid";
          billRows.push({
            name,
            amount: parseMoney(field(r, "Amount")),
            status,
            dueDay: dueDayOf(field(r, "Due Date", "Monthly Due Date")),
            paymentType: field(r, "Payment Type") || null,
            isDebt: yesNo(field(r, "Debt")) || /^debt$/i.test(status),
            isCancel: yesNo(field(r, "Cancel")),
            sortOrder: i,
          });
        });
      }

      const txRows: TxRow[] = [];
      const txCsv = findTxCsv(monthDir);
      if (txCsv) {
        for (const r of parseCsv(txCsv)) {
          const dateIso = parseDateToIso(field(r, "Transaction Date", "Date"));
          const amount = parseMoney(field(r, "Transaction Amount"));
          if (!dateIso || amount == null) continue;
          txRows.push({
            description: field(r, "Transaction Description", "Description"),
            accountNumber: field(r, "Account Number", "Account"),
            rawCategory: field(r, "Category"),
            amount: Math.abs(amount),
            netAmount: parseMoney(field(r, "Net Transaction Amount")),
            direction: field(r, "Transaction Type", "Type") || "Debit",
            dateIso,
            raw: r,
          });
        }
      }
      months.push({ year: per.year, month: per.month, billRows, txRows });
    }
  }
  months.sort((a, b) => a.year - b.year || a.month - b.month);
  return months;
}

// ---- Main --------------------------------------------------------------------
async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url || url.includes("REPLACE_WITH_PASSWORD")) {
    console.error("✗ Set a real DATABASE_URL in .env.local first.");
    process.exit(1);
  }
  const pool = mysql.createPool(parseDbUrl(url));
  const db = drizzle(pool, { schema, mode: "default" });

  const months = collectMonths();
  console.log(`Found ${months.length} months in ${DATA_DIR}`);

  // 1) Accounts (known + any seen in transactions)
  const acctNums = new Set(KNOWN_ACCOUNTS);
  months.forEach((m) => m.txRows.forEach((t) => t.accountNumber && acctNums.add(t.accountNumber)));
  if (acctNums.size) {
    await db
      .insert(accounts)
      .values([...acctNums].map((n) => ({ accountNumber: n })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  const acctRows = await db.select().from(accounts);
  const acctMap = new Map(acctRows.map((a) => [a.accountNumber, a.id]));
  console.log(`Accounts: ${acctMap.size}`);

  // 2) Periods
  await db
    .insert(periods)
    .values(
      months.map((m) => {
        const { start, end } = monthBounds(m.year, m.month);
        return {
          year: m.year,
          month: m.month,
          label: periodLabel(m.year, m.month),
          startDate: start,
          endDate: end,
        };
      }),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const periodRows = await db.select().from(periods);
  const periodMap = new Map(periodRows.map((p) => [`${p.year}-${p.month}`, p.id]));
  console.log(`Periods: ${periodMap.size}`);

  // 3) Bills (recurring definitions) from all distinct canonical names
  const billDefs = new Map<
    string,
    { name: string; isDebt: boolean; amount: number | null; dueDay: number | null; pt: string | null }
  >();
  for (const m of months) {
    for (const b of m.billRows) {
      const key = canonical(b.name);
      const prev = billDefs.get(key);
      billDefs.set(key, {
        name: key,
        isDebt: (prev?.isDebt ?? false) || b.isDebt,
        amount: b.amount ?? prev?.amount ?? null, // later months win (iterated in order)
        dueDay: b.dueDay ?? prev?.dueDay ?? null,
        pt: b.paymentType ?? prev?.pt ?? null,
      });
    }
  }
  if (billDefs.size) {
    await db
      .insert(bills)
      .values(
        [...billDefs.values()].map((d) => ({
          name: d.name,
          isDebt: d.isDebt,
          defaultAmount: d.amount == null ? null : String(d.amount),
          defaultDueDay: d.dueDay,
          defaultPaymentType: d.pt,
        })),
      )
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  const billRowsDb = await db.select().from(bills);
  const billMap = new Map(billRowsDb.map((b) => [b.name, b.id]));
  console.log(`Bills (definitions): ${billMap.size}`);

  // 4) Bill instances — only for periods that have none yet
  const existingBi = await db.select({ periodId: billInstances.periodId }).from(billInstances);
  const seededPeriods = new Set(existingBi.map((r) => r.periodId));
  let biInserted = 0;
  for (const m of months) {
    const pid = periodMap.get(`${m.year}-${m.month}`)!;
    if (seededPeriods.has(pid) || m.billRows.length === 0) continue;
    await db.insert(billInstances).values(
      m.billRows.map((b) => ({
        periodId: pid,
        billId: billMap.get(canonical(b.name)) ?? null,
        name: b.name,
        amount: b.amount == null ? null : String(b.amount),
        status: b.status,
        dueDay: b.dueDay,
        paymentType: b.paymentType,
        isDebt: b.isDebt,
        isCancel: b.isCancel,
        sortOrder: b.sortOrder,
      })),
    );
    biInserted += m.billRows.length;
  }
  console.log(`Bill instances inserted this run: ${biInserted}`);

  // 5) Transactions — dedup-hash per source month, skip existing hashes
  let txInserted = 0;
  let txSkipped = 0;
  for (const m of months) {
    if (m.txRows.length === 0) continue;
    const pid = periodMap.get(`${m.year}-${m.month}`)!;
    const hashes = hashRows(
      m.txRows.map((t) => ({
        accountNumber: t.accountNumber,
        date: t.dateIso,
        amount: t.amount,
        description: t.description,
        direction: t.direction,
      })),
    );
    const candidates = m.txRows.map((t, i) => ({ t, hash: hashes[i] }));
    // de-dup within this batch by hash
    const byHash = new Map<string, (typeof candidates)[number]>();
    for (const c of candidates) if (!byHash.has(c.hash)) byHash.set(c.hash, c);
    const allHashes = [...byHash.keys()];
    const existing = allHashes.length
      ? await db
          .select({ h: transactions.dedupHash })
          .from(transactions)
          .where(inArray(transactions.dedupHash, allHashes))
      : [];
    const existingSet = new Set(existing.map((e) => e.h));
    const toInsert = [...byHash.values()].filter((c) => !existingSet.has(c.hash));
    txSkipped += byHash.size - toInsert.length;

    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      await db.insert(transactions).values(
        chunk.map(({ t, hash }) => {
          const ym = dateToYearMonth(t.dateIso);
          const txPid = ym ? periodMap.get(`${ym.year}-${ym.month}`) ?? pid : pid;
          return {
            accountId: acctMap.get(t.accountNumber) ?? null,
            periodId: txPid,
            txnDate: t.dateIso,
            description: t.description.slice(0, 512),
            category: t.rawCategory || null,
            amount: String(t.amount),
            netAmount: t.netAmount == null ? null : String(t.netAmount),
            direction: t.direction,
            dedupHash: hash,
            raw: t.raw,
          };
        }),
      );
    }
    txInserted += toInsert.length;
  }
  console.log(`Transactions inserted this run: ${txInserted} (skipped duplicates: ${txSkipped})`);

  // Summary
  const biCount = (await db.select({ id: billInstances.id }).from(billInstances)).length;
  const txAll = await db.select({ h: transactions.dedupHash }).from(transactions);
  const txDistinct = new Set(txAll.map((r) => r.h)).size;
  console.log("\n=== TOTALS IN DB ===");
  console.log(`periods=${periodMap.size} accounts=${acctMap.size} bills=${billMap.size}`);
  console.log(`bill_instances=${biCount}`);
  console.log(`transactions=${txAll.length} (distinct dedup_hash=${txDistinct} — must match)`);

  await pool.end();
  console.log("✓ Seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

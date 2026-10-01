"use server";

import { db } from "@/server/db";
import { accounts, accountBalances, bills } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";

// A liability account (Credit/Loan) surfaces on /accounts, /debts, and /dashboard — all three
// are lenses over the same account_balances ledger, so every write refreshes all of them.
function revalidateLedger() {
  revalidatePath("/accounts");
  revalidatePath("/debts");
  revalidatePath("/dashboard");
}

export async function updateAccount(
  id: number,
  patch: {
    label?: string | null;
    institution?: string | null;
    accountType?: string | null;
    // Liability facts (Credit/Loan) — folded in from the old debts table.
    originalPrincipal?: number | null;
    openedOn?: string | null;
    notes?: string | null;
    active?: boolean;
    billId?: number | null;
  },
): Promise<void> {
  await requireSession();
  const set: Record<string, unknown> = {};
  if (patch.label !== undefined) set.label = patch.label || null;
  if (patch.institution !== undefined) set.institution = patch.institution || null;
  if (patch.accountType !== undefined) set.accountType = patch.accountType || null;
  if (patch.originalPrincipal !== undefined)
    set.originalPrincipal = patch.originalPrincipal == null ? null : String(patch.originalPrincipal);
  if (patch.openedOn !== undefined) set.openedOn = patch.openedOn || null;
  if (patch.notes !== undefined) set.notes = patch.notes || null;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.billId !== undefined) set.billId = patch.billId;
  if (Object.keys(set).length) await db.update(accounts).set(set).where(eq(accounts.id, id));
  revalidateLedger();
}

export async function createAccount(
  accountNumber: string,
  label: string | null,
  accountType: string | null,
): Promise<void> {
  await requireSession();
  await db
    .insert(accounts)
    .values({ accountNumber: accountNumber.trim(), label: label || null, accountType: accountType || null })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  revalidateLedger();
}

// Create a liability account (a "debt") from a name. Manual liabilities (a card/loan you don't
// import transactions for) have no real account number, so we synthesize a short unique slug —
// it's just the display badge; the label carries the real name. If a bill with the same name
// exists and isn't already tied to an account, we link it (payment attribution / promote flow).
export async function createLiabilityAccount(
  name: string,
  accountType: "Credit" | "Loan",
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a name" };

  const base = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "acct";
  let acctNum = base;
  for (let i = 1; ; i++) {
    const clash = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.accountNumber, acctNum))
      .limit(1);
    if (!clash.length) break;
    acctNum = (base.slice(0, 7) + i).slice(0, 8);
  }

  // Link a matching, unclaimed bill so payments attribute to this liability.
  const bill = await db
    .select({ id: bills.id })
    .from(bills)
    .where(eq(bills.name, trimmed))
    .limit(1);
  let billId: number | null = null;
  if (bill.length) {
    const taken = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.billId, bill[0].id))
      .limit(1);
    if (!taken.length) billId = bill[0].id;
  }

  await db.insert(accounts).values({ accountNumber: acctNum, label: trimmed, accountType, billId });
  revalidateLedger();
  return { ok: true };
}

// Record a dated snapshot. Cash accounts pass only balance; liabilities also pass creditLimit
// (Credit) / apr / minPayment (blank → carry nothing for this snapshot; the query carries the
// last known value forward).
export async function addAccountBalance(
  accountId: number,
  balance: number,
  asOf: string,
  note: string | null,
  creditLimit?: number | null,
  apr?: number | null,
  minPayment?: number | null,
): Promise<void> {
  await requireSession();
  await db.insert(accountBalances).values({
    accountId,
    balance: String(balance),
    creditLimit: creditLimit == null ? null : String(creditLimit),
    apr: apr == null ? null : String(apr),
    minPayment: minPayment == null ? null : String(minPayment),
    asOf,
    note: note || null,
  });
  revalidateLedger();
}

export async function deleteAccountBalance(id: number): Promise<void> {
  await requireSession();
  await db.delete(accountBalances).where(eq(accountBalances.id, id));
  revalidateLedger();
}

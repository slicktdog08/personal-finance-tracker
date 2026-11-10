"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { syncEnrollments } from "@/server/db/schema";
import { requireSession } from "@/server/auth/session";
import { decryptToken, hasTokenKey } from "@/server/lib/sync/crypto";
import { DEMO_LINK_DISABLED, isDemoMode } from "@/server/lib/demo/mode";
import { completeEnrollment } from "@/server/lib/sync/sync";
import { createLinkToken, exchangePublicToken, plaidConfigured, plaidProvider } from "@/server/lib/plaid";

// Plaid Link, server side. The browser opens Link with a link token from here; Link's
// onSuccess hands back a public token, which is exchanged here for the Item's access token
// (never sent to the browser) and stored encrypted. Reconnect = Link "update mode" on an
// existing Item: same access token, nothing to exchange.

type Result<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function revalidateSynced() {
  for (const p of ["/settings/sync", "/transactions", "/accounts", "/debts", "/dashboard", "/budget", "/cash"]) revalidatePath(p);
}

async function plaidEnrollment(id: number) {
  const [row] = await db.select().from(syncEnrollments).where(eq(syncEnrollments.id, id)).limit(1);
  if (!row || row.provider !== "plaid") throw new Error("That Plaid connection no longer exists.");
  return row;
}

// Everything that would make a finished link unstorable is checked before Link opens:
// a new Item uses one of the Trial plan's 10 (non-refundable) slots.
function preflight(): string | null {
  if (isDemoMode()) return DEMO_LINK_DISABLED;
  if (!plaidConfigured()) return "Plaid isn't configured (PLAID_API_CLIENT_ID / PLAID_API_SECRET).";
  if (!hasTokenKey()) return "SYNC_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes of hex — set it before linking.";
  return null;
}

export async function createPlaidLinkToken(
  input: { reconnectEnrollmentDbId?: number } = {},
): Promise<Result<{ linkToken: string; oauthUnavailable: { redirectUri: string } | null }>> {
  await requireSession();
  const problem = preflight();
  if (problem) return { ok: false, error: problem };
  try {
    const accessToken = input.reconnectEnrollmentDbId != null ? decryptToken((await plaidEnrollment(input.reconnectEnrollmentDbId)).accessTokenEnc) : undefined;
    const { linkToken, oauthUnavailable } = await createLinkToken({ accessToken });
    return { ok: true, value: { linkToken, oauthUnavailable } };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function finishPlaidLink(input: {
  publicToken: string;
  institutionId?: string | null;
  institutionName?: string | null;
  reconnectEnrollmentDbId?: number;
}): Promise<Result<{ enrollmentDbId: number; mapped: number; unmapped: number }>> {
  await requireSession();
  const problem = preflight();
  if (problem) return { ok: false, error: problem };

  // Update mode: the Item and its token are unchanged; re-activate and refresh accounts
  // (the user may have shared new ones).
  if (input.reconnectEnrollmentDbId != null) {
    try {
      const row = await plaidEnrollment(input.reconnectEnrollmentDbId);
      const { enrollmentDbId, accounts } = await completeEnrollment({
        provider: "plaid",
        accessToken: decryptToken(row.accessTokenEnc),
        enrollmentId: row.enrollmentId,
        institutionId: row.institutionId,
        institutionName: row.institutionName,
      });
      revalidateSynced();
      return { ok: true, value: { enrollmentDbId, mapped: accounts.filter((a) => a.accountId != null).length, unmapped: accounts.filter((a) => a.accountId == null).length } };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  }

  if (!input.publicToken?.trim()) return { ok: false, error: "Plaid didn't return a public token." };
  let exchanged: { accessToken: string; itemId: string };
  try {
    exchanged = await exchangePublicToken(input.publicToken.trim());
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  try {
    const { enrollmentDbId, accounts } = await completeEnrollment({
      provider: "plaid",
      accessToken: exchanged.accessToken,
      enrollmentId: exchanged.itemId,
      institutionId: input.institutionId ?? null,
      institutionName: input.institutionName ?? null,
    });
    revalidateSynced();
    return { ok: true, value: { enrollmentDbId, mapped: accounts.filter((a) => a.accountId != null).length, unmapped: accounts.filter((a) => a.accountId == null).length } };
  } catch (e) {
    // The access token exists only in this request. If it can't be stored, revoke the Item so
    // it isn't billed with no way to reach it (the Trial slot is spent either way).
    await plaidProvider.deleteEnrollment(exchanged.accessToken, exchanged.itemId).catch(() => {});
    return { ok: false, error: `${message(e)} The bank link was revoked at Plaid; try linking again.` };
  }
}

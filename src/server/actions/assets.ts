"use server";

import { db } from "@/server/db";
import { assets, assetValues } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { ASSET_KINDS } from "@/constants/enums";

// Assets feed net worth on /accounts, /dashboard and /trends — every write refreshes all three.
function revalidateNetWorth() {
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/trends");
}

const isoDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const kindOf = (k: string | null | undefined) => ((ASSET_KINDS as readonly string[]).includes(k ?? "") ? k! : "other");

/** Create an asset, optionally with its first recorded value. */
export async function createAsset(input: {
  name: string;
  kind?: string | null;
  value?: number | null;
  asOf?: string | null;
  purchasePrice?: number | null;
  acquiredOn?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a name" };
  if (input.value != null && !Number.isFinite(input.value)) return { ok: false, error: "Value must be a number" };
  const asOf = isoDate(input.asOf);
  if (input.value != null && !asOf) return { ok: false, error: "Pick the date that value is as of" };

  const [res] = await db.insert(assets).values({
    name: name.slice(0, 96),
    kind: kindOf(input.kind),
    purchasePrice: input.purchasePrice == null ? null : String(input.purchasePrice),
    acquiredOn: isoDate(input.acquiredOn),
  });
  if (input.value != null && asOf)
    await db.insert(assetValues).values({ assetId: res.insertId, value: String(input.value), asOf });
  revalidateNetWorth();
  return { ok: true };
}

export async function updateAsset(
  id: number,
  patch: {
    name?: string;
    kind?: string;
    purchasePrice?: number | null;
    acquiredOn?: string | null;
    notes?: string | null;
    active?: boolean;
  },
): Promise<void> {
  await requireSession();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name.trim()) set.name = patch.name.trim().slice(0, 96);
  if (patch.kind !== undefined) set.kind = kindOf(patch.kind);
  if (patch.purchasePrice !== undefined)
    set.purchasePrice = patch.purchasePrice == null ? null : String(patch.purchasePrice);
  if (patch.acquiredOn !== undefined) set.acquiredOn = isoDate(patch.acquiredOn);
  if (patch.notes !== undefined) set.notes = patch.notes || null;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length) await db.update(assets).set(set).where(eq(assets.id, id));
  revalidateNetWorth();
}

/** Delete an asset and its whole value history (asset_values cascades). */
export async function deleteAsset(id: number): Promise<void> {
  await requireSession();
  await db.delete(assetValues).where(eq(assetValues.assetId, id));
  await db.delete(assets).where(eq(assets.id, id));
  revalidateNetWorth();
}

export async function addAssetValue(assetId: number, value: number, asOf: string, note: string | null): Promise<void> {
  await requireSession();
  if (!Number.isFinite(value) || !isoDate(asOf)) return;
  await db.insert(assetValues).values({ assetId, value: String(value), asOf, note: note || null });
  revalidateNetWorth();
}

export async function deleteAssetValue(id: number): Promise<void> {
  await requireSession();
  await db.delete(assetValues).where(eq(assetValues.id, id));
  revalidateNetWorth();
}

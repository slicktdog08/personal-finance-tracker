"use server";

import { db } from "@/server/db";
import { uiLayouts } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/server/auth/session";
import { LAYOUT_KEYS, normalizeLayout, normalizeMobileLayout, type LayoutItem, type LayoutKind } from "@/lib/dashboard-layout";

// No revalidatePath: the grid already shows the arrangement it's saving, and re-rendering the
// whole dashboard (every query on it) after each drag would be pure cost.

type Result = { ok: boolean; layout?: LayoutItem[]; error?: string };

const isKind = (k: unknown): k is LayoutKind => k === "desktop" || k === "mobile";

/** The stored desktop arrangement — what an unsaved phone layout is derived from. */
async function storedDesktop(): Promise<LayoutItem[]> {
  const [row] = await db.select({ layout: uiLayouts.layout }).from(uiLayouts).where(eq(uiLayouts.layoutKey, LAYOUT_KEYS.desktop)).limit(1);
  return normalizeLayout(typeof row?.layout === "string" ? JSON.parse(row.layout) : row?.layout);
}

/**
 * Store one of the dashboard arrangements (desktop or phone). Whatever comes in is normalized
 * first — never trusted as-is.
 */
export async function saveDashboardLayout(input: unknown, kind: LayoutKind = "desktop"): Promise<Result> {
  await requireSession();
  if (!isKind(kind)) return { ok: false, error: "Unknown layout." };
  try {
    const layout = kind === "desktop" ? normalizeLayout(input) : normalizeMobileLayout(input, await storedDesktop());
    await db
      .insert(uiLayouts)
      .values({ layoutKey: LAYOUT_KEYS[kind], layout })
      .onDuplicateKeyUpdate({ set: { layout } });
    return { ok: true, layout };
  } catch (e) {
    console.error("saveDashboardLayout", e);
    return { ok: false, error: "Couldn't save the layout." };
  }
}

/**
 * Forget one saved arrangement. Desktop goes back to the default layout; the phone layout goes back
 * to following the desktop order.
 */
export async function resetDashboardLayout(kind: LayoutKind = "desktop"): Promise<Result> {
  await requireSession();
  if (!isKind(kind)) return { ok: false, error: "Unknown layout." };
  try {
    await db.delete(uiLayouts).where(eq(uiLayouts.layoutKey, LAYOUT_KEYS[kind]));
    const layout = kind === "desktop" ? normalizeLayout(null) : normalizeMobileLayout(null, await storedDesktop());
    return { ok: true, layout };
  } catch (e) {
    console.error("resetDashboardLayout", e);
    return { ok: false, error: "Couldn't reset the layout." };
  }
}

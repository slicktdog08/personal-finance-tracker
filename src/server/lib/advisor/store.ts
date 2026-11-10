import "server-only";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { advisorInsights, advisorMessages, advisorRuns, advisorThreads } from "@/server/db/schema";
import type { AdvisorInsight, AdvisorMessage, AdvisorRun } from "@/server/db/schema";
import {
  clip,
  nextInsightStatus,
  normalizeCategory,
  normalizeSeverity,
  slugKey,
  type AdvisorInsightDto,
  type AdvisorMessageDto,
  type AdvisorRunDto,
  type AdvisorThreadDto,
  type InsightStatus,
  type RunKind,
  type RunStatus,
  type RunTrigger,
} from "@/lib/advisor";

// Reads and writes for the advisor tables. Time windows are computed in SQL against
// CURRENT_TIMESTAMP, the same clock the column defaults use, so a server/DB timezone
// mismatch can't make a fresh run look stale.

/** A run the app queued is claimed by the routine within this window, or it's a new run. */
const CLAIM_WINDOW_MIN = 45;
/** Nobody picked a queued run up in this long: the fire got lost. */
const QUEUED_STALE_MIN = 30;
/** A running run that never finished in this long died. */
const RUNNING_STALE_MIN = 90;

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const num = (v: string | number | null | undefined): number | null => (v == null || v === "" ? null : Number(v));

// ---- runs -------------------------------------------------------------------------------

export function toRunDto(r: AdvisorRun): AdvisorRunDto {
  return {
    id: r.id,
    kind: r.kind as RunKind,
    trigger: r.trigger as RunTrigger,
    status: r.status as RunStatus,
    routine: r.routine ?? null,
    threadId: r.threadId ?? null,
    sessionUrl: r.sessionUrl ?? null,
    summary: r.summary ?? null,
    report: r.report ?? null,
    insightsSaved: r.insightsSaved,
    startedAt: iso(r.startedAt) ?? new Date(0).toISOString(),
    finishedAt: iso(r.finishedAt),
  };
}

export async function listRuns(opts: { limit?: number; kind?: RunKind; threadId?: number } = {}): Promise<AdvisorRunDto[]> {
  const where = [];
  if (opts.kind) where.push(eq(advisorRuns.kind, opts.kind));
  if (opts.threadId) where.push(eq(advisorRuns.threadId, opts.threadId));
  const rows = await db
    .select()
    .from(advisorRuns)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(advisorRuns.startedAt), desc(advisorRuns.id))
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 200));
  return rows.map(toRunDto);
}

export async function getRun(id: number): Promise<AdvisorRunDto | null> {
  const [row] = await db.select().from(advisorRuns).where(eq(advisorRuns.id, id)).limit(1);
  return row ? toRunDto(row) : null;
}

export async function createRun(data: {
  kind: RunKind;
  trigger?: RunTrigger;
  status?: RunStatus;
  routine?: string | null;
  threadId?: number | null;
  summary?: string | null;
}): Promise<AdvisorRunDto> {
  const [{ id }] = await db
    .insert(advisorRuns)
    .values({
      kind: data.kind,
      trigger: data.trigger ?? "app",
      status: data.status ?? "queued",
      routine: data.routine ?? null,
      threadId: data.threadId ?? null,
      summary: data.summary ?? null,
    })
    .$returningId();
  return (await getRun(id))!;
}

export type RunPatch = Partial<{
  status: RunStatus;
  summary: string | null;
  report: string | null;
  sessionUrl: string | null;
  routine: string | null;
  insightsSaved: number;
}>;

export async function updateRun(id: number, patch: RunPatch): Promise<AdvisorRunDto | null> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  if (patch.status === "ok" || patch.status === "failed") set.finishedAt = sql`CURRENT_TIMESTAMP`;
  if (Object.keys(set).length) await db.update(advisorRuns).set(set).where(eq(advisorRuns.id, id));
  return getRun(id);
}

/** The newest run of this kind (and thread) that is still expected to report back. */
export async function activeRun(kind: RunKind, threadId?: number): Promise<AdvisorRunDto | null> {
  const [row] = await db
    .select()
    .from(advisorRuns)
    .where(
      and(
        eq(advisorRuns.kind, kind),
        inArray(advisorRuns.status, ["queued", "running"]),
        threadId ? eq(advisorRuns.threadId, threadId) : undefined,
        sql`${advisorRuns.startedAt} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${CLAIM_WINDOW_MIN} MINUTE)`,
      ),
    )
    .orderBy(desc(advisorRuns.startedAt))
    .limit(1);
  return row ? toRunDto(row) : null;
}

/**
 * A routine starting work: take over the run the app queued for it (the oldest queued run of
 * this kind, for this thread, from the last 45 minutes), or open a fresh one — a scheduled
 * routine or a claude.ai conversation has nothing queued.
 */
export async function claimRun(data: {
  kind: RunKind;
  threadId?: number | null;
  trigger?: RunTrigger;
  routine?: string | null;
}): Promise<AdvisorRunDto> {
  const [queued] = await db
    .select({ id: advisorRuns.id })
    .from(advisorRuns)
    .where(
      and(
        eq(advisorRuns.kind, data.kind),
        eq(advisorRuns.status, "queued"),
        data.threadId ? eq(advisorRuns.threadId, data.threadId) : undefined,
        sql`${advisorRuns.startedAt} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${CLAIM_WINDOW_MIN} MINUTE)`,
      ),
    )
    .orderBy(asc(advisorRuns.startedAt))
    .limit(1);
  if (queued) {
    await db
      .update(advisorRuns)
      .set({ status: "running", startedAt: sql`CURRENT_TIMESTAMP`, ...(data.routine ? { routine: data.routine } : {}) })
      .where(eq(advisorRuns.id, queued.id));
    return (await getRun(queued.id))!;
  }
  return createRun({
    kind: data.kind,
    threadId: data.threadId ?? null,
    trigger: data.trigger ?? "manual",
    routine: data.routine ?? null,
    status: "running",
  });
}

/**
 * Runs that will never report back show as failed instead of spinning forever, and the
 * messages they were answering stop showing as in flight.
 */
export async function sweepStale(): Promise<void> {
  await db
    .update(advisorRuns)
    .set({
      status: "failed",
      finishedAt: sql`CURRENT_TIMESTAMP`,
      summary: sql`COALESCE(${advisorRuns.summary}, 'The routine never picked this up')`,
    })
    .where(
      and(
        eq(advisorRuns.status, "queued"),
        sql`${advisorRuns.startedAt} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${QUEUED_STALE_MIN} MINUTE)`,
      ),
    );
  await db
    .update(advisorRuns)
    .set({
      status: "failed",
      finishedAt: sql`CURRENT_TIMESTAMP`,
      summary: sql`COALESCE(${advisorRuns.summary}, 'No finish recorded')`,
    })
    .where(
      and(
        eq(advisorRuns.status, "running"),
        sql`${advisorRuns.startedAt} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${RUNNING_STALE_MIN} MINUTE)`,
      ),
    );
  await db
    .update(advisorMessages)
    .set({ status: "failed", answeredAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(advisorMessages.role, "user"),
        eq(advisorMessages.status, "pending"),
        sql`${advisorMessages.createdAt} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${RUNNING_STALE_MIN} MINUTE)`,
      ),
    );
}

/** The newest finished check-in (its report is the dashboard-style write-up). */
export async function latestCheckin(): Promise<AdvisorRunDto | null> {
  const [row] = await db
    .select()
    .from(advisorRuns)
    .where(and(eq(advisorRuns.kind, "checkin"), eq(advisorRuns.status, "ok")))
    .orderBy(desc(advisorRuns.finishedAt))
    .limit(1);
  return row ? toRunDto(row) : null;
}

// ---- insights ---------------------------------------------------------------------------

export function toInsightDto(r: AdvisorInsight): AdvisorInsightDto {
  return {
    id: r.id,
    key: r.dedupeKey,
    category: normalizeCategory(r.category),
    severity: normalizeSeverity(r.severity),
    status: r.status as InsightStatus,
    title: r.title,
    body: r.body,
    amount: num(r.amount),
    period: r.periodLabel ?? null,
    search: r.search ?? null,
    transactionIds: Array.isArray(r.transactionIds) ? r.transactionIds.map(Number).filter(Number.isFinite) : [],
    occurrences: r.occurrences,
    runId: r.runId ?? null,
    createdAt: iso(r.createdAt) ?? "",
    lastSeenAt: iso(r.lastSeenAt) ?? "",
  };
}

const SEVERITY_ORDER = sql`FIELD(${advisorInsights.severity}, 'act', 'watch', 'info')`;

export async function listInsights(opts: { statuses?: InsightStatus[]; limit?: number } = {}): Promise<AdvisorInsightDto[]> {
  const rows = await db
    .select()
    .from(advisorInsights)
    .where(opts.statuses?.length ? inArray(advisorInsights.status, opts.statuses) : undefined)
    .orderBy(SEVERITY_ORDER, desc(advisorInsights.lastSeenAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  return rows.map(toInsightDto);
}

export async function getInsight(id: number): Promise<AdvisorInsightDto | null> {
  const [row] = await db.select().from(advisorInsights).where(eq(advisorInsights.id, id)).limit(1);
  return row ? toInsightDto(row) : null;
}

export interface InsightInput {
  key?: string;
  title: string;
  body: string;
  category?: string;
  severity?: string;
  amount?: number | null;
  period?: string | null;
  search?: string | null;
  transactionIds?: number[];
}

export interface UpsertResult {
  created: number;
  updated: number;
  /** Re-reported findings the user had dismissed: counted, left dismissed. */
  stillDismissed: string[];
  keys: string[];
}

/** Save findings by key: a new key is a new card; a known key refreshes the card. */
export async function upsertInsights(runId: number | null, inputs: InsightInput[]): Promise<UpsertResult> {
  const out: UpsertResult = { created: 0, updated: 0, stillDismissed: [], keys: [] };
  for (const input of inputs) {
    const key = slugKey(input.key || input.title);
    if (!key) continue;
    const values = {
      title: clip(input.title, 200),
      body: input.body.trim(),
      category: normalizeCategory(input.category),
      severity: normalizeSeverity(input.severity),
      amount: input.amount == null || !Number.isFinite(input.amount) ? null : input.amount.toFixed(2),
      periodLabel: input.period && /^\d{4}-\d{2}$/.test(input.period) ? input.period : null,
      search: input.search ? input.search.trim().slice(0, 120) || null : null,
      transactionIds: (input.transactionIds ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50),
      runId,
    };
    const [existing] = await db.select().from(advisorInsights).where(eq(advisorInsights.dedupeKey, key)).limit(1);
    if (!existing) {
      await db.insert(advisorInsights).values({ dedupeKey: key, status: "new", ...values });
      out.created++;
    } else {
      const status = nextInsightStatus(existing.status as InsightStatus);
      if (status === "dismissed") out.stillDismissed.push(key);
      await db
        .update(advisorInsights)
        .set({
          ...values,
          status,
          occurrences: sql`${advisorInsights.occurrences} + 1`,
          lastSeenAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(advisorInsights.id, existing.id));
      out.updated++;
    }
    out.keys.push(key);
  }
  return out;
}

export async function setInsightStatus(ids: number[], status: InsightStatus): Promise<number> {
  if (!ids.length) return 0;
  const [res] = await db.update(advisorInsights).set({ status }).where(inArray(advisorInsights.id, ids));
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

/** Opening the Insights page marks new cards seen (they lose the "New" dot next time). */
export async function markInsightsSeen(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db
    .update(advisorInsights)
    .set({ status: "seen" })
    .where(and(inArray(advisorInsights.id, ids), eq(advisorInsights.status, "new")));
}

export async function countNewInsights(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(advisorInsights)
    .where(eq(advisorInsights.status, "new"));
  return Number(row?.n ?? 0);
}

// ---- threads + messages -----------------------------------------------------------------

export function toMessageDto(m: AdvisorMessage): AdvisorMessageDto {
  return {
    id: m.id,
    threadId: m.threadId,
    role: m.role === "assistant" ? "assistant" : "user",
    body: m.body,
    status: (m.status as AdvisorMessageDto["status"]) ?? "answered",
    runId: m.runId ?? null,
    createdAt: iso(m.createdAt) ?? "",
    answeredAt: iso(m.answeredAt),
  };
}

export async function listThreads(limit = 30): Promise<AdvisorThreadDto[]> {
  const rows = await db
    .select({
      id: advisorThreads.id,
      title: advisorThreads.title,
      createdAt: advisorThreads.createdAt,
      updatedAt: advisorThreads.updatedAt,
      pending: sql<number>`(SELECT COUNT(*) FROM advisor_messages m WHERE m.thread_id = ${advisorThreads.id} AND m.role = 'user' AND m.status = 'pending')`,
      preview: sql<string | null>`(SELECT LEFT(m.body, 140) FROM advisor_messages m WHERE m.thread_id = ${advisorThreads.id} ORDER BY m.id DESC LIMIT 1)`,
    })
    .from(advisorThreads)
    .orderBy(desc(advisorThreads.updatedAt), desc(advisorThreads.id))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: iso(r.createdAt) ?? "",
    updatedAt: iso(r.updatedAt) ?? "",
    pending: Number(r.pending ?? 0),
    preview: r.preview ? clip(r.preview, 120) : null,
  }));
}

export async function getThread(id: number): Promise<{ id: number; title: string } | null> {
  const [row] = await db
    .select({ id: advisorThreads.id, title: advisorThreads.title })
    .from(advisorThreads)
    .where(eq(advisorThreads.id, id))
    .limit(1);
  return row ?? null;
}

export async function createThread(title: string): Promise<number> {
  const [{ id }] = await db.insert(advisorThreads).values({ title: clip(title, 160) }).$returningId();
  return id;
}

export async function renameThread(id: number, title: string): Promise<void> {
  await db.update(advisorThreads).set({ title: clip(title, 160) }).where(eq(advisorThreads.id, id));
}

export async function deleteThread(id: number): Promise<void> {
  await db.delete(advisorThreads).where(eq(advisorThreads.id, id));
}

export async function listMessages(threadId: number, limit = 200): Promise<AdvisorMessageDto[]> {
  const rows = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.threadId, threadId))
    .orderBy(desc(advisorMessages.id))
    .limit(limit);
  return rows.reverse().map(toMessageDto);
}

export async function addMessage(
  threadId: number,
  role: "user" | "assistant",
  body: string,
  opts: { status?: AdvisorMessageDto["status"]; runId?: number | null } = {},
): Promise<AdvisorMessageDto> {
  const status = opts.status ?? (role === "user" ? "pending" : "answered");
  const [{ id }] = await db
    .insert(advisorMessages)
    .values({
      threadId,
      role,
      body: body.trim(),
      status,
      runId: opts.runId ?? null,
      answeredAt: role === "assistant" ? sql`CURRENT_TIMESTAMP` : null,
    })
    .$returningId();
  // Bump the thread so the list sorts by latest activity.
  await db.update(advisorThreads).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(advisorThreads.id, threadId));
  const [row] = await db.select().from(advisorMessages).where(eq(advisorMessages.id, id)).limit(1);
  return toMessageDto(row);
}

/**
 * Close the user's pending turns once a run has answered them. `upto` limits it to the turns
 * the run actually read, so one sent mid-run stays pending for the next run.
 */
export async function closePending(
  threadId: number,
  status: "answered" | "failed",
  opts: { upto?: number; runId?: number | null } = {},
): Promise<number> {
  const [res] = await db
    .update(advisorMessages)
    .set({ status, answeredAt: sql`CURRENT_TIMESTAMP`, ...(opts.runId ? { runId: opts.runId } : {}) })
    .where(
      and(
        eq(advisorMessages.threadId, threadId),
        eq(advisorMessages.role, "user"),
        eq(advisorMessages.status, "pending"),
        opts.upto ? lte(advisorMessages.id, opts.upto) : undefined,
      ),
    );
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

export async function pendingCount(threadId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(advisorMessages)
    .where(and(eq(advisorMessages.threadId, threadId), eq(advisorMessages.role, "user"), eq(advisorMessages.status, "pending")));
  return Number(row?.n ?? 0);
}

/** Threads with an unanswered turn, oldest first: what a run with no payload should pick up. */
export async function threadsWithPending(limit = 5): Promise<number[]> {
  const rows = await db
    .select({ threadId: advisorMessages.threadId, first: sql<number>`MIN(${advisorMessages.id})` })
    .from(advisorMessages)
    .where(and(eq(advisorMessages.role, "user"), eq(advisorMessages.status, "pending")))
    .groupBy(advisorMessages.threadId)
    .orderBy(sql`MIN(${advisorMessages.id})`)
    .limit(limit);
  return rows.map((r) => r.threadId);
}

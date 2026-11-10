"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { INSIGHT_STATUSES, type AdvisorMessageDto, type AdvisorRunDto, type InsightStatus } from "@/lib/advisor";
import { requestRun, sendMessage, type RequestResult, type SendResult } from "@/server/lib/advisor/requests";
import {
  deleteThread,
  getThread,
  listMessages,
  listRuns,
  renameThread,
  setInsightStatus,
  sweepStale,
} from "@/server/lib/advisor/store";

function revalidateAdvisor() {
  revalidatePath("/insights");
  revalidatePath("/advisor");
}

/** "Generate insights": fire the routine (or join the run already going unless forced). */
export async function generateInsights(force = false): Promise<RequestResult> {
  await requireSession();
  const res = await requestRun("insights", force);
  revalidateAdvisor();
  return res;
}

/** "Run check-in now": the daily update, outside its schedule. */
export async function runCheckinNow(force = false): Promise<RequestResult> {
  await requireSession();
  const res = await requestRun("checkin", force);
  revalidateAdvisor();
  return res;
}

export async function updateInsightStatus(ids: number[], status: InsightStatus): Promise<{ ok: boolean; changed: number }> {
  await requireSession();
  if (!INSIGHT_STATUSES.includes(status)) return { ok: false, changed: 0 };
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  const changed = await setInsightStatus(clean, status);
  revalidateAdvisor();
  return { ok: true, changed };
}

/** A chat turn from /advisor; threadId null starts a new conversation. */
export async function sendAdvisorMessage(threadId: number | null, body: string): Promise<SendResult> {
  await requireSession();
  const res = await sendMessage(threadId, body);
  revalidateAdvisor();
  return res;
}

export async function renameAdvisorThread(threadId: number, title: string): Promise<{ ok: boolean }> {
  await requireSession();
  const clean = title.trim();
  if (!clean || !(await getThread(threadId))) return { ok: false };
  await renameThread(threadId, clean);
  revalidateAdvisor();
  return { ok: true };
}

export async function deleteAdvisorThread(threadId: number): Promise<{ ok: boolean }> {
  await requireSession();
  await deleteThread(threadId);
  revalidateAdvisor();
  return { ok: true };
}

/**
 * What the open pages poll while a run is in flight: the recent runs and, on a thread page,
 * that thread's messages. Cheap (two indexed queries) and read-only apart from the stale sweep.
 */
export async function advisorLiveState(threadId?: number | null): Promise<{ runs: AdvisorRunDto[]; messages: AdvisorMessageDto[] | null }> {
  await requireSession();
  await sweepStale();
  const [runs, messages] = await Promise.all([
    listRuns({ limit: 15 }),
    threadId ? listMessages(threadId) : Promise.resolve(null),
  ]);
  return { runs, messages };
}

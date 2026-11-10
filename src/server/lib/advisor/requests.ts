import "server-only";
import { clip, threadTitle, type AdvisorMessageDto, type RunKind } from "@/lib/advisor";
import { fireAdvisorRoutine } from "./routine";
import {
  activeRun,
  addMessage,
  closePending,
  createRun,
  createThread,
  getThread,
  pendingCount,
  updateRun,
} from "./store";

// What the app's buttons do: record the request first (so the page shows it and the run can
// read it), then fire the routine with a short payload. One run per job at a time — a second
// "Generate insights" while one is going joins it, and a chat message sent while a run is
// answering that thread waits for it; the run's reply fires the next run for it.

export const ROUTINE_NAME = "MiPlata advisor";

export type RequestResult =
  | { status: "started"; runId: number; sessionUrl: string | null }
  | { status: "running"; runId: number; sessionUrl: string | null }
  | { status: "error"; message: string };

async function queueAndFire(kind: RunKind, summary: string, threadId?: number): Promise<RequestResult> {
  const run = await createRun({ kind, trigger: "app", status: "queued", routine: ROUTINE_NAME, threadId: threadId ?? null, summary });
  const fired = await fireAdvisorRoutine(kind === "chat" ? { kind, threadId: threadId! } : { kind });
  if (!fired.ok) {
    await updateRun(run.id, { status: "failed", summary: fired.error });
    return { status: "error", message: fired.error };
  }
  if (fired.sessionUrl) await updateRun(run.id, { sessionUrl: fired.sessionUrl });
  return { status: "started", runId: run.id, sessionUrl: fired.sessionUrl };
}

/** "Generate insights" / "Run check-in": joins a run already in flight unless forced. */
export async function requestRun(kind: "insights" | "checkin", force = false): Promise<RequestResult> {
  const current = await activeRun(kind);
  if (current && !force) return { status: "running", runId: current.id, sessionUrl: current.sessionUrl };
  return queueAndFire(kind, kind === "insights" ? "Insights requested from the app" : "Check-in requested from the app");
}

export type SendResult =
  | { status: "started" | "queued"; threadId: number; message: AdvisorMessageDto; sessionUrl: string | null }
  | { status: "error"; message: string; threadId?: number };

/** A chat turn: a new thread when threadId is null. */
export async function sendMessage(threadId: number | null, body: string): Promise<SendResult> {
  const text = body.trim();
  if (!text) return { status: "error", message: "Write a message first." };
  if (text.length > 8000) return { status: "error", message: "That message is too long (8,000 characters max)." };

  let id = threadId;
  if (id == null) id = await createThread(threadTitle(text));
  else if (!(await getThread(id))) return { status: "error", message: "That conversation doesn't exist any more." };

  const message = await addMessage(id, "user", text);
  const current = await activeRun("chat", id);
  if (current) return { status: "queued", threadId: id, message, sessionUrl: current.sessionUrl };

  const fired = await queueAndFire("chat", `Message: ${clip(text)}`, id);
  if (fired.status === "error") {
    await closePending(id, "failed", { upto: message.id });
    return { status: "error", message: fired.message, threadId: id };
  }
  return { status: "started", threadId: id, message, sessionUrl: fired.sessionUrl };
}

/**
 * A run answering a thread. Stores the reply, closes the turns it read, finishes the run, and
 * if the user wrote again while it worked, starts the next run for those turns.
 */
export async function recordReply(input: {
  threadId: number;
  body: string;
  runId?: number | null;
  upto?: number;
  failed?: boolean;
}): Promise<{ message: AdvisorMessageDto; remaining: number; refired: boolean }> {
  const status = input.failed ? "failed" : "answered";
  const message = await addMessage(input.threadId, "assistant", input.body, { status, runId: input.runId ?? null });
  await closePending(input.threadId, status, { upto: input.upto, runId: input.runId ?? null });
  if (input.runId) await updateRun(input.runId, { status: input.failed ? "failed" : "ok", summary: clip(input.body) });

  const remaining = await pendingCount(input.threadId);
  let refired = false;
  if (remaining > 0) {
    const next = await queueAndFire("chat", "Follow-up sent while the last run was working", input.threadId);
    refired = next.status === "started";
  }
  return { message, remaining, refired };
}

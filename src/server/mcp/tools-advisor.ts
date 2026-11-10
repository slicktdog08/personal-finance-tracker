import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fail, ok } from "./result";
import {
  INSIGHT_CATEGORIES,
  INSIGHT_SEVERITIES,
  INSIGHT_STATUSES,
  RUN_KINDS,
  parsePayload,
  type AdvisorRequest,
  type InsightStatus,
} from "@/lib/advisor";
import { playbookFor } from "@/server/lib/advisor/playbooks";
import { recordReply, ROUTINE_NAME } from "@/server/lib/advisor/requests";
import {
  claimRun,
  getRun,
  getThread,
  listInsights,
  listMessages,
  listRuns,
  sweepStale,
  threadsWithPending,
  updateRun,
  upsertInsights,
} from "@/server/lib/advisor/store";

// The advisor channel: how a Claude Code routine fired from the app (or a claude.ai
// conversation) picks up its request and writes the answer back. Every write here lands in
// the advisor_* tables only — Claude's own notes and run log, never the ledger — which is why
// these tools are safe to call unattended, unlike tools-write.ts.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const NOTE_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const insightSchema = z.object({
  key: z
    .string()
    .max(96)
    .optional()
    .describe("Stable id for this finding (e.g. 'streaming-price-creep'). Reuse an open card's key to refresh it instead of adding a duplicate. Defaults to a slug of the title."),
  title: z.string().min(3).max(200).describe("The finding itself, stated plainly with its number."),
  body: z.string().min(10).max(4000).describe("2–5 sentences: the numbers, why it matters, one concrete next step. Markdown is fine."),
  category: z.enum(INSIGHT_CATEGORIES).default("other"),
  severity: z.enum(INSIGHT_SEVERITIES).default("info").describe("act = costs money or risk now; watch = trending the wrong way; info = good to know."),
  amount: z.number().optional().describe("Dollar impact (e.g. extra spend per month), when there is one."),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM the finding is about."),
  search: z.string().max(120).optional().describe("A Transactions-page search term that shows the evidence (merchant or description text)."),
  transactionIds: z.array(z.number().int()).max(50).optional().describe("Transactions that prove it."),
});

async function threadContext(threadId: number) {
  const thread = await getThread(threadId);
  if (!thread) return null;
  const messages = await listMessages(threadId, 60);
  const pending = messages.filter((m) => m.role === "user" && m.status === "pending");
  return {
    id: thread.id,
    title: thread.title,
    messages: messages.map((m) => ({ id: m.id, role: m.role, status: m.status, at: m.createdAt, body: m.body })),
    pendingIds: pending.map((m) => m.id),
    upto: pending.length ? Math.max(...pending.map((m) => m.id)) : null,
  };
}

export function registerAdvisorTools(server: McpServer) {
  server.registerTool(
    "get_advisor_inbox",
    {
      title: "Advisor inbox",
      description:
        "Start here when the finance app fired you (a routine run) or when asked to work the advisor queue. Pass the routine payload text exactly as received (INSIGHTS, CHECKIN or CHAT-<n>); anything else is ignored. Returns the request, the playbook to follow for it, the thread history for a chat, and the open/dismissed insight cards so findings aren't repeated. With no payload it returns whatever is waiting (unanswered chat turns first, then queued runs). Read-only.",
      inputSchema: z.object({
        payload: z.string().max(200).optional().describe("The <routine-fire-payload> text, verbatim."),
      }),
      annotations: READ_ONLY,
    },
    async ({ payload }) => {
      await sweepStale();
      let request: AdvisorRequest | null = parsePayload(payload);
      const ignoredPayload = payload && !request ? "The payload wasn't INSIGHTS, CHECKIN or CHAT-<n>, so it was ignored." : undefined;

      const [pendingThreads, recentRuns] = await Promise.all([threadsWithPending(5), listRuns({ limit: 15 })]);
      const queued = recentRuns.filter((r) => r.status === "queued");
      if (!request) {
        if (pendingThreads.length) request = { kind: "chat", threadId: pendingThreads[0] };
        else if (queued.length) {
          const q = queued[queued.length - 1]; // oldest queued
          request = q.kind === "chat" && q.threadId ? { kind: "chat", threadId: q.threadId } : q.kind === "checkin" ? { kind: "checkin" } : { kind: "insights" };
        }
      }
      if (!request) {
        return ok({ request: null, ignoredPayload, message: "Nothing is waiting: no unanswered chat turns and no queued runs. Stop here without opening a run." });
      }
      const req: AdvisorRequest = request;

      const [open, dismissed] = await Promise.all([
        listInsights({ statuses: ["new", "seen"], limit: 60 }),
        listInsights({ statuses: ["dismissed"], limit: 60 }),
      ]);
      const thread = request.kind === "chat" ? await threadContext(request.threadId) : null;
      if (request.kind === "chat" && !thread) return fail(`Thread ${request.threadId} doesn't exist.`);
      if (request.kind === "chat" && thread && !thread.pendingIds.length) {
        return ok({ request, ignoredPayload, thread, message: "This thread has no unanswered turns (another run already replied). Stop here without opening a run." });
      }

      return ok({
        request,
        ignoredPayload,
        playbook: playbookFor(request.kind),
        thread,
        openInsights: open.map((i) => ({ key: i.key, title: i.title, severity: i.severity, category: i.category, lastSeenAt: i.lastSeenAt })),
        dismissedInsights: dismissed.map((i) => ({ key: i.key, title: i.title, lastSeenAt: i.lastSeenAt })),
        alsoWaiting: {
          threads: pendingThreads.filter((id) => req.kind !== "chat" || id !== req.threadId),
          queuedRuns: queued.map((r) => ({ runId: r.id, kind: r.kind, threadId: r.threadId })),
        },
      });
    },
  );

  server.registerTool(
    "start_advisor_run",
    {
      title: "Start an advisor run",
      description:
        "Open the run record the app shows on its Insights page: claims the run the app queued for this request (or opens a new one for a scheduled routine or a conversation). Call once, before the work; keep the returned runId for save_insights, reply_to_advisor_thread and finish_advisor_run.",
      inputSchema: z.object({
        kind: z.enum(RUN_KINDS),
        threadId: z.number().int().optional().describe("Required for kind 'chat'."),
        trigger: z.enum(["app", "cron", "manual"]).optional().describe("cron for a scheduled routine, manual for a claude.ai conversation. Ignored when claiming a run the app queued."),
        routine: z.string().max(96).optional().describe("The routine's name, if this is one."),
      }),
      annotations: NOTE_WRITE,
    },
    async ({ kind, threadId, trigger, routine }) => {
      if (kind === "chat" && !threadId) return fail("kind 'chat' needs threadId.");
      if (threadId && !(await getThread(threadId))) return fail(`Thread ${threadId} doesn't exist.`);
      const run = await claimRun({ kind, threadId: threadId ?? null, trigger: trigger ?? "manual", routine: routine ?? (trigger === "cron" ? null : ROUTINE_NAME) });
      return ok({ runId: run.id, kind: run.kind, status: run.status, trigger: run.trigger });
    },
  );

  server.registerTool(
    "save_insights",
    {
      title: "Save insights",
      description:
        "Save findings as cards on the app's Insights page. Same key = same card (refreshed, occurrence counted); a card the user dismissed stays dismissed. Send the whole set in one call. Writes only Claude's notes, never financial records.",
      inputSchema: z.object({
        runId: z.number().int().optional(),
        insights: z.array(insightSchema).min(1).max(20),
      }),
      annotations: NOTE_WRITE,
    },
    async ({ runId, insights }) => {
      const run = runId ? await getRun(runId) : null;
      if (runId && !run) return fail(`No advisor run ${runId}.`);
      const res = await upsertInsights(run?.id ?? null, insights);
      if (run) await updateRun(run.id, { insightsSaved: run.insightsSaved + res.created + res.updated });
      return ok({
        ...res,
        note: res.stillDismissed.length ? "Some keys were dismissed by the user before; they stay dismissed. Don't mention them unless something changed materially." : undefined,
      });
    },
  );

  server.registerTool(
    "reply_to_advisor_thread",
    {
      title: "Reply in an advisor thread",
      description:
        "Post your answer in a chat thread on the app's Advisor page. Closes the user's pending turns up to `upto` and finishes the run (pass runId). If the user wrote again meanwhile, the app starts the next run for those turns itself; don't answer them here. Use failed: true when you couldn't answer, with the reason in body.",
      inputSchema: z.object({
        threadId: z.number().int(),
        body: z.string().min(1).max(20000).describe("Markdown. Short paragraphs and bullets read best on a phone."),
        runId: z.number().int().optional(),
        upto: z.number().int().optional().describe("The highest pending message id you answered (get_advisor_inbox gives it as thread.upto)."),
        failed: z.boolean().optional(),
      }),
      annotations: NOTE_WRITE,
    },
    async ({ threadId, body, runId, upto, failed }) => {
      if (!(await getThread(threadId))) return fail(`Thread ${threadId} doesn't exist.`);
      if (runId && !(await getRun(runId))) return fail(`No advisor run ${runId}.`);
      const res = await recordReply({ threadId, body, runId, upto, failed });
      return ok({
        messageId: res.message.id,
        stillPending: res.remaining,
        nextRunStarted: res.refired,
        note: res.remaining ? "Newer messages arrived while you worked; a new run has been started for them. Stop here." : undefined,
      });
    },
  );

  server.registerTool(
    "finish_advisor_run",
    {
      title: "Finish an advisor run",
      description:
        "Close the run record with its outcome. `summary` is one line for the runs list; `report` is a check-in's full markdown write-up (shown on the Insights page). Chat runs are finished by reply_to_advisor_thread instead.",
      inputSchema: z.object({
        runId: z.number().int(),
        status: z.enum(["ok", "failed"]),
        summary: z.string().max(500).optional(),
        report: z.string().max(20000).optional(),
      }),
      annotations: NOTE_WRITE,
    },
    async ({ runId, status, summary, report }) => {
      const run = await getRun(runId);
      if (!run) return fail(`No advisor run ${runId}.`);
      const done = await updateRun(runId, { status, summary: summary ?? run.summary, report: report ?? run.report });
      return ok({ runId, status: done?.status, finishedAt: done?.finishedAt });
    },
  );

  server.registerTool(
    "list_insights",
    {
      title: "List saved insights",
      description:
        "The insight cards on the app's Insights page: what earlier runs found, with the user's verdict (new, seen, done, dismissed). Use it to answer 'what have you noticed?' or to follow up on a card. Read-only.",
      inputSchema: z.object({
        statuses: z.array(z.enum(INSIGHT_STATUSES)).optional().describe("Default: new and seen (the open cards)."),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      annotations: READ_ONLY,
    },
    async ({ statuses, limit }) => {
      const rows = await listInsights({ statuses: (statuses as InsightStatus[] | undefined) ?? ["new", "seen"], limit });
      return ok({ insights: rows });
    },
  );
}

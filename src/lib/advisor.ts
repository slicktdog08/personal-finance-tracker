// The AI advisor channel, shared by the server (store, MCP tools, actions) and the client
// (Insights and Advisor pages). No server imports here, so client components and unit tests
// can use it directly.
//
// How it fits together (planning/features/ai-advisor.md):
//   app button → advisor_runs row (queued) → fire the "MiPlata advisor" Claude Code routine
//   with a short payload → the routine calls get_advisor_inbox over the MCP connector, does
//   the work with the read tools, and writes back with save_insights / reply_to_advisor_thread
//   / finish_advisor_run → the page polls and shows the result.

export const RUN_KINDS = ["insights", "checkin", "chat"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_STATUSES = ["queued", "running", "ok", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** app = a button in this app, cron = a scheduled routine, manual = a claude.ai conversation. */
export const RUN_TRIGGERS = ["app", "cron", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const INSIGHT_SEVERITIES = ["act", "watch", "info"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_STATUSES = ["new", "seen", "done", "dismissed"] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export const INSIGHT_CATEGORIES = [
  "spending",
  "subscriptions",
  "anomaly",
  "cash-flow",
  "budget",
  "debt",
  "income",
  "savings",
  "habit",
  "data-quality",
  "other",
] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export const SEVERITY_META: Record<InsightSeverity, { label: string; tone: "danger" | "warn" | "info"; color: string }> = {
  act: { label: "Act on this", tone: "danger", color: "#e11d48" },
  watch: { label: "Watch", tone: "warn", color: "#d97706" },
  info: { label: "Good to know", tone: "info", color: "#0ea5e9" },
};

export const CATEGORY_LABEL: Record<InsightCategory, string> = {
  spending: "Spending",
  subscriptions: "Subscriptions",
  anomaly: "Unusual",
  "cash-flow": "Cash flow",
  budget: "Budget",
  debt: "Debt",
  income: "Income",
  savings: "Savings",
  habit: "Habit",
  "data-quality": "Data quality",
  other: "Other",
};

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  insights: "Insights",
  checkin: "Check-in",
  chat: "Chat",
};

// ---- DTOs the pages render ------------------------------------------------------------

export interface AdvisorRunDto {
  id: number;
  kind: RunKind;
  trigger: RunTrigger;
  status: RunStatus;
  routine: string | null;
  threadId: number | null;
  sessionUrl: string | null;
  summary: string | null;
  report: string | null;
  insightsSaved: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface AdvisorInsightDto {
  id: number;
  key: string;
  category: InsightCategory;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  body: string;
  amount: number | null;
  period: string | null;
  search: string | null;
  transactionIds: number[];
  occurrences: number;
  runId: number | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface AdvisorMessageDto {
  id: number;
  threadId: number;
  role: "user" | "assistant";
  body: string;
  status: "pending" | "answered" | "failed";
  runId: number | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface AdvisorThreadDto {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The user's turns still waiting for an answer. */
  pending: number;
  /** First line of the newest turn, for the thread list. */
  preview: string | null;
}

// ---- the routine payload --------------------------------------------------------------

/**
 * What the app sends when it fires the routine. Deliberately tiny: the routine treats the
 * payload as untrusted webhook text and accepts only these shapes. What was actually asked
 * (the chat message, the period) lives in the database, never in the payload.
 */
export type AdvisorRequest = { kind: "insights" } | { kind: "checkin" } | { kind: "chat"; threadId: number };

export function formatPayload(req: AdvisorRequest): string {
  if (req.kind === "chat") return `CHAT-${req.threadId}`;
  return req.kind.toUpperCase();
}

/** Strict: `INSIGHTS`, `CHECKIN` or `CHAT-<n>`, whitespace-trimmed; anything else is null. */
export function parsePayload(raw: string | null | undefined): AdvisorRequest | null {
  const text = (raw ?? "").trim();
  if (text === "INSIGHTS") return { kind: "insights" };
  if (text === "CHECKIN") return { kind: "checkin" };
  const m = /^CHAT-(\d{1,9})$/.exec(text);
  if (m) {
    const threadId = Number(m[1]);
    return threadId > 0 ? { kind: "chat", threadId } : null;
  }
  return null;
}

// ---- insight normalization ------------------------------------------------------------

/** A stable, URL-safe key: "Streaming creep (3 services)" → "streaming-creep-3-services". */
export function slugKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
}

export function normalizeSeverity(raw: string | null | undefined): InsightSeverity {
  const s = (raw ?? "").toLowerCase().trim();
  if ((INSIGHT_SEVERITIES as readonly string[]).includes(s)) return s as InsightSeverity;
  if (/^(high|urgent|critical|action)/.test(s)) return "act";
  if (/^(medium|warn|moderate)/.test(s)) return "watch";
  return "info";
}

export function normalizeCategory(raw: string | null | undefined): InsightCategory {
  const s = slugKey(raw ?? "");
  if ((INSIGHT_CATEGORIES as readonly string[]).includes(s)) return s as InsightCategory;
  if (s.startsWith("subscription") || s === "recurring") return "subscriptions";
  if (s === "cashflow" || s === "cash") return "cash-flow";
  if (s === "anomalies" || s === "unusual" || s === "duplicate" || s === "duplicates") return "anomaly";
  if (s === "data" || s === "uncategorized") return "data-quality";
  return "other";
}

/**
 * What a re-reported finding does to an existing row. A dismissed finding stays dismissed (it
 * only counts the repeat, so the routine can see "the user said no to this"); a finding the
 * user marked done comes back as new because it happened again; new and seen keep their state.
 */
export function nextInsightStatus(current: InsightStatus): InsightStatus {
  if (current === "dismissed") return "dismissed";
  if (current === "done") return "new";
  return current;
}

export const clip = (s: string, n = 160) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** A thread title from its first message: the first sentence, clipped. */
export function threadTitle(firstMessage: string): string {
  const first = firstMessage.trim().split(/(?<=[.?!])\s|\n/)[0] ?? "";
  return clip(first || "New conversation", 80);
}

/** True while a run is still expected to report back. */
export const isActive = (status: RunStatus) => status === "queued" || status === "running";

/** "2m 05s" / "45s" for the runs list. */
export function runDuration(run: Pick<AdvisorRunDto, "startedAt" | "finishedAt">, now = Date.now()): string {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  const secs = Math.max(0, Math.floor((end - new Date(run.startedAt).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

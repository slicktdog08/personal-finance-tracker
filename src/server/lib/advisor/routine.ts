import "server-only";
import { formatPayload, type AdvisorRequest } from "@/lib/advisor";
import { DEMO_ADVISOR_DISABLED, isDemoMode } from "@/server/lib/demo/mode";

// Fires the "MiPlata advisor" Claude Code routine: a claude.ai routine with an API trigger,
// so a request from the app runs on the owner's Claude plan instead of metered API credit.
// The routine has the MCP connector to this app attached, and that is how it reads the
// ledger and writes its answer back (src/server/mcp/tools-advisor.ts).
//
//   CLAUDE_ADVISOR_ROUTINE_ID     the routine's trigger id (trig_…), from its API trigger
//   CLAUDE_ADVISOR_ROUTINE_TOKEN  the token generated with that trigger (sk-ant-oat01-…)
//
// The payload is one of INSIGHTS / CHECKIN / CHAT-<threadId>; the request itself is in the
// database. See planning/features/ai-advisor.md for the routine's prompt.

const API = "https://api.anthropic.com/v1/claude_code/routines";

export type FireResult = { ok: true; sessionUrl: string | null } | { ok: false; error: string };

export function routineConfigured(): boolean {
  if (isDemoMode()) return false;
  return Boolean(process.env.CLAUDE_ADVISOR_ROUTINE_ID && process.env.CLAUDE_ADVISOR_ROUTINE_TOKEN);
}

export async function fireAdvisorRoutine(req: AdvisorRequest): Promise<FireResult> {
  if (isDemoMode()) return { ok: false, error: DEMO_ADVISOR_DISABLED };
  const id = process.env.CLAUDE_ADVISOR_ROUTINE_ID;
  const token = process.env.CLAUDE_ADVISOR_ROUTINE_TOKEN;
  if (!id || !token) {
    return { ok: false, error: "The advisor routine isn't set up: CLAUDE_ADVISOR_ROUTINE_ID and CLAUDE_ADVISOR_ROUTINE_TOKEN are missing on the server." };
  }
  if (!/^trig_[A-Za-z0-9]+$/.test(id)) return { ok: false, error: "CLAUDE_ADVISOR_ROUTINE_ID should look like trig_…" };

  try {
    const response = await fetch(`${API}/${id}/fire`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: formatPayload(req) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.error("advisor routine fire failed", response.status, (await response.text()).slice(0, 500));
      const hint = response.status === 401 || response.status === 403 ? " Check CLAUDE_ADVISOR_ROUTINE_TOKEN." : "";
      return { ok: false, error: `The routine returned HTTP ${response.status}.${hint}` };
    }
    const body = (await response.json().catch(() => ({}))) as { claude_code_session_url?: string };
    return { ok: true, sessionUrl: body.claude_code_session_url ?? null };
  } catch (err) {
    console.error("advisor routine fire error", err);
    return { ok: false, error: "The routine couldn't be reached." };
  }
}

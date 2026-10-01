import { getSyncSettings } from "@/server/lib/sync/settings";
import { runSync } from "@/server/lib/sync/sync";

// In-process scheduler (bank-sync.md D6). Started once per server process from
// src/instrumentation.ts when SYNC_SCHEDULER=1. Every TICK_MS it reads sync_settings and
// runs when `enabled` and `next_run_at` has passed; the run itself re-arms next_run_at.
// The DB row is the source of truth, so the interval can be changed from the settings
// page and a redeploy/restart never double-runs (the run lock lives in the DB too).

const TICK_MS = 60_000;

const globalForScheduler = globalThis as unknown as { __syncScheduler?: NodeJS.Timeout };

export function startSyncScheduler(): void {
  if (globalForScheduler.__syncScheduler) return; // HMR / double register guard
  console.log(`[sync] scheduler started (tick ${TICK_MS / 1000}s)`);
  const timer = setInterval(() => {
    tick().catch((e) => console.error("[sync] scheduler tick failed:", e));
  }, TICK_MS);
  timer.unref(); // never keep the process alive on its own
  globalForScheduler.__syncScheduler = timer;
}

export function stopSyncScheduler(): void {
  if (globalForScheduler.__syncScheduler) {
    clearInterval(globalForScheduler.__syncScheduler);
    globalForScheduler.__syncScheduler = undefined;
  }
}

// Exported for tests: decides + runs, returns what it did.
export async function tick(now = new Date()): Promise<"disabled" | "not-due" | "ran" | "locked"> {
  const s = await getSyncSettings();
  if (!s.enabled) return "disabled";
  if (s.nextRunAt && s.nextRunAt > now) return "not-due";
  const summary = await runSync({ trigger: "scheduled", log: (l) => console.log(`[sync] ${l}`) });
  return summary.status === "locked" ? "locked" : "ran";
}

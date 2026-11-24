import { runPaceJob } from "@/server/pace";

// Spending Pace job (planning/features/spending-pace.md). Started from src/instrumentation.ts
// beside the bank-sync scheduler, in production builds only. Every TICK_MS it replays the monitor:
// a fresh escalation to Warning or Alert posts one notice, and the weekly digest posts once its
// day and time have passed. Both are idempotent (app_settings `spending_pace_state` remembers what
// went out), so frequent ticks and restarts never double-send — a tick is just a recompute.

const TICK_MS = 15 * 60_000;

const g = globalThis as unknown as { __paceScheduler?: NodeJS.Timeout };

export function startPaceScheduler(): void {
  if (g.__paceScheduler) return; // HMR / double register guard
  console.log(`[pace] scheduler started (tick ${TICK_MS / 60_000}min)`);
  const tick = () =>
    runPaceJob()
      .then((r) => {
        if (r.notified.length || r.digest) console.log(`[pace] ${r.status}; notified ${r.notified.join(", ") || "none"}; digest ${r.digest}`);
      })
      .catch((e) => console.error("[pace] tick failed:", e));
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  g.__paceScheduler = timer;
}

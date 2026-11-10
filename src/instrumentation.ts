// Runs once per Next server process (see node_modules/next/dist/docs/01-app/02-guides/
// instrumentation.md). The bank-sync scheduler starts in production builds only, so a local
// `next dev` (which points at the same database) never polls banks; whether it actually runs
// is the "Automatic sync" switch in Settings → Bank Sync (sync_settings.enabled, default off).
// SYNC_SCHEDULER=0 is an escape hatch to keep a production process from starting it.
import { schedulerAllowed } from "./server/sync/scheduler-gate";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The public demo puts its sample data back on a timer (no-op unless DEMO_MODE=1).
  if (process.env.DEMO_MODE === "1") {
    const { startDemoReset } = await import("./server/demo/reset");
    startDemoReset();
  }
  if (!schedulerAllowed()) return;
  const { startSyncScheduler } = await import("./server/sync/scheduler");
  startSyncScheduler();
}

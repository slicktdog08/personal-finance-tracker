// Runs once per Next server process (see node_modules/next/dist/docs/01-app/02-guides/
// instrumentation.md). The bank-sync scheduler is opt-in via SYNC_SCHEDULER=1 so a local
// `next dev` never polls real banks by accident; production sets it in .env.production.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SYNC_SCHEDULER !== "1") return;
  const { startSyncScheduler } = await import("./server/sync/scheduler");
  startSyncScheduler();
}

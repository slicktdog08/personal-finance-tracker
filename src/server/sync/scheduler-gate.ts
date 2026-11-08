// Whether this server process may run the bank-sync scheduler: production builds only (a
// local `next dev` shares the production database and must never poll banks), unless
// SYNC_SCHEDULER=0 opts a production process out. Whether a run actually happens is the
// "Automatic sync" switch in Settings → Bank Sync (sync_settings.enabled, default off).
export function schedulerAllowed(): boolean {
  return process.env.NODE_ENV === "production" && process.env.SYNC_SCHEDULER !== "0";
}

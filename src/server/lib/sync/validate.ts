import type { SyncSettings } from "@/server/db/schema";

// Pure validation for the sync_settings patch (UI, MCP, CLI all go through it).

export type SyncSettingsPatch = Partial<
  Pick<
    SyncSettings,
    | "enabled"
    | "intervalMinutes"
    | "syncWindowDays"
    | "pendingExpiryDays"
    | "recordBalances"
    | "autoCategorize"
    | "webhookEnabled"
  >
>;

export function validateSettingsPatch(p: SyncSettingsPatch): string | null {
  if (p.intervalMinutes != null && (p.intervalMinutes < 15 || p.intervalMinutes > 1440)) {
    return "Interval must be between 15 minutes and 24 hours.";
  }
  if (p.syncWindowDays != null && (p.syncWindowDays < 3 || p.syncWindowDays > 90)) {
    return "Sync window must be 3–90 days.";
  }
  if (p.pendingExpiryDays != null && (p.pendingExpiryDays < 1 || p.pendingExpiryDays > 30)) {
    return "Pending expiry must be 1–30 days.";
  }
  return null;
}


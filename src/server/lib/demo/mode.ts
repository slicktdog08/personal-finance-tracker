// Demo mode (DEMO_MODE=1): a public instance full of generated data. The app must never reach
// a real bank aggregator or fire the AI routine from it — the guards that enforce that import
// from here. No server-only imports: scripts and the proxy can use it too.

import { parseDbUrl } from "../db-url";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

/**
 * The database a demo reset may wipe: DATABASE_URL, and only DATABASE_URL.
 *
 * A demo reset deletes the whole ledger, so it must never follow DATABASE_MIGRATION_URL. Next
 * fills in variables a command line leaves unset from `.env.local`, so a local demo started
 * with an inline scratch DATABASE_URL still inherits the live DATABASE_MIGRATION_URL. When
 * both are set and name different databases the setup is ambiguous, and the reset refuses.
 */
export function demoResetTarget(
  env: Record<string, string | undefined> = process.env,
): { url: string } | { error: string } {
  const url = env.DATABASE_URL?.trim();
  if (!url) return { error: "DATABASE_URL is not set." };
  const migration = env.DATABASE_MIGRATION_URL?.trim();
  if (migration) {
    const a = parseDbUrl(url);
    const b = parseDbUrl(migration);
    const same = a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.database === b.database;
    if (!same) {
      return {
        error:
          `DATABASE_URL (${a.database} @ ${a.host}) and DATABASE_MIGRATION_URL (${b.database} @ ${b.host}) ` +
          "point at different databases, so a demo reset can't tell which one is the demo. " +
          "Set both to the demo database, or unset DATABASE_MIGRATION_URL.",
      };
    }
  }
  return { url };
}

/** app_settings key the demo seed writes: proof that a ledger holds demo data, not someone's own. */
export const DEMO_SEEDED_KEY = "demo_seeded";

export const DEMO_LINK_DISABLED = "Bank linking is disabled in the demo — Demo Bank is already connected.";
export const DEMO_ADVISOR_DISABLED =
  "The AI advisor is switched off in the demo. On your own install it runs as a Claude Code routine on your Claude plan.";

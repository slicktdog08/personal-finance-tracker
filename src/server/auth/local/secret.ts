import "server-only";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";

/**
 * The key built-in sessions are signed with.
 *
 * `AUTH_SECRET` wins when set. Otherwise one is generated on first use and kept in
 * `app_settings` (key `auth_secret`), so a fresh install has working sign-in with no
 * extra configuration and every process behind the same database agrees on the key.
 * Anyone who can read that row can already read the finances it protects, so storing
 * it there gives nothing away. Deleting the row (or changing AUTH_SECRET) signs
 * everyone out.
 */
const SETTING_KEY = "auth_secret";

const globalForSecret = globalThis as unknown as { __authSecret?: Promise<Buffer> };

async function load(): Promise<Buffer> {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters (try: openssl rand -hex 32).");
    return Buffer.from(fromEnv, "utf8");
  }

  // INSERT IGNORE then read back: if two processes race, both end up with the winner's key.
  const candidate = randomBytes(32).toString("hex");
  await db.execute(
    sql`INSERT IGNORE INTO app_settings (setting_key, value) VALUES (${SETTING_KEY}, ${JSON.stringify(candidate)})`,
  );
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.settingKey, SETTING_KEY)).limit(1);
  if (typeof row?.value !== "string" || row.value.length < 32) {
    throw new Error("Couldn't read the session signing key from app_settings.");
  }
  return Buffer.from(row.value, "utf8");
}

export function getAuthSecret(): Promise<Buffer> {
  // A failed load (database briefly down) must not be cached as the answer forever.
  globalForSecret.__authSecret ??= load().catch((error) => {
    globalForSecret.__authSecret = undefined;
    throw error;
  });
  return globalForSecret.__authSecret;
}

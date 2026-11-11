// The public demo lets every visitor change anything, so the data is put back on a timer.
// Started once per server process from src/instrumentation.ts, and only when DEMO_MODE=1.
//
// DEMO_RESET_MINUTES sets the interval (default 60; 0 turns the timer off, leaving only the
// reset the container entrypoint does at start-up).
import mysql from "mysql2/promise";
import { parseDbUrl } from "../lib/db-url";
import { demoResetTarget } from "../lib/demo/mode";

export function demoResetMinutes(): number {
  const raw = process.env.DEMO_RESET_MINUTES;
  if (raw === undefined || raw.trim() === "") return 60;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 60;
}

let running = false;

/** Wipes the demo's data and seeds it again. Never throws: the next tick simply retries. */
export async function resetDemoData(): Promise<void> {
  if (process.env.DEMO_MODE !== "1" || running) return;
  // Never DATABASE_MIGRATION_URL: see demoResetTarget. A refusal stops the timer for good.
  const target = demoResetTarget();
  if ("error" in target) {
    console.error(`[demo] reset refused: ${target.error}`);
    stopDemoReset();
    return;
  }
  const url = target.url;
  running = true;
  // Its own connection, not the app's pool: the reseed is a long burst of writes and
  // shouldn't hold pooled connections away from whoever is clicking around.
  let conn: mysql.Connection | undefined;
  try {
    const { seedDemo } = await import("../lib/demo/seed");
    conn = await mysql.createConnection({ ...parseDbUrl(url), charset: "utf8mb4" });
    await seedDemo(conn, { reset: true, onlyIfDemo: true });
    console.log("[demo] sample data reset");
  } catch (error) {
    console.error("[demo] reset failed", error);
    // Not demo data (or not the demo's database): don't keep trying every interval.
    if (error instanceof Error && error.message.includes("refusing to reset")) stopDemoReset();
  } finally {
    await conn?.end().catch(() => {});
    running = false;
  }
}

const globalForDemo = globalThis as unknown as { __demoResetTimer?: NodeJS.Timeout };

function stopDemoReset(): void {
  if (globalForDemo.__demoResetTimer) clearInterval(globalForDemo.__demoResetTimer);
  globalForDemo.__demoResetTimer = undefined;
}

export function startDemoReset(): void {
  const minutes = demoResetMinutes();
  if (process.env.DEMO_MODE !== "1" || minutes === 0 || globalForDemo.__demoResetTimer) return;
  const target = demoResetTarget();
  if ("error" in target) {
    console.error(`[demo] periodic reset NOT started: ${target.error}`);
    return;
  }
  const timer = setInterval(() => void resetDemoData(), minutes * 60_000);
  timer.unref(); // never the reason the process stays alive
  globalForDemo.__demoResetTimer = timer;
  console.log(`[demo] DEMO_MODE on: sample data resets every ${minutes} min`);
}

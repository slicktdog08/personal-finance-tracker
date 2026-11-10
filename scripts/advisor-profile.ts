/**
 * Moves the MCP advisor profile in and out of the database (app_settings.advisor_profile),
 * where the app reads it first — so a new clone or deploy needs no git-ignored file copied in.
 *
 * Usage:
 *   npx tsx scripts/advisor-profile.ts import [file]   load a JSON profile into the DB
 *                                                     (default: config/advisor-profile.json)
 *   npx tsx scripts/advisor-profile.ts export          print the stored profile as JSON
 *
 * The JSON has the shape of config/advisor-profile.example.json. After an import the
 * file is no longer needed and can be deleted. Day to day, the claude.ai advisor edits the
 * profile itself with the update_advisor_profile MCP tool.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import mysql from "mysql2/promise";
import { parseDbUrl } from "../src/server/lib/db-url";

const KEY = "advisor_profile";

async function main() {
  const [cmd = "", file = "config/advisor-profile.json"] = process.argv.slice(2);
  if (cmd !== "import" && cmd !== "export") {
    console.error("Usage: npx tsx scripts/advisor-profile.ts import [file] | export");
    process.exit(1);
  }
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ Set a real DATABASE_URL in .env.local first.");
    process.exit(1);
  }
  const conn = await mysql.createConnection(parseDbUrl(url));
  try {
    if (cmd === "export") {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT `value` FROM app_settings WHERE setting_key = ?",
        [KEY],
      );
      if (!rows.length) {
        console.error("No advisor profile stored yet.");
        process.exit(1);
      }
      const v = rows[0].value;
      console.log(JSON.stringify(typeof v === "string" ? JSON.parse(v) : v, null, 2));
      return;
    }
    const profile = JSON.parse(readFileSync(file, "utf8"));
    for (const k of ["situation", "plan", "dataCaveats", "advisorStyle"]) {
      if (profile[k] != null && !Array.isArray(profile[k])) throw new Error(`"${k}" must be a list of strings`);
    }
    await conn.query(
      "INSERT INTO app_settings (setting_key, `value`) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [KEY, JSON.stringify(profile)],
    );
    console.log(`✓ Stored ${file} as the advisor profile (updatedOn ${profile.updatedOn ?? "unset"}).`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});

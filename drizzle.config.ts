import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { parseDbUrl } from "./src/server/lib/db-url";

// drizzle-kit runs outside Next, so load .env.local explicitly.
config({ path: ".env.local" });

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "Set DATABASE_MIGRATION_URL (or DATABASE_URL) in .env.local before running drizzle-kit.",
  );
}

// Pass discrete credentials (not a URL) so passwords with special chars work.
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: parseDbUrl(url),
  verbose: true,
  strict: true,
});

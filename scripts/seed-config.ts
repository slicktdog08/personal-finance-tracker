/**
 * Seeds the customizable lookup tables (bill_statuses, payment_types) with default
 * colors. Idempotent — upserts by name, never overwrites a color you've customized
 * (uses INSERT ... ON DUPLICATE KEY UPDATE id=id).
 *
 * Run: npx tsx scripts/seed-config.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import { billStatuses, paymentTypes, categories, transactions } from "../src/server/db/schema";
import { parseDbUrl } from "../src/server/lib/db-url";
import { STATUS_DEFAULTS, PAYMENT_TYPE_DEFAULTS, CATEGORY_DEFAULTS } from "../src/constants/enums";

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url || url.includes("REPLACE_WITH_PASSWORD")) {
    console.error("✗ Set a real DATABASE_URL in .env.local first.");
    process.exit(1);
  }
  const pool = mysql.createPool(parseDbUrl(url));
  const db = drizzle(pool, { schema, mode: "default" });
  try {
  // Backfill emoji only where it's still NULL (never clobber a customized emoji/color).
  await db
    .insert(billStatuses)
    .values(
      STATUS_DEFAULTS.map((s, i) => ({
        name: s.name,
        color: s.color,
        emoji: s.emoji,
        isSettled: s.isSettled,
        sortOrder: i,
      })),
    )
    .onDuplicateKeyUpdate({ set: { emoji: sql`COALESCE(emoji, VALUES(emoji))` } });

  await db
    .insert(paymentTypes)
    .values(
      PAYMENT_TYPE_DEFAULTS.map((p, i) => ({ name: p.name, color: p.color, emoji: p.emoji, sortOrder: i })),
    )
    .onDuplicateKeyUpdate({ set: { emoji: sql`COALESCE(emoji, VALUES(emoji))` } });

  // Categories: defaults first, then any categories already used by transactions.
  await db
    .insert(categories)
    .values(CATEGORY_DEFAULTS.map((c, i) => ({ name: c.name, color: c.color, emoji: c.emoji, sortOrder: i })))
    .onDuplicateKeyUpdate({ set: { emoji: sql`COALESCE(emoji, VALUES(emoji))` } });

  const used = await db
    .selectDistinct({ c: transactions.category })
    .from(transactions);
  const existing = new Set((await db.select({ name: categories.name }).from(categories)).map((r) => r.name));
  const extras = used
    .map((r) => r.c)
    .filter((c): c is string => !!c && c.trim() !== "" && !existing.has(c));
  if (extras.length) {
    await db
      .insert(categories)
      .values(extras.map((name, i) => ({ name, color: "#9ca3af", sortOrder: 100 + i })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }

  const [st, pt, ct] = await Promise.all([
    db.select().from(billStatuses),
    db.select().from(paymentTypes),
    db.select().from(categories),
  ]);
  console.log(`✓ bill_statuses=${st.length}, payment_types=${pt.length}, categories=${ct.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

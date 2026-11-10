import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export type LocalUser = typeof users.$inferSelect;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(users);
  return Number(row?.n ?? 0);
}

export async function findUserByEmail(email: string): Promise<LocalUser | null> {
  const [row] = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  return row ?? null;
}

export async function findUserById(id: number): Promise<LocalUser | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function listUsers(): Promise<Pick<LocalUser, "id" | "email" | "name" | "createdAt">[]> {
  return db.select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt }).from(users);
}

export async function insertUser(input: { email: string; name?: string | null; passwordHash: string }): Promise<void> {
  await db.insert(users).values({ email: normalizeEmail(input.email), name: input.name?.trim() || null, passwordHash: input.passwordHash });
}

/**
 * Creates the account only if the table is still empty, in one statement, so two visitors
 * racing the first-run screen can't both become the owner. Returns whether it was created.
 */
export async function insertFirstUser(input: { email: string; name?: string | null; passwordHash: string }): Promise<boolean> {
  const [result] = await db.execute(sql`
    INSERT INTO users (email, name, password_hash)
    SELECT ${normalizeEmail(input.email)}, ${input.name?.trim() || null}, ${input.passwordHash}
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users)
  `);
  return (result as { affectedRows?: number }).affectedRows === 1;
}

export async function updatePasswordHash(id: number, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

/**
 * A short fingerprint of the stored hash, carried in refresh and API tokens. Changing the
 * password changes the fingerprint, which is what makes those tokens stop working — the
 * tokens are otherwise stateless and there is no session table to delete from.
 */
export function passwordVersion(user: Pick<LocalUser, "passwordHash">): string {
  return createHash("sha256").update(user.passwordHash).digest("hex").slice(0, 16);
}

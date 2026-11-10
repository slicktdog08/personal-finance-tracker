import "server-only";
import { isDemoMode } from "../provider";
import { setSessionCookies } from "../session";
import type { RefreshResult, SignInResult } from "../types";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { issueAccessAndIdTokens, issueTokens, userForRefreshToken } from "./tokens";
import { countUsers, findUserByEmail, insertFirstUser, insertUser, normalizeEmail, updatePasswordHash } from "./users";

const GENERIC_CREDENTIALS_ERROR = "That email or password isn't right.";

// ---------------------------------------------------------------------------
// Demo account
// ---------------------------------------------------------------------------

/** The shared account the public demo signs visitors in to. Public by design. */
export function demoCredentials(): { email: string; password: string } {
  return {
    email: normalizeEmail(process.env.DEMO_EMAIL || "demo@example.com"),
    password: process.env.DEMO_PASSWORD || "demo-password",
  };
}

/** Makes sure the demo account exists with the advertised password. Demo mode only. */
export async function ensureDemoUser(): Promise<void> {
  if (!isDemoMode()) return;
  const { email, password } = demoCredentials();
  const existing = await findUserByEmail(email);
  if (!existing) {
    await insertUser({ email, name: "Demo User", passwordHash: await hashPassword(password) });
  } else if (!(await verifyPassword(password, existing.passwordHash))) {
    await updatePasswordHash(existing.id, await hashPassword(password));
  }
}

// ---------------------------------------------------------------------------
// Sign-in throttle
// ---------------------------------------------------------------------------

// Per-process and in-memory: enough to make online guessing impractical for a single-user
// app without a table to maintain. A restart clears it, which only ever helps the owner.
const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
  // Bound the map: an attacker cycling addresses shouldn't grow it without limit.
  if (failures.size > 5000) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

// A real hash to burn the same time on when the address is unknown, so response time
// doesn't reveal which addresses have an account.
let decoyHash: Promise<string> | undefined;

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

export async function signIn(input: { email: string; password: string }): Promise<SignInResult> {
  const email = normalizeEmail(input.email);
  if (!email || !input.password) return { ok: false, error: "Enter your email and password." };

  const demo = isDemoMode();
  if (!demo && throttled(email)) return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };

  try {
    if (demo) await ensureDemoUser();
    const user = await findUserByEmail(email);
    const matches = user
      ? await verifyPassword(input.password, user.passwordHash)
      : (await verifyPassword(input.password, await (decoyHash ??= hashPassword("decoy-password"))), false);
    if (!user || !matches) {
      recordFailure(email);
      return { ok: false, error: GENERIC_CREDENTIALS_ERROR };
    }
    failures.delete(email);
    await setSessionCookies(await issueTokens(user));
    return { ok: true };
  } catch (error) {
    console.error("[auth] sign-in failed", error);
    return { ok: false, error: "Couldn't sign you in right now. Try again." };
  }
}

/** True when built-in auth has no account yet, i.e. the login screen should offer to create one. */
export async function isFirstRun(): Promise<boolean> {
  return !isDemoMode() && (await countUsers()) === 0;
}

/**
 * First-run setup: creates the owner's account and signs them in. Only ever succeeds once —
 * this is a single-user app, so there is no sign-up after the first account exists.
 */
export async function createFirstUser(input: { email: string; password: string; name?: string }): Promise<SignInResult> {
  if (isDemoMode()) return { ok: false, error: "Accounts can't be created in the demo." };
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 255) return { ok: false, error: "Enter a valid email address." };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };

  try {
    const created = await insertFirstUser({ email, name: input.name, passwordHash: await hashPassword(input.password) });
    if (!created) return { ok: false, error: "An account already exists. Sign in instead." };
    const user = await findUserByEmail(email);
    if (!user) return { ok: false, error: "The account was created but couldn't be loaded. Sign in." };
    await setSessionCookies(await issueTokens(user));
    return { ok: true };
  } catch (error) {
    console.error("[auth] first-run account creation failed", error);
    return { ok: false, error: "Couldn't create the account. Is the database migrated? (npm run db:init)" };
  }
}

export async function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  try {
    const user = await userForRefreshToken(refreshToken);
    if (!user) return { ok: false, reason: "invalid" };
    return { ok: true, ...(await issueAccessAndIdTokens(user)) };
  } catch (error) {
    console.error("[auth] token refresh failed", error);
    return { ok: false, reason: "error" };
  }
}

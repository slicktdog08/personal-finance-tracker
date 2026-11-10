import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing for built-in auth: scrypt from node:crypto, so there is no native
 * module to compile and nothing to install. The parameters travel inside the stored
 * string (`scrypt$N$r$p$salt$hash`, base64url), so they can be raised later without
 * invalidating existing hashes.
 *
 * Pure (no `server-only`, no database) so the CLI and the unit tests can use it.
 */
const N = 1 << 15; // ~32 MB, ~60 ms per hash on a small VPS
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export const MIN_PASSWORD_LENGTH = 8;
// scrypt cost is independent of input length, but there is no reason to hash a megabyte.
export const MAX_PASSWORD_LENGTH = 512;

function scrypt(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Returns a message when the password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return "That password is too long.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  // maxmem must cover 128 * N * r bytes; Node's 32 MB default is exactly too small for N=2^15.
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 256 * N * R });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** False for a wrong password and for a stored value this code can't read; never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const cost = Number(n);
  const blockSize = Number(r);
  const parallel = Number(p);
  // Refuse absurd parameters rather than let a tampered row pin a CPU.
  if (!Number.isInteger(cost) || cost < 2 || cost > 1 << 20 || !Number.isInteger(blockSize) || blockSize > 32) return false;
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    const expected = Buffer.from(hashB64, "base64url");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
      N: cost,
      r: blockSize,
      p: parallel,
      maxmem: 256 * cost * blockSize,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

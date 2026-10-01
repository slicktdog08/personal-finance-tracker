import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Provider access tokens at rest. AES-256-GCM under SYNC_TOKEN_ENCRYPTION_KEY (32 bytes,
// hex — `openssl rand -hex 32`). Stored form: base64( iv[12] ‖ tag[16] ‖ ciphertext ).
// The token is the only thing that can read the bank, so a DB dump alone must not be enough.

const ALG = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const hex = process.env.SYNC_TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "SYNC_TOKEN_ENCRYPTION_KEY must be 32 bytes as hex (openssl rand -hex 32). See .env.example.",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) throw new Error("Corrupt encrypted token");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALG, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function hasTokenKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

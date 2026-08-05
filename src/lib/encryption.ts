import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-layer encryption for secrets stored at rest — currently
 * only `snaptrade_users.user_secret` (a live credential granting read
 * access to a user's real brokerage data; see CLAUDE.md's Database
 * section). AES-256-GCM via Node's built-in `crypto` (no new dependency,
 * matching `digest.ts`'s existing use of `node:crypto` for hashing).
 *
 * There's deliberately no `SUPABASE_SERVICE_ROLE_KEY` anywhere in this
 * app (see CLAUDE.md) — encrypting in the app layer, with the key only
 * ever in server env, keeps that true: the database never holds anything
 * that decrypts itself, unlike a pgcrypto approach where the key would
 * need to pass through a Postgres function.
 *
 * Output packs `iv (12 bytes) + authTag (16 bytes) + ciphertext` into one
 * base64 string, so the `text` column needs no schema change.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.BROKERAGE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "BROKERAGE_TOKEN_ENCRYPTION_KEY isn't set — can't encrypt or decrypt brokerage secrets."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BROKERAGE_TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256.");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(packed: string): string {
  const key = getKey();
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

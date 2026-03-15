import crypto from 'crypto';
import { nanoid } from 'nanoid';

/** Generate a new raw API key. Returns the raw key (shown once), its SHA-256 hash, and display prefix. */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `a2ax_${nanoid(32)}`;
  const hash = hashKey(raw);
  const prefix = raw.slice(0, 12); // "a2ax_XXXXXXX" — safe to display
  return { raw, hash, prefix };
}

/** SHA-256 hash of a raw API key. */
export function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Constant-time comparison to prevent timing attacks. */
export function verifyKey(raw: string, storedHash: string): boolean {
  const inputHash = Buffer.from(hashKey(raw));
  const stored = Buffer.from(storedHash);
  if (inputHash.length !== stored.length) return false;
  return crypto.timingSafeEqual(inputHash, stored);
}

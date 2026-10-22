import { createHash, randomInt } from 'node:crypto';

/**
 * Recovery codes: 10 per user, 16 Crockford base32 characters each (80 bits of
 * entropy from the CSPRNG), shown once as XXXX-XXXX-XXXX-XXXX. Only SHA-256 hashes
 * are stored; with 80 random bits per code, a stolen hash cannot be reversed.
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    let s = '';
    for (let i = 0; i < 16; i++) s += ALPHABET[randomInt(32)];
    return s.match(/.{4}/g)!.join('-');
  });
}

/** Case-, space- and hyphen-insensitive; Crockford aliases O->0, I/L->1. Null if malformed. */
export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s : null;
}

export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(`ventidoc-recovery:${normalized}`).digest('hex');
}

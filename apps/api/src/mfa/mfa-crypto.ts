import { KeyRing, keyIdOf as genericKeyIdOf, openWith, parseKeyRing as parseGeneric, sealWith } from '../common/keyring';

/**
 * Authenticated encryption for TOTP secrets at rest (AES-256-GCM), on the shared key
 * ring implementation (common/keyring.ts). Keys: MFA_ENCRYPTION_KEYS (separate from
 * the email key ring). The user ID is the associated data.
 */
export type MfaKeyRing = KeyRing;

export function parseKeyRing(raw: string, activeKeyId: string): MfaKeyRing {
  return parseGeneric(raw, activeKeyId, 'MFA_ENCRYPTION_KEYS');
}

const aad = (userId: string) => `ventidoc-mfa-totp:${userId}`;

export function seal(ring: MfaKeyRing, userId: string, plaintext: string): string {
  return sealWith(ring, aad(userId), plaintext);
}

export const keyIdOf = genericKeyIdOf;

/** Throws on any tampering, wrong user, unknown key or malformed input. */
export function open(ring: MfaKeyRing, userId: string, sealed: string): string {
  return openWith(ring, aad(userId), sealed, 'mfa');
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for TOTP secrets at rest (AES-256-GCM).
 *
 * Keys live outside the database (MFA_ENCRYPTION_KEYS); a dump of the credential
 * tables alone does not reveal any secret. Format:
 *   v1:<keyId>:<iv base64url>:<ciphertext base64url>:<tag base64url>
 * The user ID is bound as additional authenticated data, so a ciphertext copied to
 * another user's row fails to decrypt. Rotation: add a key, make it active; old
 * ciphertexts stay readable and are re-encrypted on use or by `pnpm api mfa:reencrypt`.
 */
export interface MfaKeyRing {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[a-z0-9]{1,16}$/;

/** "k1:<base64 32 bytes>,k2:<base64 32 bytes>" */
export function parseKeyRing(raw: string, activeKeyId: string): MfaKeyRing {
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':');
    const id = entry.slice(0, idx);
    if (idx < 1 || !KEY_ID.test(id)) throw new Error('MFA_ENCRYPTION_KEYS: invalid key id (expected [a-z0-9]{1,16}:<base64 key>)');
    const key = Buffer.from(entry.slice(idx + 1), 'base64');
    if (key.length !== 32) throw new Error(`MFA_ENCRYPTION_KEYS: key "${id}" must be exactly 32 random bytes, base64-encoded`);
    if (keys.has(id)) throw new Error(`MFA_ENCRYPTION_KEYS: duplicate key id "${id}"`);
    keys.set(id, key);
  }
  if (keys.size === 0) throw new Error('MFA_ENCRYPTION_KEYS must contain at least one key');
  if (!keys.has(activeKeyId)) throw new Error('MFA_ENCRYPTION_ACTIVE_KEY_ID must name a key in MFA_ENCRYPTION_KEYS');
  return { activeKeyId, keys };
}

const aad = (userId: string) => Buffer.from(`ventidoc-mfa-totp:${userId}`, 'utf8');

export function seal(ring: MfaKeyRing, userId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ring.keys.get(ring.activeKeyId)!, iv);
  cipher.setAAD(aad(userId));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', ring.activeKeyId, iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(':');
}

export function keyIdOf(sealed: string): string | null {
  const parts = sealed.split(':');
  return parts.length === 5 && parts[0] === 'v1' ? parts[1] : null;
}

/** Throws on any tampering, wrong user, unknown key or malformed input. */
export function open(ring: MfaKeyRing, userId: string, sealed: string): string {
  const parts = sealed.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('mfa: malformed ciphertext');
  const key = ring.keys.get(parts[1]);
  if (!key) throw new Error('mfa: ciphertext key is not in the key ring');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'));
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(Buffer.from(parts[4], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}

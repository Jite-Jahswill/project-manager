import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM key ring shared by MFA secrets and email credentials. Keys live outside
 * the database. Ciphertext: v1:<keyId>:<iv>:<ct>:<tag>. The caller supplies associated
 * data binding a ciphertext to its owner (user, provider, outbox row), so a ciphertext
 * copied elsewhere fails to decrypt.
 */
export interface KeyRing {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[a-z0-9]{1,16}$/;

/** "k1:<base64 32 bytes>,k2:<base64 32 bytes>"; `envName` names the variable in errors. */
export function parseKeyRing(raw: string, activeKeyId: string, envName: string): KeyRing {
  const activeName = envName.replace(/_KEYS$/, '_ACTIVE_KEY_ID');
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':');
    const id = entry.slice(0, idx);
    if (idx < 1 || !KEY_ID.test(id)) throw new Error(`${envName}: invalid key id (expected [a-z0-9]{1,16}:<base64 key>)`);
    const key = Buffer.from(entry.slice(idx + 1), 'base64');
    if (key.length !== 32) throw new Error(`${envName}: key "${id}" must be exactly 32 random bytes, base64-encoded`);
    if (keys.has(id)) throw new Error(`${envName}: duplicate key id "${id}"`);
    keys.set(id, key);
  }
  if (keys.size === 0) throw new Error(`${envName} must contain at least one key`);
  if (!keys.has(activeKeyId)) throw new Error(`${activeName} must name a key in ${envName}`);
  return { activeKeyId, keys };
}

export function sealWith(ring: KeyRing, aad: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ring.keys.get(ring.activeKeyId)!, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', ring.activeKeyId, iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(':');
}

export function keyIdOf(sealed: string): string | null {
  const parts = sealed.split(':');
  return parts.length === 5 && parts[0] === 'v1' ? parts[1] : null;
}

/** Throws on tampering, wrong associated data, unknown key or malformed input. */
export function openWith(ring: KeyRing, aad: string, sealed: string, label = 'ciphertext'): string {
  const parts = sealed.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new Error(`${label}: malformed ciphertext`);
  const key = ring.keys.get(parts[1]);
  if (!key) throw new Error(`${label}: ciphertext key is not in the key ring`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[4], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}

/** Key IDs that protect at least one stored secret but are absent from the ring. */
export function missingKeyIds(usage: Record<string, number>, ring: string[]): string[] {
  return Object.keys(usage).filter((id) => usage[id] > 0 && !ring.includes(id)).sort();
}

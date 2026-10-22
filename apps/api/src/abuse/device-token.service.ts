import { Inject, Injectable } from '@nestjs/common';
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { safeEqual } from '../common/crypto';

const VERSION = 'vdd1';
export const DEVICE_TOKEN_MAX_AGE_SECONDS = 180 * 86_400;
export const DEVICE_COOKIE = 'vd_dev';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

export interface DeviceClaim {
  userId: string;
  deviceId: string;
  /** Credential epoch the token was issued under (ms of the last password change, 0 = never). */
  credentialEpoch: number;
}

/** The user's credential epoch: changes on every password reset, which revokes all tokens issued before. */
export function credentialEpoch(user: { passwordChangedAt: Date | null }): number {
  return user.passwordChangedAt ? user.passwordChangedAt.getTime() : 0;
}

/**
 * "Recognized client" tokens for login rate limiting (OWASP device-cookie pattern).
 *
 * What they are, precisely: signed BEARER tokens, not device-bound credentials.
 * Whoever presents the token is treated as a client that previously completed a
 * successful login for that account; nothing ties it to hardware. A copied token
 * works from anywhere. That is acceptable because the token grants no access at all:
 * it only selects which login rate-limit bucket applies (login.device instead of
 * the shared login.account bucket), and a correct password is still required.
 *
 * Properties:
 *  - HMAC-SHA256 with a key derived (HKDF) from ABUSE_PROTECTION_SECRET (>= 32 random bytes)
 *  - bound to one user ID; never honored for another account
 *  - bound to the user's credential epoch: any password reset revokes every earlier token
 *  - expires after 180 days; strict claim validation; no other inputs (headers) consulted
 *  - global revocation: rotate ABUSE_PROTECTION_SECRET
 */
@Injectable()
export class DeviceTokenService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(hkdfSync('sha256', config.abuseProtectionSecret, 'ventidoc', 'device-token', 32));
  }

  issue(userId: string, epoch: number, existingDeviceId?: string): string {
    const payload = Buffer.from(
      JSON.stringify({ u: userId, d: existingDeviceId ?? randomBytes(16).toString('base64url'), t: Math.floor(Date.now() / 1000), p: epoch }),
    ).toString('base64url');
    return `${VERSION}.${payload}.${this.sign(payload)}`;
  }

  /** Signature, format, expiry and claim validation only. Use recognize() for login decisions. */
  verify(token: unknown): DeviceClaim | null {
    if (typeof token !== 'string' || token.length > 512) return null;
    const [version, payload, sig, extra] = token.split('.');
    if (version !== VERSION || !payload || !sig || extra !== undefined || !safeEqual(sig, this.sign(payload))) return null;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!data || typeof data !== 'object' || Object.keys(data).sort().join(',') !== 'd,p,t,u') return null;
    const { u, d, t, p } = data;
    if (typeof u !== 'string' || !UUID.test(u)) return null;
    if (typeof d !== 'string' || !DEVICE_ID.test(d)) return null;
    if (typeof t !== 'number' || !Number.isInteger(t)) return null;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0) return null;
    const age = Math.floor(Date.now() / 1000) - t;
    if (age < -60 || age > DEVICE_TOKEN_MAX_AGE_SECONDS) return null;
    return { userId: u, deviceId: d, credentialEpoch: p };
  }

  /** A valid token for exactly this user, issued under the user's current credentials. */
  recognize(token: unknown, user: { id: string; passwordChangedAt: Date | null } | null): DeviceClaim | null {
    if (!user) return null;
    const claim = this.verify(token);
    if (!claim || claim.userId !== user.id || claim.credentialEpoch !== credentialEpoch(user)) return null;
    return claim;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(`${VERSION}.${payload}`).digest('base64url');
  }
}

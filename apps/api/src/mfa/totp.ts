import { timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';

/**
 * TOTP (RFC 6238) compatible with standard authenticator apps:
 * HMAC-SHA1, 6 digits, 30-second steps. Generation is delegated to `otpauth`
 * (verified against the RFC 6238 vectors in totp.spec.ts).
 *
 * Accepted clock drift: one step either side (±30 s). Every candidate is compared in
 * constant time, all three are always computed, and the matched step is returned so
 * the caller can reject replays atomically (a step at or below the last accepted one).
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DRIFT_STEPS = 1;
const ISSUER = 'Ventidoc';

export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function totp(secretBase32: string, label = 'account'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function otpauthUri(secretBase32: string, accountLabel: string): string {
  return totp(secretBase32, accountLabel).toString();
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Normalizes user input ("123 456" -> "123456"); null if not exactly six digits. */
export function normalizeTotpCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 16) return null;
  const code = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

/** For tests and enrollment UX only: the code for a given time. */
export function totpAt(secretBase32: string, nowMs: number): string {
  return totp(secretBase32).generate({ timestamp: nowMs });
}

/**
 * @returns the matched time step, or null. Does not enforce replay protection by
 * itself: the caller must atomically require step > last accepted step.
 */
export function matchTotp(secretBase32: string, rawCode: unknown, nowMs = Date.now()): number | null {
  const code = normalizeTotpCode(rawCode);
  if (!code) return null;
  const t = totp(secretBase32);
  const now = currentStep(nowMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    const step = now + d;
    const expected = Buffer.from(t.generate({ timestamp: step * TOTP_PERIOD_SECONDS * 1000 }));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

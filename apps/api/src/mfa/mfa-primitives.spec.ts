import * as OTPAuth from 'otpauth';
import { keyIdOf, open, parseKeyRing, seal } from './mfa-crypto';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { currentStep, matchTotp, newTotpSecret, normalizeTotpCode, otpauthUri, totpAt } from './totp';

const key = (n: number) => Buffer.alloc(32, n).toString('base64');

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors (via otpauth)', () => {
    const t = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 8, period: 30, secret: OTPAuth.Secret.fromLatin1('12345678901234567890') });
    expect(t.generate({ timestamp: 59_000 })).toBe('94287082');
    expect(t.generate({ timestamp: 1_111_111_109_000 })).toBe('07081804');
    expect(t.generate({ timestamp: 1_234_567_890_000 })).toBe('89005924');
    expect(t.generate({ timestamp: 20_000_000_000_000 })).toBe('65353130');
  });

  it('accepts the current step and ±1 step of drift, nothing further', () => {
    const secret = newTotpSecret();
    const now = Date.UTC(2026, 9, 22, 12, 0, 15);
    const step = currentStep(now);
    expect(matchTotp(secret, totpAt(secret, now), now)).toBe(step);
    expect(matchTotp(secret, totpAt(secret, now - 30_000), now)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, now + 30_000), now)).toBe(step + 1);
    expect(matchTotp(secret, totpAt(secret, now - 60_000), now)).toBeNull();
    expect(matchTotp(secret, totpAt(secret, now + 60_000), now)).toBeNull();
    expect(matchTotp(newTotpSecret(), totpAt(secret, now), now)).toBeNull();
  });

  it('validates code format strictly', () => {
    expect(normalizeTotpCode('123 456')).toBe('123456');
    expect(normalizeTotpCode('123-456')).toBe('123456');
    for (const bad of ['12345', '1234567', 'abcdef', '12345a', '', null, undefined, 123456, '１２３４５６', '1'.repeat(40)]) {
      expect(normalizeTotpCode(bad)).toBeNull();
      expect(matchTotp(newTotpSecret(), bad)).toBeNull();
    }
  });

  it('produces a standard otpauth:// URI with 160-bit secrets', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri(secret, 'owner@example.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Ventidoc:owner%40example\.test\?/);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('MFA secret encryption (AES-256-GCM)', () => {
  const ring = parseKeyRing(`k1:${key(1)},k2:${key(2)}`, 'k2');

  it('round-trips with the active key and records the key id', () => {
    const sealed = seal(ring, 'user-a', 'JBSWY3DPEHPK3PXP');
    expect(keyIdOf(sealed)).toBe('k2');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(ring, 'user-a', sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(seal(ring, 'user-a', 'x')).not.toBe(seal(ring, 'user-a', 'x')); // fresh IV
  });

  it('old keys stay readable after rotation; removed keys and other users fail', () => {
    const old = seal(parseKeyRing(`k1:${key(1)}`, 'k1'), 'user-a', 'SECRET');
    expect(open(ring, 'user-a', old)).toBe('SECRET');
    expect(() => open(parseKeyRing(`k2:${key(2)}`, 'k2'), 'user-a', old)).toThrow(/not in the key ring/);
    expect(() => open(ring, 'user-b', old)).toThrow(); // AAD binds the user
  });

  it('detects tampering', () => {
    const sealed = seal(ring, 'user-a', 'SECRET');
    const p = sealed.split(':');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    for (const i of [2, 3, 4]) {
      const t = [...p];
      t[i] = flip(t[i]);
      expect(() => open(ring, 'user-a', t.join(':'))).toThrow();
    }
    expect(() => open(ring, 'user-a', 'v2:k1:a:b:c')).toThrow(/malformed/);
  });
});

describe('recovery codes', () => {
  it('generates 10 distinct 80-bit codes in the display format', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('normalizes input forgivingly and hashes deterministically', () => {
    const [code] = generateRecoveryCodes(1);
    const n = normalizeRecoveryCode(code)!;
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(n);
    expect(normalizeRecoveryCode('O000-0000-0000-000I')).toBe('0000000000000001');
    expect(hashRecoveryCode(n)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(n)).toBe(hashRecoveryCode(normalizeRecoveryCode(code)!));
    for (const bad of ['', 'short', 'U'.repeat(16), '0'.repeat(17), null, 5]) expect(normalizeRecoveryCode(bad)).toBeNull();
  });
});

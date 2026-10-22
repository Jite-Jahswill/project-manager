import { DeviceTokenService } from './device-token.service';
import type { AppConfig } from '../config/env';

const svc = (secret = 's'.repeat(48)) => new DeviceTokenService({ abuseProtectionSecret: secret } as AppConfig);

describe('device tokens', () => {
  const U1 = '3f1c2b9a-1d2e-4f3a-8b4c-5d6e7f8a9b0c';
  const U2 = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';

  it('round-trips and keeps the device ID across re-issues', () => {
    const s = svc();
    const t = s.issue(U1, 0);
    const claim = s.verify(t)!;
    expect(claim.userId).toBe(U1);
    expect(s.verify(s.issue(U1, 0, claim.deviceId))!.deviceId).toBe(claim.deviceId);
  });

  it('recognize(): bound to the user and to the current credential epoch', () => {
    const s = svc();
    const changed = new Date('2026-10-01T00:00:00Z');
    const t = s.issue(U1, changed.getTime());
    expect(s.recognize(t, { id: U1, passwordChangedAt: changed })).not.toBeNull();
    expect(s.recognize(t, { id: U2, passwordChangedAt: changed })).toBeNull(); // another account
    expect(s.recognize(t, { id: U1, passwordChangedAt: new Date('2026-10-02T00:00:00Z') })).toBeNull(); // password reset since
    expect(s.recognize(t, { id: U1, passwordChangedAt: null })).toBeNull();
    expect(s.recognize(t, null)).toBeNull(); // unknown email
  });

  it('rejects tampering, other secrets, junk and oversized input', () => {
    const s = svc();
    const t = s.issue(U1, 0);
    const [v, payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ u: U2, d: 'A'.repeat(22), t: Math.floor(Date.now() / 1000), p: 0 })).toString('base64url');
    expect(s.verify(`${v}.${forged}.${sig}`)).toBeNull();
    expect(s.verify(`${v}.${payload}.${sig}x`)).toBeNull();
    expect(s.verify(`vdd2.${payload}.${sig}`)).toBeNull();
    expect(svc('t'.repeat(48)).verify(t)).toBeNull();
    for (const junk of [undefined, null, 42, '', 'a.b', 'a.b.c.d', 'x'.repeat(600)]) expect(s.verify(junk)).toBeNull();
  });

  it('expires after 180 days', () => {
    const s = svc();
    const now = Date.now();
    jest.useFakeTimers({ now: now - 181 * 86_400_000 });
    const old = s.issue(U1, 0);
    jest.useRealTimers();
    expect(s.verify(old)).toBeNull();
  });

  it('validates claim contents strictly (review F-H)', () => {
    const s = svc();
    const sign = (payload: object) => {
      // Re-sign arbitrary payloads with the real key to test content validation, not the MAC.
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const mac = (s as unknown as { sign(p: string): string }).sign(body);
      return `vdd1.${body}.${mac}`;
    };
    const now = Math.floor(Date.now() / 1000);
    const good = { u: '3f1c2b9a-1d2e-4f3a-8b4c-5d6e7f8a9b0c', d: 'A'.repeat(22), t: now, p: 0 };
    expect(s.verify(sign(good))).not.toBeNull();
    for (const bad of [
      { ...good, u: 'not-a-uuid' }, { ...good, d: 'short' }, { ...good, d: 'A'.repeat(21) + '!' },
      { ...good, t: now + 0.5 }, { ...good, t: '1' }, { ...good, p: -1 }, { ...good, p: 1.5 }, { ...good, extra: 1 },
    ]) {
      expect(s.verify(sign(bad))).toBeNull();
    }
  });
});

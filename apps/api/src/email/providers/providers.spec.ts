import { backoffMs } from '../email-worker.service';
import { ResendAdapter } from './resend.adapter';
import { SmtpAdapter } from './smtp.adapter';
import { CaptureAdapter, LogAdapter } from './dev.adapters';
import { sanitize } from './types';

describe('Resend adapter settings', () => {
  const r = new ResendAdapter();
  it('defaults to the official HTTPS API and validates bounds', () => {
    expect(r.validateSettings({}, true)).toEqual({ apiBaseUrl: 'https://api.resend.com', timeoutMs: 10_000 });
    expect(() => r.validateSettings({ timeoutMs: 100 }, false)).toThrow(/timeoutMs/);
    expect(() => r.validateSettings({ apiKey: 'x' }, false)).toThrow(/Unknown Resend setting/);
  });
  it('refuses plain HTTP except to localhost outside production', () => {
    expect(() => r.validateSettings({ apiBaseUrl: 'http://api.resend.com' }, false)).toThrow(/https/);
    expect(r.validateSettings({ apiBaseUrl: 'http://127.0.0.1:9999' }, false).apiBaseUrl).toBe('http://127.0.0.1:9999');
    expect(() => r.validateSettings({ apiBaseUrl: 'http://127.0.0.1:9999' }, true)).toThrow();
  });
  it('validates key shape; the hint shows only the last 4 characters', () => {
    expect(() => r.validateSecret('not-a-key')).toThrow();
    r.validateSecret('re_abcdefgh1234');
    expect(r.secretHint('re_abcdefgh1234')).toBe('re_…1234');
  });
});

describe('SMTP adapter settings', () => {
  const s = new SmtpAdapter();
  const base = { host: 'smtp.example.net', port: 587, security: 'starttls', username: 'u' };
  it('defaults to verified certificates and sane timeouts', () => {
    expect(s.validateSettings(base, true)).toMatchObject({ verifyCertificate: true, security: 'starttls', connectionTimeoutMs: 10_000 });
  });
  it('rejects insecure transport in production and plaintext to remote hosts', () => {
    expect(() => s.validateSettings({ ...base, security: 'none' }, true)).toThrow(/refused in production/);
    expect(() => s.validateSettings({ ...base, verifyCertificate: false }, true)).toThrow(/Certificate verification/);
    expect(() => s.validateSettings({ ...base, security: 'none' }, false)).toThrow(/only to localhost/);
    expect(s.validateSettings({ host: 'localhost', port: 2525, security: 'none' }, false).security).toBe('none');
  });
  it('rejects malformed values and unknown keys', () => {
    for (const bad of [{ ...base, port: 0 }, { ...base, port: 70000 }, { ...base, host: 'bad host!' }, { ...base, security: 'ssl3' }, { ...base, extra: 1 }, { ...base, socketTimeoutMs: 5 }]) {
      expect(() => s.validateSettings(bad, false)).toThrow();
    }
  });
});

describe('development providers', () => {
  it('are refused in production', () => {
    expect(() => new LogAdapter().validateSettings({}, true)).toThrow(/refused in production/);
    expect(() => new CaptureAdapter().validateSettings({}, true)).toThrow(/refused in production/);
  });
});

describe('error summaries and back-off', () => {
  it('redacts credentials from anything stored or shown', () => {
    expect(sanitize('bad key re_SuperSecret_123 for Bearer abc.def', null)).toBe('bad key re_[redacted] for Bearer [redacted]');
    expect(sanitize('auth failed for hunter2pass', 'hunter2pass')).toBe('auth failed for [redacted]');
  });
  it('backs off exponentially with jitter, bounded by the maximum', () => {
    expect(backoffMs(1, 30, 3600, () => 0)).toBe(15_000);
    expect(backoffMs(1, 30, 3600, () => 1)).toBe(30_000);
    expect(backoffMs(4, 30, 3600, () => 1)).toBe(240_000);
    expect(backoffMs(20, 30, 3600, () => 1)).toBe(3_600_000);
    expect(backoffMs(20, 30, 3600, () => 0)).toBe(1_800_000);
  });
});

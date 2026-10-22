import { DEFAULT_POLICIES, parseRate, resolvePolicies } from './policies';

describe('rate-limit policies', () => {
  it('parses rates', () => {
    expect(parseRate('30/5m')).toEqual({ limit: 30, periodMs: 300_000 });
    expect(parseRate('3/1h')).toEqual({ limit: 3, periodMs: 3_600_000 });
    expect(parseRate('3/600ms')).toEqual({ limit: 3, periodMs: 600 });
    for (const bad of ['30', '30/', '/5m', '0/1m', '30/5y', '-1/1m', '1/50ms', '1/8d']) expect(() => parseRate(bad)).toThrow();
  });

  it('overrides limits but never the failure mode, and rejects unknown names', () => {
    const t = resolvePolicies('login.ip=1/1s, forgot.email=9/2h');
    expect(t['login.ip']).toEqual({ limit: 1, periodMs: 1000, onRedisFailure: 'closed' });
    expect(t['forgot.email']).toEqual({ limit: 9, periodMs: 7_200_000, onRedisFailure: 'closed' });
    expect(t['default.ip']).toEqual(DEFAULT_POLICIES['default.ip']);
    expect(() => resolvePolicies('login.ip=1/1s,nope=1/1s')).toThrow(/Unknown/);
    expect(() => resolvePolicies('login.ip')).toThrow(/Unknown/);
  });

  it('every credential or mail-sending policy fails closed', () => {
    for (const name of Object.keys(DEFAULT_POLICIES) as (keyof typeof DEFAULT_POLICIES)[]) {
      if (/^(login|register|forgot|reset|resend_verification|reauth|invite|platform|mfa|mfa_recovery)\./.test(name)) {
        expect({ name, mode: DEFAULT_POLICIES[name].onRedisFailure }).toEqual({ name, mode: 'closed' });
      }
    }
  });
});

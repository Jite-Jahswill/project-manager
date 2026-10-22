import { parseIp, rateLimitNetwork, resolveClientIp, TrustedProxies } from './client-ip';

describe('parseIp / normalization', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7', 4],
    [' 203.0.113.7 ', '203.0.113.7', 4],
    ['203.0.113.7:51234', '203.0.113.7', 4],
    ['::ffff:203.0.113.7', '203.0.113.7', 4],
    ['::FFFF:cb00:7107', '203.0.113.7', 4],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1', 6],
    ['2001:0db8:0000:0000:0001:0000:0000:0001', '2001:db8::1:0:0:1', 6],
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1', 6],
    ['[2001:db8::1]:443', '2001:db8::1', 6],
    ['[2001:db8::1]', '2001:db8::1', 6],
    ['fe80::1%eth0', 'fe80::1', 6],
    ['::1', '::1', 6],
    ['::', '::', 6],
    ['64:ff9b::192.0.2.33', '64:ff9b::c000:221', 6],
  ])('%s -> %s', (raw, address, family) => {
    expect(parseIp(raw)).toEqual({ address, family });
  });

  it.each(['', 'unknown', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'gibberish', '2001:db8:::1', '1.2.3.4:99999999', 'x'.repeat(200), '01.2.3.4abc'])(
    'rejects %p',
    (raw) => expect(parseIp(raw)).toBeNull(),
  );
});

describe('TrustedProxies', () => {
  it('rejects invalid or trust-everything entries', () => {
    expect(() => new TrustedProxies(['10.0.0.0/33'])).toThrow();
    expect(() => new TrustedProxies(['not-an-ip'])).toThrow();
    expect(() => new TrustedProxies(['0.0.0.0/0'])).toThrow(/every address/);
    expect(() => new TrustedProxies(['::/0'])).toThrow(/every address/);
    expect(() => new TrustedProxies(['10.0.0.1/8/1'])).toThrow();
  });

  it('matches IPv4/IPv6 CIDRs and mapped addresses', () => {
    const t = new TrustedProxies(['10.0.0.0/8', '2001:db8:100::/48', '198.51.100.9']);
    expect(t.has(parseIp('10.20.30.40')!)).toBe(true);
    expect(t.has(parseIp('::ffff:10.1.1.1')!)).toBe(true);
    expect(t.has(parseIp('2001:db8:100:ffff::1')!)).toBe(true);
    expect(t.has(parseIp('2001:db8:101::1')!)).toBe(false);
    expect(t.has(parseIp('198.51.100.9')!)).toBe(true);
    expect(t.has(parseIp('198.51.100.10')!)).toBe(false);
    expect(t.has(parseIp('11.0.0.1')!)).toBe(false);
  });
});

describe('resolveClientIp', () => {
  const none = new TrustedProxies([]);
  const lb = new TrustedProxies(['10.0.0.0/8']);
  const twoTier = new TrustedProxies(['10.0.0.0/8', '192.0.2.0/24']);

  it('direct client: the socket address, forwarding headers ignored', () => {
    expect(resolveClientIp('203.0.113.7', undefined, none)).toBe('203.0.113.7');
    expect(resolveClientIp('203.0.113.7', '1.1.1.1', none)).toBe('203.0.113.7');
    expect(resolveClientIp('::ffff:203.0.113.7', '1.1.1.1', none)).toBe('203.0.113.7');
  });

  it('spoofed header from an untrusted peer is ignored even when proxies are configured', () => {
    expect(resolveClientIp('203.0.113.7', '10.0.0.5, 1.1.1.1', lb)).toBe('203.0.113.7');
  });

  it('one trusted proxy: the rightmost entry is the client', () => {
    expect(resolveClientIp('10.0.0.5', '198.51.100.23', lb)).toBe('198.51.100.23');
    // A client-supplied prefix cannot influence the result.
    expect(resolveClientIp('10.0.0.5', '6.6.6.6, 198.51.100.23', lb)).toBe('198.51.100.23');
  });

  it('multiple proxies: skips every trusted hop, stops at the first untrusted one', () => {
    expect(resolveClientIp('10.0.0.5', '6.6.6.6, 198.51.100.23, 192.0.2.10', twoTier)).toBe('198.51.100.23');
    // Multiple header lines are joined in order.
    expect(resolveClientIp('10.0.0.5', ['6.6.6.6, 198.51.100.23', '192.0.2.10'], twoTier)).toBe('198.51.100.23');
    // With only the first tier trusted, the second-tier proxy is the client.
    expect(resolveClientIp('10.0.0.5', '198.51.100.23, 192.0.2.10', lb)).toBe('192.0.2.10');
  });

  it('a client cannot claim to be a trusted proxy to skip further', () => {
    // 10.9.9.9 was written by the client; it is "trusted" in form but sits left of the real client hop.
    expect(resolveClientIp('10.0.0.5', '10.9.9.9, 198.51.100.23', lb)).toBe('198.51.100.23');
  });

  it('malformed or missing entries fall back to the nearest trusted hop', () => {
    expect(resolveClientIp('10.0.0.5', 'garbage', lb)).toBe('10.0.0.5');
    expect(resolveClientIp('10.0.0.5', '198.51.100.23, garbage', lb)).toBe('10.0.0.5');
    expect(resolveClientIp('10.0.0.5', '', lb)).toBe('10.0.0.5');
    expect(resolveClientIp('10.0.0.5', ' , ,', lb)).toBe('10.0.0.5');
    expect(resolveClientIp('10.0.0.5', undefined, lb)).toBe('10.0.0.5');
    expect(resolveClientIp(undefined, '198.51.100.23', lb)).toBeNull();
    expect(resolveClientIp('not-an-ip', '198.51.100.23', lb)).toBeNull();
  });

  it('IPv6 hops and bracketed/port forms', () => {
    const v6lb = new TrustedProxies(['2001:db8:100::/48']);
    expect(resolveClientIp('2001:db8:100::1', '[2001:DB8:7::42]:5555', v6lb)).toBe('2001:db8:7::42');
    expect(resolveClientIp('2001:db8:100::1', '198.51.100.23:1234', v6lb)).toBe('198.51.100.23');
  });

  it('bounds the work on huge headers', () => {
    const header = Array(10_000).fill('10.0.0.1').join(',');
    expect(resolveClientIp('10.0.0.5', header, lb)).toBe('10.0.0.1');
  });
});

describe('rateLimitNetwork', () => {
  it('IPv4 is keyed per address', () => {
    expect(rateLimitNetwork('203.0.113.7', 64)).toBe('203.0.113.7');
    expect(rateLimitNetwork('::ffff:203.0.113.7', 64)).toBe('203.0.113.7');
  });

  it('IPv6 privacy addresses in one /64 share a key; other /64s do not', () => {
    const a = rateLimitNetwork('2001:db8:1:2:aaaa:bbbb:cccc:dddd', 64);
    const b = rateLimitNetwork('2001:db8:1:2:1111:2222:3333:4444', 64);
    const c = rateLimitNetwork('2001:db8:1:3::1', 64);
    expect(a).toBe('2001:db8:1:2::/64');
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('supports non-nibble prefixes and unknown addresses', () => {
    expect(rateLimitNetwork('2001:db8:abcd:ffff::1', 52)).toBe('2001:db8:abcd:f000::/52');
    expect(rateLimitNetwork('2001:db8::1', 128)).toBe('2001:db8::1/128');
    expect(rateLimitNetwork(null, 64)).toBe('unknown');
  });
});

describe('TrustedProxies breadth limits (review F-D)', () => {
  it('rejects ranges too broad to be a proxy fleet', () => {
    expect(() => new TrustedProxies(['1.0.0.0/1'])).toThrow(/too broad/);
    expect(() => new TrustedProxies(['0.0.0.0/7'])).toThrow(/too broad/);
    expect(() => new TrustedProxies(['2000::/3'])).toThrow(/too broad/);
    expect(() => new TrustedProxies(['2001:db8::/31'])).toThrow(/too broad/);
    expect(() => new TrustedProxies(['10.0.0.0/8', '2001:db8::/32', '203.0.113.0/24'])).not.toThrow();
  });
});

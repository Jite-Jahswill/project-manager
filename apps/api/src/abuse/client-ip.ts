import { BlockList, isIP } from 'node:net';

/**
 * Client IP resolution with explicit proxy trust.
 *
 * Rules (docs/security/rate-limiting-and-abuse-protection.md §2.4):
 *  - The TCP peer address is the client unless the peer is in TRUSTED_PROXIES.
 *  - Only then is X-Forwarded-For consulted, walked right to left, skipping
 *    trusted proxies; the first untrusted address is the client.
 *  - A malformed entry stops the walk: the nearest trusted hop is returned
 *    (safe; at worst it groups clients behind that proxy together).
 *  - No other header (Forwarded, X-Real-IP, ...) is ever read.
 */

export interface ParsedIp {
  /** Canonical form: dotted IPv4, or RFC 5952 IPv6. IPv4-mapped IPv6 becomes IPv4. */
  address: string;
  family: 4 | 6;
}

/** Parses one address as found in a socket or a forwarding header. Returns null if invalid. */
export function parseIp(raw: string | undefined | null): ParsedIp | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s.length > 100) return null;
  // [v6]:port or [v6]
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(s);
  if (bracketed) s = bracketed[1];
  // a.b.c.d:port
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  // zone index (fe80::1%eth0) is local-only information
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  const family = isIP(s);
  if (family === 4) return { address: s.split('.').map((o) => String(Number(o))).join('.'), family: 4 };
  if (family !== 6) return null;
  const groups = expandIpv6(s);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return { address: [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.'), family: 4 };
  }
  return { address: compressIpv6(groups), family: 6 };
}

/** Eight 16-bit groups of an IPv6 address already validated by net.isIP. */
export function expandIpv6(addr: string): number[] {
  let s = addr.toLowerCase();
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    const o = s.slice(lastColon + 1).split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  let parts: string[];
  if (s.includes('::')) {
    const [head, tail] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    parts = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  } else {
    parts = s.split(':');
  }
  return parts.map((p) => parseInt(p, 16));
}

/** RFC 5952 canonical text: lowercase, no leading zeros, longest zero run (≥ 2) as "::". */
export function compressIpv6(groups: number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

const MIN_V4_PREFIX = 8;
const MIN_V6_PREFIX = 32;

export class TrustedProxies {
  private readonly list = new BlockList();
  readonly size: number;

  /** @param entries IPs or CIDRs ("10.0.0.0/8", "2001:db8::/32", "203.0.113.7"). Throws on any invalid entry. */
  constructor(entries: readonly string[]) {
    for (const raw of entries) {
      const [ipPart, prefixPart, extra] = raw.trim().split('/');
      const ip = parseIp(ipPart);
      if (!ip || extra !== undefined) throw new Error(`Invalid TRUSTED_PROXIES entry: ${raw}`);
      const max = ip.family === 4 ? 32 : 128;
      const prefix = prefixPart === undefined ? max : Number(prefixPart);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (prefixPart !== undefined && !/^\d{1,3}$/.test(prefixPart))) {
        throw new Error(`Invalid TRUSTED_PROXIES entry: ${raw}`);
      }
      // A trust-everything entry would let any client spoof its address.
      if (prefix === 0) throw new Error(`TRUSTED_PROXIES entry ${raw} would trust every address`);
      // Anything broader than this is not a proxy fleet; it would let large parts of the
      // internet spoof X-Forwarded-For. (10.0.0.0/8 and a /32 IPv6 allocation remain allowed.)
      if (prefix < (ip.family === 4 ? MIN_V4_PREFIX : MIN_V6_PREFIX)) {
        throw new Error(`TRUSTED_PROXIES entry ${raw} is too broad (minimum /${ip.family === 4 ? MIN_V4_PREFIX : MIN_V6_PREFIX})`);
      }
      this.list.addSubnet(ip.address, prefix, ip.family === 4 ? 'ipv4' : 'ipv6');
    }
    this.size = entries.length;
  }

  has(ip: ParsedIp): boolean {
    return this.size > 0 && this.list.check(ip.address, ip.family === 4 ? 'ipv4' : 'ipv6');
  }
}

/**
 * @param peer   the TCP peer address (req.socket.remoteAddress)
 * @param xff    the raw X-Forwarded-For header value(s)
 * @returns canonical client address, or null if even the peer is unknown
 */
export function resolveClientIp(peer: string | undefined, xff: string | string[] | undefined, trusted: TrustedProxies): string | null {
  let current = parseIp(peer);
  if (!current) return null;
  if (!trusted.has(current) || xff === undefined) return current.address;

  const hops = (Array.isArray(xff) ? xff.join(',') : xff)
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .slice(-32); // bounded work; anything further left is attacker-controlled anyway

  while (trusted.has(current) && hops.length > 0) {
    const next = parseIp(hops.pop());
    if (!next) break; // malformed: keep the nearest trusted hop
    current = next;
  }
  return current.address;
}

/** The rate-limit subject for an address: the address itself for IPv4, its /prefix network for IPv6. */
export function rateLimitNetwork(address: string | null, ipv6Prefix: number): string {
  const ip = parseIp(address);
  if (!ip) return 'unknown';
  if (ip.family === 4) return ip.address;
  const groups = expandIpv6(ip.address);
  const masked = groups.map((g, i) => {
    const bitsBefore = i * 16;
    if (bitsBefore >= ipv6Prefix) return 0;
    const keep = Math.min(16, ipv6Prefix - bitsBefore);
    return keep === 16 ? g : g & (0xffff << (16 - keep)) & 0xffff;
  });
  return `${compressIpv6(masked)}/${ipv6Prefix}`;
}

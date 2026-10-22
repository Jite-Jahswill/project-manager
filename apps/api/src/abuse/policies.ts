/**
 * Rate-limit policies. "limit per period" with a burst of `limit` (GCRA).
 *
 * onRedisFailure:
 *   closed - refuse with 503 while the shared limiter is unavailable (credential and
 *            mail-sending endpoints, privileged operations: abuse is worse than an outage)
 *   open   - allow and log (requests that already need a secret token or a session,
 *            and the coarse global limit)
 *
 * Rationale and endpoint mapping: docs/security/rate-limiting-and-abuse-protection.md §3.
 */
export type FailureMode = 'open' | 'closed';

export interface RateLimitPolicy {
  limit: number;
  periodMs: number;
  onRedisFailure: FailureMode;
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;

export const DEFAULT_POLICIES = {
  'default.ip': { limit: 1200, periodMs: M, onRedisFailure: 'open' },
  'login.ip': { limit: 30, periodMs: 5 * M, onRedisFailure: 'closed' },
  'login.ip_account': { limit: 5, periodMs: 15 * M, onRedisFailure: 'closed' },
  'login.account': { limit: 20, periodMs: H, onRedisFailure: 'closed' },
  'login.device': { limit: 10, periodMs: 15 * M, onRedisFailure: 'closed' },
  'register.ip': { limit: 10, periodMs: H, onRedisFailure: 'closed' },
  'register.email': { limit: 3, periodMs: H, onRedisFailure: 'closed' },
  'verify_email.ip': { limit: 30, periodMs: 10 * M, onRedisFailure: 'open' },
  'resend_verification.ip': { limit: 10, periodMs: H, onRedisFailure: 'closed' },
  'resend_verification.email': { limit: 3, periodMs: H, onRedisFailure: 'closed' },
  'forgot.ip': { limit: 10, periodMs: H, onRedisFailure: 'closed' },
  'forgot.email': { limit: 3, periodMs: H, onRedisFailure: 'closed' },
  'reset.ip': { limit: 20, periodMs: H, onRedisFailure: 'closed' },
  'refresh.ip': { limit: 600, periodMs: 5 * M, onRedisFailure: 'open' },
  'reauth.session': { limit: 5, periodMs: 15 * M, onRedisFailure: 'closed' },
  'reauth.user': { limit: 10, periodMs: H, onRedisFailure: 'closed' },
  'invite.org': { limit: 50, periodMs: H, onRedisFailure: 'closed' },
  'invite.user': { limit: 20, periodMs: H, onRedisFailure: 'closed' },
  'accept_invite.user': { limit: 10, periodMs: 15 * M, onRedisFailure: 'open' },
  'platform.privileged.user': { limit: 30, periodMs: H, onRedisFailure: 'closed' },
  // MFA (docs/security/mfa.md §6). Verification budgets bound online TOTP guessing by
  // someone who already knows the password; recognized devices get their own bucket.
  'mfa.challenge.user': { limit: 10, periodMs: 15 * M, onRedisFailure: 'closed' },
  'mfa.verify.ip': { limit: 60, periodMs: 5 * M, onRedisFailure: 'closed' },
  'mfa.verify.user': { limit: 5, periodMs: 15 * M, onRedisFailure: 'closed' },
  'mfa.verify.daily': { limit: 20, periodMs: 24 * H, onRedisFailure: 'closed' },
  'mfa.verify.device': { limit: 10, periodMs: 15 * M, onRedisFailure: 'closed' },
  'mfa.enroll.user': { limit: 10, periodMs: H, onRedisFailure: 'closed' },
  'mfa.manage.user': { limit: 5, periodMs: H, onRedisFailure: 'closed' },
  'mfa_recovery.target': { limit: 3, periodMs: 24 * H, onRedisFailure: 'closed' },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof DEFAULT_POLICIES;
export type PolicyTable = Record<PolicyName, RateLimitPolicy>;

export function isPolicyName(name: string): name is PolicyName {
  return Object.prototype.hasOwnProperty.call(DEFAULT_POLICIES, name);
}

const UNITS: Record<string, number> = { ms: 1, s: S, m: M, h: H, d: 24 * H };

/** "30/5m" -> { limit: 30, periodMs: 300000 } */
export function parseRate(raw: string): { limit: number; periodMs: number } {
  const m = /^(\d{1,7})\/(\d{1,6})(ms|s|m|h|d)$/.exec(raw.trim());
  if (!m) throw new Error(`Invalid rate "${raw}" (expected e.g. 30/5m)`);
  const limit = Number(m[1]);
  const periodMs = Number(m[2]) * UNITS[m[3]];
  if (limit < 1 || periodMs < 100 || periodMs > 7 * 24 * H) throw new Error(`Rate "${raw}" is out of range`);
  return { limit, periodMs };
}

/**
 * RATE_LIMIT_OVERRIDES="login.ip=30/5m,forgot.email=3/1h". Only limit/period can be
 * overridden; failure modes are a security decision fixed in code. Unknown names fail.
 */
export function resolvePolicies(overrides: string | undefined): PolicyTable {
  const table = Object.fromEntries(Object.entries(DEFAULT_POLICIES).map(([k, v]) => [k, { ...v }])) as PolicyTable;
  if (!overrides?.trim()) return table;
  for (const entry of overrides.split(',').map((e) => e.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    const name = entry.slice(0, eq).trim();
    if (eq === -1 || !isPolicyName(name)) throw new Error(`Unknown rate-limit policy in RATE_LIMIT_OVERRIDES: "${entry}"`);
    table[name] = { ...table[name], ...parseRate(entry.slice(eq + 1)) };
  }
  return table;
}

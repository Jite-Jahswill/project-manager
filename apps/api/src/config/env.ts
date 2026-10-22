import { TrustedProxies } from '../abuse/client-ip';
import { PolicyTable, resolvePolicies } from '../abuse/policies';
import { MfaKeyRing, parseKeyRing } from '../mfa/mfa-crypto';

/**
 * Validated runtime configuration. The process refuses to start with missing or
 * unsafe values instead of falling back to insecure defaults.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  webOrigins: string[];
  databaseUrl: string;
  /** Credential-store connection (ventidoc_auth role); see CredentialStore. */
  authDatabaseUrl: string;
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  refreshTokenTtlDays: number;
  appPublicUrl: string;
  mailTransport: 'log' | 'capture';
  mailFrom: string;
  /** Shared rate-limiter store. */
  redisUrl: string;
  redisCommandTimeoutMs: number;
  redisConnectTimeoutMs: number;
  /** Keys rate-limit buckets (HMAC) and signs device tokens. */
  abuseProtectionSecret: string;
  /** Proxy IPs/CIDRs allowed to set X-Forwarded-For. Empty = clients connect directly. */
  trustedProxies: string[];
  rateLimitIpv6Prefix: number;
  rateLimitKeyPrefix: string;
  rateLimitPolicies: PolicyTable;
  /** AES-256-GCM keys for TOTP secrets at rest; never stored in the database. */
  mfaKeyRing: MfaKeyRing;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.includes('CHANGE_ME')) throw new Error(`Environment variable ${key} is required`);
  return value;
}

/** Variables replaced in stage 2A; refusing them prevents a stale config from silently trusting every proxy. */
const REMOVED_VARIABLES: Record<string, string> = {
  TRUST_PROXY: 'TRUSTED_PROXIES (an explicit list of proxy IPs/CIDRs)',
  AUTH_RATE_LIMIT_PER_MINUTE: 'RATE_LIMIT_OVERRIDES (per-policy limits)',
};

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Environment variable ${key} must be a positive integer`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error(`Invalid NODE_ENV ${nodeEnv}`);

  const jwtAccessSecret = required(env, 'JWT_ACCESS_SECRET');
  if (Buffer.byteLength(jwtAccessSecret) < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 bytes');

  const databaseUrl = required(env, 'DATABASE_URL');
  if (new URL(databaseUrl).username !== 'ventidoc_app') {
    // The runtime must never connect as the schema owner or a superuser: that would bypass RLS.
    throw new Error('DATABASE_URL must use the ventidoc_app role');
  }

  const authDatabaseUrl = required(env, 'AUTH_DATABASE_URL');
  if (new URL(authDatabaseUrl).username !== 'ventidoc_auth') {
    throw new Error('AUTH_DATABASE_URL must use the ventidoc_auth role');
  }

  const mailTransport = (env.MAIL_TRANSPORT ?? 'log') as AppConfig['mailTransport'];
  if (!['log', 'capture'].includes(mailTransport)) {
    throw new Error(`MAIL_TRANSPORT ${mailTransport} is not implemented yet; see docs/architecture/06-implementation-plan.md`);
  }
  for (const [name, replacement] of Object.entries(REMOVED_VARIABLES)) {
    if (env[name] !== undefined) throw new Error(`${name} is no longer supported; use ${replacement}`);
  }

  const redisUrl = required(env, 'REDIS_URL');
  const redisProtocol = new URL(redisUrl).protocol;
  if (redisProtocol !== 'redis:' && redisProtocol !== 'rediss:') throw new Error('REDIS_URL must be a redis:// or rediss:// URL');

  const abuseProtectionSecret = required(env, 'ABUSE_PROTECTION_SECRET');
  if (Buffer.byteLength(abuseProtectionSecret) < 32) throw new Error('ABUSE_PROTECTION_SECRET must be at least 32 bytes');

  const trustedProxies = (env.TRUSTED_PROXIES ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  new TrustedProxies(trustedProxies); // validates every entry; throws on invalid or trust-everything

  const rateLimitIpv6Prefix = int(env, 'RATE_LIMIT_IPV6_PREFIX', 64);
  if (rateLimitIpv6Prefix < 48 || rateLimitIpv6Prefix > 128) throw new Error('RATE_LIMIT_IPV6_PREFIX must be between 48 and 128');
  const rateLimitKeyPrefix = env.RATE_LIMIT_KEY_PREFIX ?? 'vd';
  if (!/^[a-z0-9_-]{1,32}$/.test(rateLimitKeyPrefix)) throw new Error('RATE_LIMIT_KEY_PREFIX must match [a-z0-9_-]{1,32}');

  const config: AppConfig = {
    nodeEnv,
    port: int(env, 'PORT', 3000),
    webOrigins: (env.WEB_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    databaseUrl,
    authDatabaseUrl,
    jwtAccessSecret,
    jwtAccessTtlSeconds: int(env, 'JWT_ACCESS_TTL_SECONDS', 600),
    refreshTokenTtlDays: int(env, 'REFRESH_TOKEN_TTL_DAYS', 30),
    appPublicUrl: required(env, 'APP_PUBLIC_URL'),
    mailTransport,
    mailFrom: env.MAIL_FROM ?? 'Ventidoc <no-reply@ventidoc.local>',
    redisUrl,
    redisCommandTimeoutMs: int(env, 'REDIS_COMMAND_TIMEOUT_MS', 250),
    redisConnectTimeoutMs: int(env, 'REDIS_CONNECT_TIMEOUT_MS', 2000),
    abuseProtectionSecret,
    trustedProxies,
    rateLimitIpv6Prefix,
    rateLimitKeyPrefix,
    rateLimitPolicies: resolvePolicies(env.RATE_LIMIT_OVERRIDES),
    mfaKeyRing: parseKeyRing(required(env, 'MFA_ENCRYPTION_KEYS'), required(env, 'MFA_ENCRYPTION_ACTIVE_KEY_ID')),
  };

  if (nodeEnv === 'production') {
    throw new Error(`Production mode is not supported yet:\n- ${productionBlockers(config).join('\n- ')}`);
  }
  return config;
}

/**
 * Everything that must be true before production mode can be allowed. Some items
 * are features not built yet; the rest are checks on this configuration.
 */
export function productionBlockers(config: AppConfig): string[] {
  const problems = [
    'a real mail transport is not implemented',
    'MFA recovery approvers need a documented out-of-band identity-verification procedure (docs/security/mfa.md §8)',
    'MFA_ENCRYPTION_KEYS must be supplied by a secret manager/KMS, not a plain environment file',
  ];
  // Disposable values from CI (.github/workflows/ci.yml) or the example file must never reach production.
  for (const [name, value] of [['JWT_ACCESS_SECRET', config.jwtAccessSecret], ['ABUSE_PROTECTION_SECRET', config.abuseProtectionSecret]] as const) {
    if (/ci-only|change_me|changeme|example|test-secret/i.test(value)) problems.push(`${name} is a disposable CI/example value`);
  }
  for (const [id, k] of config.mfaKeyRing.keys) {
    if (/^ci-only|change_?me/i.test(k.toString('latin1'))) problems.push(`MFA_ENCRYPTION_KEYS key "${id}" is a disposable CI/example value`);
  }
  const redis = new URL(config.redisUrl);
  if (redis.protocol !== 'rediss:') problems.push('REDIS_URL must use TLS (rediss://)');
  if (!redis.password) problems.push('REDIS_URL must authenticate (ACL user and password)');
  else if (/^ci-|change_me/i.test(decodeURIComponent(redis.password))) problems.push('REDIS_URL uses a disposable CI/example password');
  if (config.redisCommandTimeoutMs > 500) problems.push('REDIS_COMMAND_TIMEOUT_MS should be at most 500');
  return problems;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

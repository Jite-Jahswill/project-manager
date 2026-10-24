import { TrustedProxies } from '../abuse/client-ip';
import { PolicyTable, resolvePolicies } from '../abuse/policies';
import { MfaKeyRing, parseKeyRing } from '../mfa/mfa-crypto';
import { KeyRing, parseKeyRing as parseGenericKeyRing } from '../common/keyring';
import { resolve as resolvePath } from 'node:path';

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
  /** AES-256-GCM keys for email provider credentials and sensitive outbox values. */
  emailKeyRing: KeyRing;
  /** inline = the API process also runs the delivery worker; external = `pnpm api worker`; off = none. */
  emailWorkerMode: 'inline' | 'external' | 'off';
  emailWorkerPollMs: number;
  emailWorkerLeaseMs: number;
  emailWorkerBatch: number;
  /** Support attachments: only the development/test local-disk driver exists (docs/security/support.md §6). */
  supportStorageDriver: 'local';
  /** Absolute directory for the local driver; outside any served path. */
  supportStorageDir: string;
  /** Redis pub/sub channel for support real-time events (not durable; history is in PostgreSQL). */
  supportEventsChannel: string;
  supportStreamHeartbeatMs: number;
  /** How often an open event stream re-checks its session and permissions. */
  supportStreamRevalidateMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.includes('CHANGE_ME')) throw new Error(`Environment variable ${key} is required`);
  return value;
}

/** Variables replaced in stage 2A; refusing them prevents a stale config from silently trusting every proxy. */
const REMOVED_VARIABLES: Record<string, string> = {
  TRUST_PROXY: 'TRUSTED_PROXIES (an explicit list of proxy IPs/CIDRs)',
  MAIL_TRANSPORT: 'the platform email configuration (docs/security/email.md); development providers are bootstrapped by EMAIL_BOOTSTRAP_DEV_PROVIDER',
  MAIL_FROM: 'sender identities in the platform email configuration (docs/security/email.md)',
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

  const emailWorkerMode = (env.EMAIL_WORKER_MODE ?? 'inline') as AppConfig['emailWorkerMode'];
  if (!['inline', 'external', 'off'].includes(emailWorkerMode)) throw new Error('EMAIL_WORKER_MODE must be inline, external or off');
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

  const supportStorageDriver = (env.SUPPORT_STORAGE_DRIVER ?? 'local') as AppConfig['supportStorageDriver'];
  if (supportStorageDriver !== 'local') throw new Error('SUPPORT_STORAGE_DRIVER must be "local" (the only driver implemented; see docs/security/support.md)');
  const supportEventsChannel = env.SUPPORT_EVENTS_CHANNEL ?? 'ventidoc:support:events';
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(supportEventsChannel)) throw new Error('SUPPORT_EVENTS_CHANNEL must match [A-Za-z0-9:_-]{1,64}');

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
    redisUrl,
    redisCommandTimeoutMs: int(env, 'REDIS_COMMAND_TIMEOUT_MS', 250),
    redisConnectTimeoutMs: int(env, 'REDIS_CONNECT_TIMEOUT_MS', 2000),
    abuseProtectionSecret,
    trustedProxies,
    rateLimitIpv6Prefix,
    rateLimitKeyPrefix,
    rateLimitPolicies: resolvePolicies(env.RATE_LIMIT_OVERRIDES),
    mfaKeyRing: parseKeyRing(required(env, 'MFA_ENCRYPTION_KEYS'), required(env, 'MFA_ENCRYPTION_ACTIVE_KEY_ID')),
    emailKeyRing: parseGenericKeyRing(required(env, 'EMAIL_SECRET_KEYS'), required(env, 'EMAIL_SECRET_ACTIVE_KEY_ID'), 'EMAIL_SECRET_KEYS'),
    emailWorkerMode,
    emailWorkerPollMs: int(env, 'EMAIL_WORKER_POLL_MS', 1000),
    emailWorkerLeaseMs: int(env, 'EMAIL_WORKER_LEASE_MS', 60_000),
    emailWorkerBatch: int(env, 'EMAIL_WORKER_BATCH', 10),
    supportStorageDriver,
    supportStorageDir: resolvePath(env.SUPPORT_STORAGE_DIR ?? '.data/support-attachments'),
    supportEventsChannel,
    supportStreamHeartbeatMs: int(env, 'SUPPORT_STREAM_HEARTBEAT_MS', 25_000),
    supportStreamRevalidateMs: int(env, 'SUPPORT_STREAM_REVALIDATE_MS', 30_000),
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
    'MFA recovery approvers need a documented out-of-band identity-verification procedure (docs/security/mfa.md §8)',
    'MFA_ENCRYPTION_KEYS and EMAIL_SECRET_KEYS must be supplied by a secret manager/KMS, not a plain environment file, with documented backup and rotation procedures',
    'hosting, HA PostgreSQL/Redis, backups and monitoring are not yet selected and validated (docs/operations/hosting.md)',
    'the sending domain must be verified with the provider and production delivery tested end to end (docs/security/email.md §8)',
    'bounce/complaint ingestion (signed provider webhooks feeding suppressions) is not implemented (docs/security/email.md)',
    'support attachments need private object storage with short-lived authorized downloads; only the local-disk development driver exists (docs/security/support.md §6)',
  ];
  for (const [id, k] of config.emailKeyRing.keys) {
    if (/^ci-only|change_?me/i.test(k.toString('latin1'))) problems.push(`EMAIL_SECRET_KEYS key "${id}" is a disposable CI/example value`);
  }
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

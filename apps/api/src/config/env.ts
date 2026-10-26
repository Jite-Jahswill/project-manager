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
  /** Support and expense attachments (docs/security/attachments.md). */
  storage: StorageConfig;
  /** Redis pub/sub channel for support real-time events (not durable; history is in PostgreSQL). */
  supportEventsChannel: string;
  supportStreamHeartbeatMs: number;
  /** How often an open event stream re-checks its session and permissions. */
  supportStreamRevalidateMs: number;
}

export interface S3Config {
  /** Unset: AWS's regional endpoint. Set for S3-compatible services (R2, MinIO, SeaweedFS, ...). */
  endpoint: string | null;
  region: string;
  bucket: string;
  /** Both or neither: unset uses the SDK's default chain (instance/task role, AWS_* variables). */
  accessKeyId: string | null;
  secretAccessKey: string | null;
  forcePathStyle: boolean;
  serverSideEncryption: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId: string | null;
}

export interface StorageConfig {
  /** Where new attachments are written. Objects already stored keep their backend until migrated. */
  driver: 'local' | 's3';
  /** Absolute directory of the local driver (development, tests, and legacy objects awaiting migration). */
  localDir: string;
  s3: S3Config | null;
  /** clamav: clamd over TCP (INSTREAM). none: nothing is scanned, so nothing is ever served. */
  scanner: 'clamav' | 'none';
  clamav: { host: string; port: number; timeoutMs: number } | null;
  /** inline: the API process also runs the scan/sweep worker; external: `pnpm api worker`; off: none. */
  workerMode: 'inline' | 'external' | 'off';
  workerPollMs: number;
  /** An upload still UPLOADING after this long was interrupted: its object (if any) is removed. */
  uploadTtlMs: number;
  /** A file the scanner could not scan this many times becomes SCAN_FAILED (never served). */
  scanMaxAttempts: number;
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
  SUPPORT_STORAGE_DRIVER: 'ATTACHMENT_STORAGE_DRIVER (local | s3; docs/security/attachments.md)',
  SUPPORT_STORAGE_DIR: 'ATTACHMENT_LOCAL_DIR (same meaning; existing files stay where they are)',
};

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Environment variable ${key} must be a positive integer`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Required, not defaulted: a deployment that forgets NODE_ENV must not quietly run in development
  // mode (local-disk attachments, development email providers) instead of being refused.
  if (!env.NODE_ENV) throw new Error('NODE_ENV is required: development, test or production');
  const nodeEnv = env.NODE_ENV as AppConfig['nodeEnv'];
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

  const storage = loadStorageConfig(env);
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
    storage,
    supportEventsChannel,
    supportStreamHeartbeatMs: int(env, 'SUPPORT_STREAM_HEARTBEAT_MS', 25_000),
    supportStreamRevalidateMs: int(env, 'SUPPORT_STREAM_REVALIDATE_MS', 30_000),
  };

  if (nodeEnv === 'production') {
    throw new Error(`Production mode is not supported yet:\n- ${productionBlockers(config).join('\n- ')}`);
  }
  return config;
}

function loadStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const driver = (env.ATTACHMENT_STORAGE_DRIVER ?? 'local') as StorageConfig['driver'];
  if (!['local', 's3'].includes(driver)) throw new Error('ATTACHMENT_STORAGE_DRIVER must be "local" or "s3"');
  const s3 = driver === 's3' || env.S3_BUCKET ? loadS3Config(env) : null;
  const scanner = (env.MALWARE_SCANNER ?? 'none') as StorageConfig['scanner'];
  if (!['clamav', 'none'].includes(scanner)) throw new Error('MALWARE_SCANNER must be "clamav" or "none"');
  const clamHost = env.CLAMAV_HOST ?? '127.0.0.1';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(clamHost)) throw new Error('CLAMAV_HOST must be a host name or IPv4 address');
  const workerMode = (env.ATTACHMENT_WORKER_MODE ?? 'inline') as StorageConfig['workerMode'];
  if (!['inline', 'external', 'off'].includes(workerMode)) throw new Error('ATTACHMENT_WORKER_MODE must be inline, external or off');
  const scanMaxAttempts = int(env, 'ATTACHMENT_SCAN_MAX_ATTEMPTS', 10);
  if (scanMaxAttempts > 100) throw new Error('ATTACHMENT_SCAN_MAX_ATTEMPTS must be at most 100');
  return {
    driver,
    localDir: resolvePath(env.ATTACHMENT_LOCAL_DIR ?? '.data/support-attachments'),
    s3,
    scanner,
    clamav: scanner === 'clamav' ? { host: clamHost, port: int(env, 'CLAMAV_PORT', 3310), timeoutMs: int(env, 'CLAMAV_TIMEOUT_MS', 30_000) } : null,
    workerMode,
    workerPollMs: int(env, 'ATTACHMENT_WORKER_POLL_MS', 5_000),
    uploadTtlMs: int(env, 'ATTACHMENT_UPLOAD_TTL_MS', 15 * 60_000),
    scanMaxAttempts,
  };
}

function loadS3Config(env: NodeJS.ProcessEnv): S3Config {
  const bucket = required(env, 'S3_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('S3_BUCKET is not a valid bucket name');
  const region = required(env, 'S3_REGION');
  if (!/^[a-z0-9-]{2,32}$/.test(region)) throw new Error('S3_REGION must look like eu-west-1 (or "auto")');
  let endpoint: string | null = null;
  if (env.S3_ENDPOINT) {
    const u = new URL(env.S3_ENDPOINT);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || (u.pathname !== '/' && u.pathname !== '')) {
      throw new Error('S3_ENDPOINT must be an http(s) origin without credentials, path or query');
    }
    endpoint = u.origin;
  }
  const accessKeyId = env.S3_ACCESS_KEY_ID || null;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || null;
  if (!!accessKeyId !== !!secretAccessKey) throw new Error('Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (default credential chain)');
  if ([accessKeyId, secretAccessKey].some((v) => v && /CHANGE_ME/.test(v))) throw new Error('S3 credentials must be replaced (CHANGE_ME)');
  const forcePathStyle = (env.S3_FORCE_PATH_STYLE ?? 'false') === 'true';
  if (!['true', 'false'].includes(env.S3_FORCE_PATH_STYLE ?? 'false')) throw new Error('S3_FORCE_PATH_STYLE must be true or false');
  const sse = (env.S3_SSE ?? 'none') as S3Config['serverSideEncryption'];
  if (!['none', 'AES256', 'aws:kms'].includes(sse)) throw new Error('S3_SSE must be none, AES256 or aws:kms');
  const kmsKeyId = env.S3_SSE_KMS_KEY_ID || null;
  if (sse === 'aws:kms' && !kmsKeyId) throw new Error('S3_SSE=aws:kms requires S3_SSE_KMS_KEY_ID');
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, serverSideEncryption: sse, kmsKeyId };
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
    'the attachment bucket must be verified private in the target account (Block Public Access on, no public policy or ACLs), with versioning or backups aligned with database backups, and ClamAV signature updates must be monitored (docs/security/attachments.md §8)',
  ];
  const st = config.storage;
  if (st.driver !== 's3' || !st.s3) problems.push('attachments must be stored in private object storage: ATTACHMENT_STORAGE_DRIVER=s3 (docs/security/attachments.md)');
  if (st.s3?.endpoint && !st.s3.endpoint.startsWith('https://')) problems.push('S3_ENDPOINT must use https');
  if (st.s3 && st.s3.serverSideEncryption === 'none') problems.push('S3_SSE must enable server-side encryption (AES256 or aws:kms)');
  if (st.scanner !== 'clamav') problems.push('attachments must be malware-scanned: MALWARE_SCANNER=clamav (docs/security/attachments.md)');
  if (st.workerMode === 'off') problems.push('ATTACHMENT_WORKER_MODE must be inline or external (scan retries and upload cleanup)');
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

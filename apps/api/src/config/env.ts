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
  /** Rate limit for credential endpoints (requests per minute per client IP). */
  authRateLimitPerMinute: number;
  trustProxy: boolean;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.includes('CHANGE_ME')) throw new Error(`Environment variable ${key} is required`);
  return value;
}

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
  if (nodeEnv === 'production') {
    throw new Error(
      'Production mode is not supported yet: a real mail transport, Redis-backed rate limiting and MFA are still pending.',
    );
  }

  return {
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
    authRateLimitPerMinute: int(env, 'AUTH_RATE_LIMIT_PER_MINUTE', 10),
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

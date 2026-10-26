import { loadConfig, productionBlockers } from './env';

const base = {
  NODE_ENV: 'development',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  DATABASE_URL: 'postgresql://ventidoc_app:pw@localhost:5434/ventidoc',
  AUTH_DATABASE_URL: 'postgresql://ventidoc_auth:pw@localhost:5434/ventidoc',
  REDIS_URL: 'redis://:pw@127.0.0.1:6380',
  ABUSE_PROTECTION_SECRET: 'y'.repeat(48),
  MFA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString('base64')}`,
  MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  EMAIL_SECRET_KEYS: `e1:${Buffer.alloc(32, 5).toString('base64')}`,
  EMAIL_SECRET_ACTIVE_KEY_ID: 'e1',
  APP_PUBLIC_URL: 'http://localhost:3001',
};

describe('config validation', () => {
  it('requires an explicit, exact NODE_ENV (no silent development default)', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: undefined })).toThrow(/NODE_ENV is required/);
    expect(() => loadConfig({ ...base, NODE_ENV: '' })).toThrow(/NODE_ENV is required/);
    for (const v of ['Production', 'prod', 'PRODUCTION', 'staging']) expect(() => loadConfig({ ...base, NODE_ENV: v })).toThrow(/Invalid NODE_ENV/);
    expect(() => loadConfig({ ...base, SUPPORT_STORAGE_DRIVER: 'local' })).toThrow(/ATTACHMENT_STORAGE_DRIVER/);
  });

  it('validates attachment storage and scanner settings strictly', () => {
    const s3 = { ...base, ATTACHMENT_STORAGE_DRIVER: 's3', S3_BUCKET: 'ventidoc-files', S3_REGION: 'eu-west-1' };
    expect(loadConfig(s3).storage.s3).toMatchObject({ bucket: 'ventidoc-files', region: 'eu-west-1', endpoint: null, accessKeyId: null, serverSideEncryption: 'none' });
    expect(() => loadConfig({ ...base, ATTACHMENT_STORAGE_DRIVER: 'gcs' })).toThrow(/ATTACHMENT_STORAGE_DRIVER/);
    expect(() => loadConfig({ ...base, ATTACHMENT_STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() => loadConfig({ ...s3, S3_BUCKET: 'Bad_Bucket' })).toThrow(/S3_BUCKET/);
    expect(() => loadConfig({ ...s3, S3_ACCESS_KEY_ID: 'only-one' })).toThrow(/both/);
    expect(() => loadConfig({ ...s3, S3_ACCESS_KEY_ID: 'CHANGE_ME', S3_SECRET_ACCESS_KEY: 'CHANGE_ME' })).toThrow(/CHANGE_ME/);
    expect(() => loadConfig({ ...s3, S3_ENDPOINT: 'https://user:pw@s3.example.com' })).toThrow(/S3_ENDPOINT/);
    expect(() => loadConfig({ ...s3, S3_ENDPOINT: 'https://s3.example.com/bucket?x=1' })).toThrow(/S3_ENDPOINT/);
    expect(() => loadConfig({ ...s3, S3_SSE: 'aws:kms' })).toThrow(/S3_SSE_KMS_KEY_ID/);
    expect(() => loadConfig({ ...s3, S3_FORCE_PATH_STYLE: 'yes' })).toThrow(/S3_FORCE_PATH_STYLE/);
    expect(() => loadConfig({ ...base, MALWARE_SCANNER: 'virustotal' })).toThrow(/MALWARE_SCANNER/);
    expect(() => loadConfig({ ...base, ATTACHMENT_WORKER_MODE: 'cron' })).toThrow(/ATTACHMENT_WORKER_MODE/);
    expect(() => loadConfig({ ...base, CLAMAV_HOST: 'evil host; rm' })).toThrow(/CLAMAV_HOST/);
    expect(loadConfig({ ...base, MALWARE_SCANNER: 'clamav' }).storage.clamav).toEqual({ host: '127.0.0.1', port: 3310, timeoutMs: 30_000 });
  });

  it('production blockers name each missing attachment control, from the actual configuration', () => {
    const blockers = (env: Record<string, string>) => { try { loadConfig({ ...base, NODE_ENV: 'production', REDIS_URL: 'rediss://:pw@redis.internal:6380', ...env }); return ''; } catch (e) { return (e as Error).message; } };
    const weak = blockers({});
    expect(weak).toMatch(/ATTACHMENT_STORAGE_DRIVER=s3/);
    expect(weak).toMatch(/MALWARE_SCANNER=clamav/);
    const strong = blockers({ ATTACHMENT_STORAGE_DRIVER: 's3', S3_BUCKET: 'vd-prod', S3_REGION: 'eu-west-1', S3_SSE: 'aws:kms', S3_SSE_KMS_KEY_ID: 'alias/vd', MALWARE_SCANNER: 'clamav' });
    expect(strong).not.toMatch(/ATTACHMENT_STORAGE_DRIVER=s3|MALWARE_SCANNER=clamav|S3_SSE must/);
    expect(strong).toMatch(/bucket must be verified private/);
    expect(blockers({ ATTACHMENT_STORAGE_DRIVER: 's3', S3_BUCKET: 'vd-prod', S3_REGION: 'eu-west-1', S3_ENDPOINT: 'http://minio.internal:9000' })).toMatch(/S3_ENDPOINT must use https/);
  });

  it('accepts a valid development config', () => {
    expect(loadConfig(base).port).toBe(3000);
  });
  it('refuses short JWT secrets and placeholders', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'CHANGE_ME' })).toThrow(/required/);
  });
  it('refuses to connect as anything other than the RLS-bound app role', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://postgres:pw@localhost/ventidoc' })).toThrow(/ventidoc_app/);
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://ventidoc_migrator:pw@localhost/ventidoc' })).toThrow(/ventidoc_app/);
  });
  it('refuses a credential-store connection that is not the ventidoc_auth role', () => {
    expect(() => loadConfig({ ...base, AUTH_DATABASE_URL: 'postgresql://ventidoc_app:pw@localhost/ventidoc' })).toThrow(/ventidoc_auth/);
    expect(() => loadConfig({ ...base, AUTH_DATABASE_URL: undefined })).toThrow(/required/);
  });

  it('rejects the removed TRUST_PROXY / AUTH_RATE_LIMIT_PER_MINUTE variables instead of ignoring them', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUSTED_PROXIES/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'false' })).toThrow(/TRUSTED_PROXIES/);
    expect(() => loadConfig({ ...base, AUTH_RATE_LIMIT_PER_MINUTE: '10' })).toThrow(/RATE_LIMIT_OVERRIDES/);
  });

  it('validates rate-limit configuration', () => {
    expect(() => loadConfig({ ...base, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ ...base, REDIS_URL: 'http://x' })).toThrow(/redis/);
    expect(() => loadConfig({ ...base, ABUSE_PROTECTION_SECRET: 'short' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, TRUSTED_PROXIES: '0.0.0.0/0' })).toThrow(/every address/);
    expect(() => loadConfig({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, bogus' })).toThrow(/bogus/);
    expect(() => loadConfig({ ...base, RATE_LIMIT_OVERRIDES: 'login.ipp=1/1m' })).toThrow(/Unknown/);
    expect(() => loadConfig({ ...base, RATE_LIMIT_OVERRIDES: 'login.ip=1/1y' })).toThrow(/Invalid rate/);
    expect(() => loadConfig({ ...base, RATE_LIMIT_IPV6_PREFIX: '32' })).toThrow(/48 and 128/);
    const c = loadConfig({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, 2001:db8::/32', RATE_LIMIT_OVERRIDES: 'login.ip=3/1m' });
    expect(c.trustedProxies).toEqual(['10.0.0.0/8', '2001:db8::/32']);
    expect(c.rateLimitPolicies['login.ip']).toEqual({ limit: 3, periodMs: 60_000, onRedisFailure: 'closed' });
    expect(c.rateLimitPolicies['forgot.email']).toEqual({ limit: 3, periodMs: 3_600_000, onRedisFailure: 'closed' });
  });

  it('lists concrete production blockers, including an unauthenticated or non-TLS Redis', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/rediss/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', REDIS_URL: 'rediss://127.0.0.1:6380' })).toThrow(/authenticate/);
  });

  it('production refuses disposable CI or placeholder secrets (review F-G)', () => {
    const prodish = { ...base, NODE_ENV: 'production', REDIS_URL: 'rediss://:pw@redis.internal:6380' };
    expect(() => loadConfig({ ...prodish, JWT_ACCESS_SECRET: 'ci-only-jwt-secret-that-is-at-least-32-bytes-long' })).toThrow(/JWT_ACCESS_SECRET.*disposable/);
    expect(() => loadConfig({ ...prodish, ABUSE_PROTECTION_SECRET: 'ci-only-abuse-protection-secret-at-least-32-bytes' })).toThrow(/ABUSE_PROTECTION_SECRET.*disposable/);
    expect(() => loadConfig({ ...prodish, REDIS_URL: 'rediss://:ci-redis@redis.internal:6380' })).toThrow(/disposable CI\/example password/);
  });

  it('validates the email key ring and worker mode; rejects the removed MAIL_* variables', () => {
    expect(() => loadConfig({ ...base, EMAIL_SECRET_KEYS: undefined })).toThrow(/EMAIL_SECRET_KEYS/);
    expect(() => loadConfig({ ...base, EMAIL_SECRET_KEYS: 'e1:c2hvcnQ=' })).toThrow(/EMAIL_SECRET_KEYS.*32 random bytes/);
    expect(() => loadConfig({ ...base, EMAIL_SECRET_ACTIVE_KEY_ID: 'zz' })).toThrow(/EMAIL_SECRET_ACTIVE_KEY_ID/);
    expect(() => loadConfig({ ...base, EMAIL_WORKER_MODE: 'cron' })).toThrow(/EMAIL_WORKER_MODE/);
    expect(() => loadConfig({ ...base, MAIL_TRANSPORT: 'log' })).toThrow(/MAIL_TRANSPORT is no longer supported/);
    expect(() => loadConfig({ ...base, MAIL_FROM: 'x' })).toThrow(/MAIL_FROM is no longer supported/);
    expect(loadConfig(base).emailWorkerMode).toBe('inline');
  });

  it('validates the MFA key ring', () => {
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEYS: undefined })).toThrow(/MFA_ENCRYPTION_KEYS/);
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEYS: 'k1:c2hvcnQ=' })).toThrow(/32 random bytes/);
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k2' })).toThrow(/ACTIVE_KEY_ID/);
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEYS: `K!:${Buffer.alloc(32).toString('base64')}` })).toThrow(/key id/);
    const k = Buffer.alloc(32, 1).toString('base64');
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEYS: `k1:${k},k1:${k}` })).toThrow(/duplicate/);
    const c = loadConfig({ ...base, MFA_ENCRYPTION_KEYS: `k1:${k},k2:${Buffer.alloc(32, 2).toString('base64')}`, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k2' });
    expect([...c.mfaKeyRing.keys.keys()]).toEqual(['k1', 'k2']);
    expect(c.mfaKeyRing.activeKeyId).toBe('k2');
  });

  it('refuses production until production transports exist', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/not supported yet/);
  });
  it('keeps the standing production blockers even for an otherwise production-ready configuration', () => {
    // Production-ready storage: a private, encrypted S3 bucket over https, and ClamAV scanning.
    const ready = {
      ...base, REDIS_URL: 'rediss://app:strong-password@redis.internal:6380', ATTACHMENT_STORAGE_DRIVER: 's3', S3_BUCKET: 'vd-prod',
      S3_REGION: 'eu-west-1', S3_SSE: 'aws:kms', S3_SSE_KMS_KEY_ID: 'alias/ventidoc-attachments', MALWARE_SCANNER: 'clamav',
    };
    const blockers = productionBlockers(loadConfig(ready));
    for (const topic of [/recovery approvers/, /secret manager\/KMS.*backup and rotation/, /hosting, HA/, /sending domain must be verified/, /bounce\/complaint ingestion/, /bucket must be verified private/]) {
      expect(blockers.some((b) => topic.test(b))).toBe(true);
    }
    expect(blockers).toHaveLength(6);
    // Without them, each missing control is its own blocker.
    expect(productionBlockers(loadConfig({ ...base, REDIS_URL: ready.REDIS_URL }))).toEqual(expect.arrayContaining([
      expect.stringMatching(/ATTACHMENT_STORAGE_DRIVER=s3/), expect.stringMatching(/MALWARE_SCANNER=clamav/),
    ]));
  });
});

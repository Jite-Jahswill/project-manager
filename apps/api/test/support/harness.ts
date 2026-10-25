import { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { RateLimiter } from '../../src/abuse/rate-limiter.service';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap-app';
import { capturedEmails } from '../../src/email/providers/dev.adapters';
import { currentStep, totpAt } from '../../src/mfa/totp';

export const PASSWORD = 'correct-horse-battery-staple';

export interface TestUser {
  email: string;
  userId: string;
  token: string;
  refreshToken: string;
  sessionId: string;
}

export interface TestOrg {
  id: string;
  mainBranchId: string;
  owner: TestUser;
}

/** Connection pools for assertions that must bypass the HTTP layer. */
export const pools = {
  /** The runtime role: subject to RLS. */
  app: () => new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 }),
  /** The credential-store role. */
  auth: () => new Pool({ connectionString: process.env.TEST_AUTH_DATABASE_URL, max: 2 }),
  /** The schema owner: used only to reset data between test files. */
  migrator: () => new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL, max: 2 }),
};

const DATA_TABLES = [
  'stock_movements', 'stock_balances', 'products', 'audit_events', 'organization_subscriptions',
  'membership_permission_overrides', 'membership_roles', 'role_permission_exclusions', 'role_permissions', 'organization_invitations', 'roles',
  'branches', 'organization_memberships', 'organizations', 'platform_admin_roles', 'platform_admins',
  'refresh_tokens', 'user_action_tokens', 'sessions', 'user_credentials', 'users',
  'email_delivery_attempts', 'email_outbox',
  'support_attachments', 'support_read_markers', 'support_conversation_events', 'support_assignments',
  'support_internal_notes', 'support_messages', 'support_conversations',
];

export async function resetDatabase(): Promise<void> {
  const pool = pools.migrator();
  try {
    await pool.query(`TRUNCATE ${DATA_TABLES.join(', ')} CASCADE`);
  } finally {
    await pool.end();
  }
}

/**
 * Email configuration is durable (it is not data and resetDatabase keeps it). Suites that
 * change it restore the seeded test baseline: CAPTURE provider active, sending on, version-1
 * templates, the seeded sender, no extra providers, secrets or suppressions.
 */
export async function resetEmailConfiguration(): Promise<void> {
  const pool = pools.migrator();
  const auth = pools.auth();
  try {
    await auth.query('DELETE FROM email_provider_secrets');
    await pool.query(`
      UPDATE email_settings SET
        active_provider_id = (SELECT id FROM email_providers WHERE name = 'development-capture'),
        default_sender_id = (SELECT id FROM email_sender_identities ORDER BY created_at LIMIT 1),
        sending_enabled = true, retry_max_attempts = 8, retry_base_delay_seconds = 30, retry_max_delay_seconds = 3600,
        max_sends_per_minute = 10000, test_recipients = '{}'`);
    await pool.query("DELETE FROM email_providers WHERE name <> 'development-capture'");
    await pool.query('DELETE FROM email_sender_identities WHERE id <> (SELECT default_sender_id FROM email_settings WHERE id = 1)');
    await pool.query("UPDATE email_sender_identities SET verified_at = NULL, verification_source = NULL");
    await pool.query('DELETE FROM email_templates WHERE version > 1');
    await pool.query("UPDATE email_templates SET status = 'ACTIVE'");
    await pool.query('DELETE FROM email_suppressions');
  } finally {
    await pool.end();
    await auth.end();
  }
}

export async function createTestApp(
  env: Record<string, string> = {},
  extraImports: (Type | DynamicModule)[] = [],
): Promise<INestApplication> {
  const saved = { ...process.env };
  // Every app instance gets its own key prefix unless a test shares one on purpose
  // (to prove limits are shared across instances).
  Object.assign(process.env, { RATE_LIMIT_KEY_PREFIX: `t${randomBytes(6).toString('hex')}` }, env);
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...extraImports] }).compile();
    // TEST_APP_LOG_LEVELS=error,warn captures warnings (e.g. rate_limit.redis_unavailable with its
    // cause) in a run's output without changing the default quiet logging.
    const levels = (process.env.TEST_APP_LOG_LEVELS ?? 'error').split(',').map((l) => l.trim()).filter(Boolean) as ('error' | 'warn' | 'log')[];
    const app = moduleRef.createNestApplication({ logger: levels });
    configureApp(app);
    try {
      // Listen once on a random loopback port; supertest otherwise opens a server per request.
      await app.listen(0, '127.0.0.1');
    } catch (e) {
      // A refused startup must not leave Redis/PostgreSQL connections open. Nest does not
      // run destroy hooks for an application that never finished initializing, so the
      // known resources are released explicitly.
      await releaseResources(app);
      throw e;
    }
    return app;
  } finally {
    process.env = saved;
  }
}

async function releaseResources(app: INestApplication): Promise<void> {
  const { RedisService } = await import('../../src/abuse/redis.service');
  const { AuthDb } = await import('../../src/auth/auth-db');
  const { PrismaService } = await import('../../src/database/prisma.service');
  const { EmailWorker } = await import('../../src/email/email-worker.service');
  const { SupportRealtimeService } = await import('../../src/support/support-realtime.service');
  const attempts: (() => unknown)[] = [
    () => app.get(EmailWorker).stop(),
    () => app.get(SupportRealtimeService).onApplicationShutdown(),
    () => app.get(RedisService).client.disconnect(),
    () => app.get(AuthDb).onApplicationShutdown(),
    () => app.get(PrismaService).$disconnect(),
    () => app.close(),
  ];
  for (const attempt of attempts) {
    try {
      await attempt();
    } catch {
      /* best effort */
    }
  }
}

export const http = (app: INestApplication) => request(app.getHttpServer());

export function bearer(user: { token: string }) {
  return { Authorization: `Bearer ${user.token}` };
}

const returnedTokens = new Set<string>();

/**
 * Waits for the worker to deliver a NEW mail to `to` containing `path` and returns its
 * token. Delivery is asynchronous, so "newest mail so far" could be an older, already
 * used token; tokens are therefore returned at most once.
 */
export async function tokenFromMail(_app: INestApplication, to: string, path: string, timeoutMs = 8000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    for (const m of [...capturedEmails].reverse()) {
      if (m.to !== to || !m.text.includes(path)) continue;
      const match = m.text.match(/#token=([^\s]+)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      if (token && !returnedTokens.has(token)) {
        returnedTokens.add(token);
        return token;
      }
    }
    if (Date.now() > end) throw new Error(`No new mail to ${to} containing ${path} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** All mails captured so far for `to` (delivered asynchronously by the worker). */
export function mailsTo(to: string) {
  return capturedEmails.filter((m) => m.to === to);
}

/** Waits (polling) for a captured mail to `to` matching `predicate`. */
/** Waits (polling) for a captured mail to `to` matching `predicate`. */
export async function waitForMail(
  _app: INestApplication, to: string, predicate: (m: { subject: string; text: string }) => boolean, timeoutMs = 8000,
): Promise<{ to: string; subject: string; text: string; html: string }> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const found = capturedEmails.filter((m) => m.to === to && predicate(m)).at(-1);
    if (found) return found;
    if (Date.now() > end) throw new Error(`No mail to ${to} matching the predicate within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}.${Date.now()}.${counter}@example.test`.toLowerCase();
}

export async function signUp(app: INestApplication, label: string): Promise<TestUser> {
  const email = uniqueEmail(label);
  const res = await http(app).post('/v1/auth/register').send({ email, password: PASSWORD, displayName: label });
  if (res.status !== 202) {
    // Diagnostics for unexpected 503s (docs/security/rate-limiting-and-abuse-protection.md §8):
    // the limiter's recorded cause, independent of log capture. No subjects or keys are included.
    const { unavailableByReason, lastUnavailable, circuitOpen } = app.get(RateLimiter).stats();
    throw new Error(`register returned ${res.status} ${JSON.stringify(res.body)}; limiter: ${JSON.stringify({ unavailableByReason, lastUnavailable, circuitOpen })}`);
  }
  await http(app).post('/v1/auth/verify-email').send({ token: await tokenFromMail(app, email, '/verify-email') }).expect(200);
  return login(app, email);
}

export interface MfaState {
  secret: string;
  recoveryCodes: string[];
  lastStep: number;
}

/** Authenticator state of test users who enabled MFA (what their phone would hold). */
export const mfaDevices = new Map<string, MfaState>();

/** A TOTP code for a step not yet used by this user (current or next), as a real authenticator would show. */
export function nextTotp(email: string): string {
  const state = mfaDevices.get(email);
  if (!state) throw new Error(`${email} has no MFA`);
  const now = currentStep();
  const step = Math.max(now, state.lastStep + 1);
  if (step > now + 1) throw new Error('TOTP steps exhausted for this 30 s window; use a recovery code');
  state.lastStep = step;
  return totpAt(state.secret, step * 30_000);
}

/**
 * Like nextTotp, but when both usable steps of this window are spent (replay
 * protection), waits for the next 30 s step, as a real user would.
 */
export async function freshTotp(email: string): Promise<string> {
  for (;;) {
    try {
      return nextTotp(email);
    } catch {
      const msToNext = 30_000 - (Date.now() % 30_000) + 50;
      await new Promise((r) => setTimeout(r, msToNext));
    }
  }
}

export async function login(app: INestApplication, email: string): Promise<TestUser> {
  const res = await http(app).post('/v1/auth/login').send({ email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
  if (!res.body.mfaRequired) {
    return { email, userId: res.body.user.id, token: res.body.accessToken, refreshToken: res.body.refreshToken, sessionId: res.body.sessionId };
  }
  const state = mfaDevices.get(email);
  if (!state) throw new Error(`${email} requires MFA but the harness has no authenticator for it`);
  let second: { code?: string; recoveryCode?: string };
  try {
    second = { code: nextTotp(email) };
  } catch {
    second = { recoveryCode: state.recoveryCodes.pop() };
  }
  const v = await http(app).post('/v1/auth/mfa/verify').send({ mfaToken: res.body.mfaToken, ...second }).expect(200);
  return { email, userId: v.body.user.id, token: v.body.accessToken, refreshToken: v.body.refreshToken, sessionId: v.body.sessionId };
}

/**
 * Enables MFA for `user` through the real API: step-up (the session's login counts),
 * emailed setup code, TOTP from the returned secret, confirmation. The given session
 * becomes MFA-verified; the user's other sessions are revoked by the API.
 */
export async function enableMfa(app: INestApplication, user: { email: string; token: string }): Promise<MfaState> {
  const before = mailsTo(user.email).filter((m) => m.subject.includes('setup code')).length;
  const start = await http(app).post('/v1/auth/mfa/enrollment').set(bearer(user)).send({}).expect(200);
  let emailCode: string | undefined;
  if (start.body.emailCodeRequired) {
    // Wait for THIS enrollment's code (delivery is asynchronous).
    const end = Date.now() + 8000;
    while (mailsTo(user.email).filter((m) => m.subject.includes('setup code')).length <= before) {
      if (Date.now() > end) throw new Error('setup code mail not delivered');
      await new Promise((r) => setTimeout(r, 25));
    }
    emailCode = mailsTo(user.email).filter((m) => m.subject.includes('setup code')).at(-1)!.text.match(/\b(\d{8})\b/)?.[1];
  }
  const step = currentStep();
  const confirm = await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(user))
    .send({ code: totpAt(start.body.secret, step * 30_000), ...(emailCode ? { emailCode } : {}) }).expect(200);
  const state = { secret: start.body.secret as string, recoveryCodes: [...(confirm.body.recoveryCodes as string[])], lastStep: step };
  mfaDevices.set(user.email, state);
  return state;
}

export async function createOrg(app: INestApplication, owner: TestUser, label: string): Promise<TestOrg> {
  const slug = `${label}-${Date.now().toString(36)}-${++counter}`.toLowerCase();
  const res = await http(app).post('/v1/organizations').set(bearer(owner)).send({ name: label, slug }).expect(201);
  // Owners must use MFA (docs/security/mfa.md); set it up as a real owner would.
  if (!mfaDevices.has(owner.email)) await enableMfa(app, owner);
  const branches = await http(app).get(`/v1/orgs/${res.body.id}/branches`).set(bearer(owner)).expect(200);
  return { id: res.body.id, mainBranchId: branches.body[0].id, owner };
}

export async function roleId(app: INestApplication, org: TestOrg, name: string): Promise<string> {
  const res = await http(app).get(`/v1/orgs/${org.id}/roles`).set(bearer(org.owner)).expect(200);
  const role = res.body.find((r: { name: string }) => r.name === name);
  if (!role) throw new Error(`Role ${name} not found`);
  return role.id;
}

/** Signs up a new user and makes them a member of `org` with the given role. */
export async function addMember(
  app: INestApplication, org: TestOrg, label: string, roleName: string, branchId?: string,
): Promise<TestUser & { membershipId: string }> {
  const user = await signUp(app, label);
  await http(app)
    .post(`/v1/orgs/${org.id}/invitations`)
    .set(bearer(org.owner))
    .send({ email: user.email, roleId: await roleId(app, org, roleName), ...(branchId ? { branchId } : {}) })
    .expect(201);
  const accepted = await http(app)
    .post('/v1/invitations/accept')
    .set(bearer(user))
    .send({ token: await tokenFromMail(app, user.email, '/accept-invitation') })
    .expect(200);
  return { ...user, membershipId: accepted.body.membershipId };
}

/** Moves an organization to a different plan via platform scope, standing in for the billing integration. */
export async function setPlan(orgId: string, planCode: string, status = 'ACTIVE'): Promise<void> {
  const pool = pools.app();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.platform_scope', 'on', true)");
    const res = await client.query(
      `UPDATE organization_subscriptions SET plan_id = (SELECT id FROM plans WHERE code = $2), status = $3::"SubscriptionStatus"
       WHERE organization_id = $1`,
      [orgId, planCode, status],
    );
    if (res.rowCount !== 1) throw new Error(`setPlan updated ${res.rowCount} rows`);
    await client.query('COMMIT');
  } finally {
    client.release();
    await pool.end();
  }
}

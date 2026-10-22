import { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap-app';
import { MailService } from '../../src/mail/mail.service';

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
  'membership_permission_overrides', 'membership_roles', 'role_permissions', 'organization_invitations', 'roles',
  'branches', 'organization_memberships', 'organizations', 'platform_admin_roles', 'platform_admins',
  'refresh_tokens', 'user_action_tokens', 'sessions', 'user_credentials', 'users',
];

export async function resetDatabase(): Promise<void> {
  const pool = pools.migrator();
  try {
    await pool.query(`TRUNCATE ${DATA_TABLES.join(', ')} CASCADE`);
  } finally {
    await pool.end();
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
    const app = moduleRef.createNestApplication({ logger: ['error'] });
    configureApp(app);
    // Listen once on a random loopback port; supertest otherwise opens a server per request.
    await app.listen(0, '127.0.0.1');
    return app;
  } finally {
    process.env = saved;
  }
}

export const http = (app: INestApplication) => request(app.getHttpServer());

export function bearer(user: { token: string }) {
  return { Authorization: `Bearer ${user.token}` };
}

export function tokenFromMail(app: INestApplication, to: string, path: string): string {
  const messages = app.get(MailService).captured.filter((m) => m.to === to && m.text.includes(path));
  const last = messages.at(-1);
  if (!last) throw new Error(`No mail to ${to} containing ${path}`);
  const match = last.text.match(/#token=([^\s]+)/);
  if (!match) throw new Error('Mail has no token');
  return decodeURIComponent(match[1]);
}

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}.${Date.now()}.${counter}@example.test`.toLowerCase();
}

export async function signUp(app: INestApplication, label: string): Promise<TestUser> {
  const email = uniqueEmail(label);
  await http(app).post('/v1/auth/register').send({ email, password: PASSWORD, displayName: label }).expect(202);
  await http(app).post('/v1/auth/verify-email').send({ token: tokenFromMail(app, email, '/verify-email') }).expect(200);
  return login(app, email);
}

export async function login(app: INestApplication, email: string): Promise<TestUser> {
  const res = await http(app).post('/v1/auth/login').send({ email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
  return { email, userId: res.body.user.id, token: res.body.accessToken, refreshToken: res.body.refreshToken, sessionId: res.body.sessionId };
}

export async function createOrg(app: INestApplication, owner: TestUser, label: string): Promise<TestOrg> {
  const slug = `${label}-${Date.now().toString(36)}-${++counter}`.toLowerCase();
  const res = await http(app).post('/v1/organizations').set(bearer(owner)).send({ name: label, slug }).expect(201);
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
    .send({ token: tokenFromMail(app, user.email, '/accept-invitation') })
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

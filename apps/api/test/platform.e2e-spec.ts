/** Mandatory test 11: platform administration does not grant business-data access. */
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import { bearer, createOrg, createTestApp, http, resetDatabase, signUp, TestOrg, TestUser } from './support/harness';

describe('Platform administration', () => {
  let app: INestApplication;
  let org: TestOrg;
  let admin: TestUser;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'plat-tenant'), 'plat');
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).send({ sku: 'PRIV', name: 'Private' }).expect(201);
    admin = await signUp(app, 'super');
    await bootstrapSuperAdmin(app.get(PrismaService), admin.email);
  });
  afterAll(() => app.close());

  it('bootstrap works only once', async () => {
    const other = await signUp(app, 'second-super');
    await expect(bootstrapSuperAdmin(app.get(PrismaService), other.email)).rejects.toThrow(/already exists/);
  });

  it('ordinary users have no platform access', async () => {
    await http(app).get('/v1/platform/organizations').set(bearer(org.owner)).expect(403);
    await http(app).get('/v1/platform/me').set(bearer(org.owner)).expect(403);
  });

  it('a super administrator sees organization metadata', async () => {
    const res = await http(app).get('/v1/platform/organizations').set(bearer(admin)).expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toContain(org.id);
    expect(JSON.stringify(res.body)).not.toContain('PRIV');
  });

  it('a super administrator cannot read or change tenant business data', async () => {
    for (const path of ['', '/products', '/members', '/roles', '/branches', `/branches/${org.mainBranchId}/stock`, '/audit-events']) {
      const res = await http(app).get(`/v1/orgs/${org.id}${path}`).set(bearer(admin));
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(admin)).send({ sku: 'X', name: 'x' }).expect(403);
  });

  it('privileged platform actions require recent re-authentication', async () => {
    const pastWindow = new Date(Date.now() - 60 * 60_000);
    await app.get(PrismaService).session.update({ where: { id: admin.sessionId }, data: { reauthenticatedAt: pastWindow } });
    const denied = await http(app).patch(`/v1/platform/organizations/${org.id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('step_up_required');
    await http(app).post('/v1/auth/reauthenticate').set(bearer(admin)).send({ password: 'correct-horse-battery-staple' }).expect(204);
    await http(app).patch(`/v1/platform/organizations/${org.id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED' }).expect(200);
  });

  it('suspending an organization blocks its members immediately and is audited', async () => {
    await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).expect(403);
    const audit = await http(app).get('/v1/platform/audit-events?limit=100').set(bearer(admin)).expect(200);
    const event = audit.body.find((e: { action: string }) => e.action === 'platform.organization.status_changed');
    expect(event).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorUserId: admin.userId, organizationId: org.id });
  });
});

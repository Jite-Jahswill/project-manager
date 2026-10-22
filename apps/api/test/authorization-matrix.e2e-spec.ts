/**
 * Exhaustive, route-generated authorization sweeps (security review 2026-10-22).
 *
 * Routes are discovered from the running application, so any endpoint added later
 * is automatically included; any route with an ID parameter that the sweep does
 * not know how to exercise fails the suite.
 *
 *  1. Two unrelated organizations cannot access each other's data.
 *  2. An organization owner cannot administer an unrelated organization, neither
 *     through the other organization's URL nor by using its IDs under their own.
 *  3. Platform administrators hold exactly the privileges of their platform roles,
 *     and none of them grants organization data access.
 */
import { INestApplication } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { PLATFORM_PERMISSION } from '../src/authz/platform-access.guard';
import { PLATFORM_ROLE_TEMPLATES } from '../src/authz/platform-permission-registry';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, setPlan, signUp, TestOrg, TestUser } from './support/harness';
import { DiscoveredRoute, discoverRoutes, fillPath } from './support/routes';

/** Valid request bodies, so foreign-ID requests get past validation and reach the authorization logic. */
const SAMPLE_BODIES: Record<string, object> = {
  'POST /v1/orgs/:orgId/branches': { name: 'Sweep', code: 'SWEEP' },
  'POST /v1/orgs/:orgId/invitations': { email: 'sweep@example.test' },
  'PATCH /v1/orgs/:orgId/members/:membershipId': { status: 'SUSPENDED' },
  'PUT /v1/orgs/:orgId/members/:membershipId/roles': { assignments: [] },
  'POST /v1/orgs/:orgId/members/:membershipId/overrides': { permissionKey: 'inventory.product.read', effect: 'DENY', reason: 'sweep test' },
  'POST /v1/orgs/:orgId/roles': { name: 'Sweep role', permissions: [] },
  'PATCH /v1/orgs/:orgId/roles/:roleId': { name: 'Renamed by sweep' },
  'POST /v1/orgs/:orgId/roles/:roleId/clone': { name: 'Cloned by sweep' },
  'POST /v1/orgs/:orgId/products': { sku: 'SWEEP-1', name: 'Sweep' },
  'PATCH /v1/orgs/:orgId/products/:productId': { name: 'Renamed by sweep' },
  'POST /v1/orgs/:orgId/branches/:branchId/stock/adjustments': { quantityDelta: '1', reason: 'sweep test' },
  'PATCH /v1/platform/organizations/:organizationId/status': { status: 'ACTIVE' },
};

const TENANT_TABLES = [
  'organizations', 'organization_memberships', 'branches', 'organization_invitations', 'roles', 'role_permissions',
  'membership_roles', 'membership_permission_overrides', 'organization_subscriptions', 'products', 'stock_balances',
  'stock_movements', 'audit_events',
];

describe('Authorization sweeps', () => {
  let app: INestApplication;
  let routes: DiscoveredRoute[];
  let a: TestOrg;
  let b: TestOrg;
  let bIds: Record<string, string>;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp({}, [DiscoveryModule]);
    routes = discoverRoutes(app);
    a = await createOrg(app, await signUp(app, 'sweep-owner-a'), 'sweep-a');
    b = await createOrg(app, await signUp(app, 'sweep-owner-b'), 'sweep-b');
    await setPlan(b.id, 'growth');

    // Give organization B one of everything.
    const product = await http(app).post(`/v1/orgs/${b.id}/products`).set(bearer(b.owner)).send({ sku: 'B-SECRET', name: 'B secret' }).expect(201);
    await http(app).post(`/v1/orgs/${b.id}/branches/${b.mainBranchId}/stock/adjustments`).set(bearer(b.owner))
      .set('Idempotency-Key', 'b-seed-stock-1').send({ productId: product.body.id, quantityDelta: '5', reason: 'seed' }).expect(201);
    const member = await addMember(app, b, 'sweep-b-member', 'Cashier', b.mainBranchId);
    const override = await http(app).post(`/v1/orgs/${b.id}/members/${member.membershipId}/overrides`).set(bearer(b.owner))
      .send({ permissionKey: 'sales.sale.refund', effect: 'DENY', reason: 'seed' }).expect(201);
    const role = await http(app).post(`/v1/orgs/${b.id}/roles`).set(bearer(b.owner)).send({ name: 'B custom', permissions: ['inventory.product.read'] }).expect(201);
    const invitation = await http(app).post(`/v1/orgs/${b.id}/invitations`).set(bearer(b.owner)).send({ email: 'b-pending@example.test' }).expect(201);
    bIds = {
      orgId: b.id, branchId: b.mainBranchId, productId: product.body.id, membershipId: member.membershipId,
      overrideId: override.body.id, roleId: role.body.id, invitationId: invitation.body.id, organizationId: b.id,
    };
  });
  afterAll(() => app.close());

  const send = (route: DiscoveredRoute, path: string, user: { token: string }) => {
    const verb = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const body = { ...(SAMPLE_BODIES[`${route.method} ${route.path}`] ?? {}) } as Record<string, unknown>;
    // Resource IDs inside bodies are always the foreign organization's.
    if (route.path.endsWith('/stock/adjustments')) body.productId = bIds.productId;
    return http(app)[verb](path).set(bearer(user)).set('Idempotency-Key', `sweep-${randomUUID()}`).send(body);
  };

  /** Fingerprint of everything organization B owns, read inside B's tenant context. */
  async function fingerprintB(): Promise<Record<string, string>> {
    const pool = pools.app();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [b.id]);
      // Read as B's owner: a context without a member user sees nothing under membership-bound RLS.
      await client.query("SELECT set_config('app.user_id', $1, true)", [b.owner.userId]);
      const out: Record<string, string> = {};
      for (const t of TENANT_TABLES) {
        const res = await client.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x`);
        out[t] = `${res.rows[0].n}:${res.rows[0].h}`;
      }
      return out;
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  }

  const orgRoutes = () => routes.filter((r) => r.path.startsWith('/v1/orgs/:orgId'));

  it('covers every organization route', () => {
    expect(orgRoutes().length).toBeGreaterThanOrEqual(25);
    for (const r of orgRoutes()) expect(() => fillPath(r.path, bIds)).not.toThrow();
  });

  describe("1+2. Organization A's owner against organization B", () => {
    let before: Record<string, string>;
    beforeAll(async () => {
      before = await fingerprintB();
    });

    it("gets 403 on every route under B's URL (all methods, including administration)", async () => {
      const results: string[] = [];
      for (const r of orgRoutes()) {
        const res = await send(r, fillPath(r.path, bIds), a.owner);
        if (res.status !== 403) results.push(`${r.method} ${r.path} -> ${res.status}`);
        expect(JSON.stringify(res.body)).not.toContain('B secret');
      }
      expect(results).toEqual([]);
    });

    it("cannot reach B's records by using B's IDs under A's own URL", async () => {
      const failures: string[] = [];
      for (const r of orgRoutes()) {
        if (!/:(?!orgId)[A-Za-z]+/.test(r.path)) continue; // only routes that address a specific resource
        const res = await send(r, fillPath(r.path, { ...bIds, orgId: a.id }), a.owner);
        if (![403, 404].includes(res.status)) failures.push(`${r.method} ${r.path} -> ${res.status} ${JSON.stringify(res.body)}`);
      }
      expect(failures).toEqual([]);
    });

    it("left organization B's data byte-for-byte unchanged and wrote nothing to B's audit log", async () => {
      const after = await fingerprintB();
      expect(after).toEqual(before);
      // Guard against a vacuous comparison: the fingerprint must actually contain B's data.
      expect(Number(after.products.split(':')[0])).toBeGreaterThan(0);
      expect(Number(after.audit_events.split(':')[0])).toBeGreaterThan(0);
    });

    it("B's owner likewise cannot touch A", async () => {
      const failures: string[] = [];
      for (const r of orgRoutes()) {
        const res = await send(r, fillPath(r.path, { ...bIds, orgId: a.id, branchId: a.mainBranchId }), b.owner);
        if (res.status !== 403) failures.push(`${r.method} ${r.path} -> ${res.status}`);
      }
      expect(failures).toEqual([]);
    });
  });

  describe('3. Platform administrators hold exactly their platform roles\' privileges', () => {
    const platformRoutes = () => routes.filter((r) => Reflect.getMetadata(PLATFORM_PERMISSION, r.handler));

    async function makeAdmin(label: string, roleNames: string[], status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE'): Promise<TestUser> {
      const user = await signUp(app, label);
      await app.get(PrismaService).$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
        await tx.platformAdmin.create({ data: { userId: user.userId, status } });
        for (const name of roleNames) {
          const role = await tx.platformRole.findUniqueOrThrow({ where: { name } });
          await tx.platformAdminRole.create({ data: { adminUserId: user.userId, roleId: role.id } });
        }
      });
      return user;
    }

    beforeAll(async () => {
      await bootstrapSuperAdmin(app.get(PrismaService), (await signUp(app, 'sweep-super')).email);
    });

    it('covers every platform route', () => {
      expect(platformRoutes().length).toBeGreaterThanOrEqual(3);
    });

    it.each(PLATFORM_ROLE_TEMPLATES.map((t) => [t.name, t.permissions] as const))(
      '%s: allowed exactly on routes whose permission the role grants',
      async (name, permissions) => {
        const admin = await makeAdmin(`plat-${name.replace(/\W+/g, '-')}`, [name]);
        const mismatches: string[] = [];
        for (const r of platformRoutes()) {
          const key = Reflect.getMetadata(PLATFORM_PERMISSION, r.handler) as string;
          const res = await send(r, fillPath(r.path, { organizationId: a.id }), admin);
          const allowed = res.status >= 200 && res.status < 300;
          if (allowed !== (permissions as readonly string[]).includes(key)) mismatches.push(`${r.method} ${r.path} (${key}) -> ${res.status}`);
        }
        expect(mismatches).toEqual([]);
        const me = await http(app).get('/v1/platform/me').set(bearer(admin)).expect(200);
        expect(me.body.permissions).toEqual([...permissions].sort());
      },
    );

    it('an administrator record with no roles has no platform privileges', async () => {
      const admin = await makeAdmin('plat-norole', []);
      for (const r of platformRoutes()) {
        const res = await send(r, fillPath(r.path, { organizationId: a.id }), admin);
        expect({ route: r.path, status: res.status }).toEqual({ route: r.path, status: 403 });
      }
    });

    it('a suspended administrator has no platform privileges, even with every role', async () => {
      const admin = await makeAdmin('plat-suspended', PLATFORM_ROLE_TEMPLATES.map((t) => t.name), 'SUSPENDED');
      for (const r of [...platformRoutes(), routes.find((x) => x.path === '/v1/platform/me')!]) {
        const res = await send(r, fillPath(r.path, { organizationId: a.id }), admin);
        expect({ route: r.path, status: res.status }).toEqual({ route: r.path, status: 403 });
      }
    });

    it('removing a platform role takes effect on the next request', async () => {
      const admin = await makeAdmin('plat-demoted', ['Security auditor']);
      await http(app).get('/v1/platform/audit-events').set(bearer(admin)).expect(200);
      await app.get(PrismaService).$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
        await tx.platformAdminRole.deleteMany({ where: { adminUserId: admin.userId } });
      });
      await http(app).get('/v1/platform/audit-events').set(bearer(admin)).expect(403);
    });

    it('no platform role, alone or combined, grants any organization route', async () => {
      const admin = await makeAdmin('plat-all', PLATFORM_ROLE_TEMPLATES.map((t) => t.name));
      const failures: string[] = [];
      for (const r of orgRoutes()) {
        const res = await send(r, fillPath(r.path, { ...bIds, orgId: b.id }), admin);
        if (res.status !== 403) failures.push(`${r.method} ${r.path} -> ${res.status}`);
      }
      expect(failures).toEqual([]);
    });

    it("the platform audit view excludes tenants' business audit trail", async () => {
      const admin = await makeAdmin('plat-audit', ['Security auditor']);
      const res = await http(app).get('/v1/platform/audit-events?limit=100').set(bearer(admin)).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const e of res.body) expect(e.organizationId === null || e.actorType === 'PLATFORM_ADMIN').toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('B secret');
    });
  });
});

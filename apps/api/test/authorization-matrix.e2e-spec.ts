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
import { PLATFORM_PERMISSION, platformPermissionsOf } from '../src/authz/platform-access.guard';
import { request as httpRequest } from 'node:http';
import { PLATFORM_ROLE_TEMPLATES } from '../src/authz/platform-permission-registry';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import { addMember, bearer, createOrg, createTestApp, enableMfa, http, pools, resetDatabase, setPlan, signUp, TestOrg, TestUser } from './support/harness';
import { DiscoveredRoute, discoverRoutes, fillPath } from './support/routes';

/** Valid request bodies, so foreign-ID requests get past validation and reach the authorization logic. */
const SAMPLE_BODIES: Record<string, object> = {
  'POST /v1/orgs/:orgId/branches': { name: 'Sweep', code: 'SWEEP' },
  'PATCH /v1/orgs/:orgId': { version: 1, name: 'Renamed by sweep' },
  'PATCH /v1/orgs/:orgId/branches/:branchId': { version: 1, name: 'Renamed by sweep' },
  'POST /v1/orgs/:orgId/branches/:branchId/archive': { version: 1 },
  'POST /v1/orgs/:orgId/branches/:branchId/reactivate': { version: 1 },
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
  'POST /v1/platform/mfa-recovery-requests': { reason: 'sweep: identity verified out of band (ticket SWEEP-1)' },
  'POST /v1/platform/mfa-recovery-requests/:requestId/approve': {},
  'POST /v1/platform/mfa-recovery-requests/:requestId/reject': { note: 'sweep rejection' },
  // Email administration: harmless or invalid bodies; IDs are random (404). The sweep checks
  // authorization only and must never change the shared email configuration.
  'PATCH /v1/platform/email/settings': {},
  'POST /v1/platform/email/sending': { enabled: 'not-a-boolean' },
  'POST /v1/platform/email/providers': { kind: 'NOT_A_PROVIDER', name: 'sweep' },
  'PATCH /v1/platform/email/providers/:providerId': { name: 'sweep-renamed' },
  'PUT /v1/platform/email/providers/:providerId/secret': { secret: 're_sweepOnlyNotReal1' },
  'POST /v1/platform/email/sender-identities': { email: 'not-an-email' },
  'PATCH /v1/platform/email/sender-identities/:identityId': { displayName: 'sweep' },
  'POST /v1/platform/email/sender-identities/:identityId/attest-domain': { statement: 'sweep attestation statement' },
  'POST /v1/platform/email/templates/:key/versions': { subject: 'x' },
  'POST /v1/platform/email/templates/:key/preview': {},
  'POST /v1/platform/email/test-send': { to: 'not-an-email' },
  'POST /v1/platform/email/suppressions': { email: 'not-an-email' },
  // Support: valid bodies against random conversation IDs (404 once authorized).
  'POST /v1/platform/support/conversations/:conversationId/messages': { body: 'sweep reply' },
  'POST /v1/platform/support/conversations/:conversationId/notes': { body: 'sweep note' },
  'POST /v1/platform/support/conversations/:conversationId/assignment': { assigneeUserId: null, expectedAssigneeUserId: null },
  'PATCH /v1/platform/support/conversations/:conversationId': { version: 1, status: 'OPEN' },
  'POST /v1/platform/support/conversations/:conversationId/read': { upToSeq: 0 },
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

  const sendWith = (route: DiscoveredRoute, path: string, user: { token: string }, extra: object) => {
    const verb = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    return http(app)[verb](path).set(bearer(user)).send({ ...(SAMPLE_BODIES[`${route.method} ${route.path}`] ?? {}), ...extra });
  };

  /** Event streams never end: the status line is the authorization outcome. */
  const openStream = (path: string, user: { token: string }) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const { port } = app.getHttpServer().address() as { port: number };
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { authorization: `Bearer ${user.token}` } }, (res) => {
      resolve({ status: res.statusCode ?? 0, body: {} });
      req.destroy();
    });
    req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    req.end();
  });

  const send = (route: DiscoveredRoute, path: string, user: { token: string }) => {
    if (route.path.endsWith('/stream')) return openStream(path, user);
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
      // Platform administrators must use MFA; enroll like a real admin would.
      await enableMfa(app, user);
      return user;
    }

    /** Disposable target for the MFA-reset route (never org A/B users, whose sessions the sweep relies on). */
    let resetTarget: TestUser;
    // A random request ID: the sweep checks authorization, so "not found" (404) after
    // passing the guards counts as authorized, exactly like any other non-401/403 outcome.
    const random = '7c0d3a1e-1111-4222-8333-444455556666';
    const platformParams = () => ({
      organizationId: a.id, userId: resetTarget.userId, requestId: random,
      providerId: random, identityId: random, deliveryId: random, suppressionId: random, key: 'platform.test', version: '999',
      conversationId: random, attachmentId: random,
    });

    beforeAll(async () => {
      const superAdmin = await signUp(app, 'sweep-super');
      await bootstrapSuperAdmin(app.get(PrismaService), superAdmin.email);
      resetTarget = await signUp(app, 'sweep-mfa-target');
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
          // Any-of routes (inbox OR assigned) are open to holders of any listed key.
          const keys = platformPermissionsOf(r.handler);
          const path = fillPath(r.path, platformParams());
          const res = r.path.startsWith('/v1/platform/mfa-recovery-requests')
            ? await sendWith(r, path, admin, { targetUserId: resetTarget.userId })
            : await send(r, path, admin);
          // Authorized = got past authentication and authorization (business outcomes such
          // as 404/409 still count as authorized; 401/403 do not).
          const allowed = res.status !== 401 && res.status !== 403;
          if (allowed !== keys.some((k) => (permissions as readonly string[]).includes(k))) mismatches.push(`${r.method} ${r.path} (${keys.join('|')}) -> ${res.status}`);
        }
        expect(mismatches).toEqual([]);
        const me = await http(app).get('/v1/platform/me').set(bearer(admin)).expect(200);
        expect(me.body.permissions).toEqual([...permissions].sort());
      },
    );

    it('an administrator record with no roles has no platform privileges', async () => {
      const admin = await makeAdmin('plat-norole', []);
      for (const r of platformRoutes()) {
        const res = await send(r, fillPath(r.path, platformParams()), admin);
        expect({ route: r.path, status: res.status }).toEqual({ route: r.path, status: 403 });
      }
    });

    it('a suspended administrator has no platform privileges, even with every role', async () => {
      const admin = await makeAdmin('plat-suspended', PLATFORM_ROLE_TEMPLATES.map((t) => t.name), 'SUSPENDED');
      for (const r of [...platformRoutes(), routes.find((x) => x.path === '/v1/platform/me')!]) {
        const res = await send(r, fillPath(r.path, platformParams()), admin);
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

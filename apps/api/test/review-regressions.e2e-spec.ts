/**
 * Regression tests for findings of the 2026-10-22 security review
 * (docs/security/2026-10-22-review.md). Each test names its finding ID.
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, roleId, setPlan, signUp, TestOrg,
  tokenFromMail,
} from './support/harness';

describe('Security review regressions', () => {
  let app: INestApplication;
  let a: TestOrg;
  let b: TestOrg;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    a = await createOrg(app, await signUp(app, 'rev-owner-a'), 'rev-a');
    b = await createOrg(app, await signUp(app, 'rev-owner-b'), 'rev-b');
    await setPlan(a.id, 'growth');
  });
  afterAll(() => app.close());

  async function inAppTx<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const pool = pools.app();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [k, v] of Object.entries(settings)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  }

  it('F1: a revoked member who is re-invited does not get their old roles back', async () => {
    const admin = await addMember(app, a, 'resurrect', 'Organization administrator');
    await http(app).patch(`/v1/orgs/${a.id}/members/${admin.membershipId}`).set(bearer(a.owner)).send({ status: 'REVOKED' }).expect(200);
    await http(app).post(`/v1/orgs/${a.id}/invitations`).set(bearer(a.owner))
      .send({ email: admin.email, roleId: await roleId(app, a, 'Read-only viewer') }).expect(201);
    await http(app).post('/v1/invitations/accept').set(bearer(admin))
      .send({ token: await tokenFromMail(app, admin.email, '/accept-invitation') }).expect(200);
    // Viewer only: no member management, no role management.
    await http(app).get(`/v1/orgs/${a.id}/products`).set(bearer(admin)).expect(200);
    await http(app).get(`/v1/orgs/${a.id}/members`).set(bearer(admin)).expect(403);
    await http(app).post(`/v1/orgs/${a.id}/roles`).set(bearer(admin)).send({ name: 'x1', permissions: [] }).expect(403);
  });

  it('F1: roles and overrides cannot be attached to a revoked membership', async () => {
    const m = await addMember(app, a, 'revoked-target', 'Read-only viewer');
    await http(app).patch(`/v1/orgs/${a.id}/members/${m.membershipId}`).set(bearer(a.owner)).send({ status: 'REVOKED' }).expect(200);
    await http(app).put(`/v1/orgs/${a.id}/members/${m.membershipId}/roles`).set(bearer(a.owner))
      .send({ assignments: [{ roleId: await roleId(app, a, 'Cashier') }] }).expect(409);
    await http(app).post(`/v1/orgs/${a.id}/members/${m.membershipId}/overrides`).set(bearer(a.owner))
      .send({ permissionKey: 'inventory.product.read', effect: 'GRANT', reason: 'test' }).expect(409);
  });

  it('F2: reactivating suspended members cannot exceed the member limit', async () => {
    const c = await createOrg(app, await signUp(app, 'limit-owner'), 'rev-limit'); // starter: 5 members
    const members = [];
    for (let i = 0; i < 4; i++) members.push(await addMember(app, c, `lim${i}`, 'Read-only viewer'));
    await http(app).patch(`/v1/orgs/${c.id}/members/${members[0].membershipId}`).set(bearer(c.owner)).send({ status: 'SUSPENDED' }).expect(200);
    await addMember(app, c, 'lim-new', 'Read-only viewer'); // back to 5 active
    const res = await http(app).patch(`/v1/orgs/${c.id}/members/${members[0].membershipId}`).set(bearer(c.owner)).send({ status: 'ACTIVE' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('entitlement_limit_reached');
  });

  it('F2: an invitation cannot be accepted once a downgrade leaves no member slot', async () => {
    const c = await createOrg(app, await signUp(app, 'downgrade-owner'), 'rev-down');
    await setPlan(c.id, 'growth');
    for (let i = 0; i < 4; i++) await addMember(app, c, `down${i}`, 'Read-only viewer'); // 5 active incl. owner
    const late = await signUp(app, 'late-joiner');
    await http(app).post(`/v1/orgs/${c.id}/invitations`).set(bearer(c.owner)).send({ email: late.email }).expect(201);
    await setPlan(c.id, 'starter'); // limit 5, already 5 active
    const res = await http(app).post('/v1/invitations/accept').set(bearer(late))
      .send({ token: await tokenFromMail(app, late.email, '/accept-invitation') });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('entitlement_limit_reached');
  });

  it('F3: an invitation is void once the inviter can no longer grant its role', async () => {
    const admin = await addMember(app, a, 'inviter', 'Organization administrator');
    const target = await signUp(app, 'invitee');
    await http(app).post(`/v1/orgs/${a.id}/invitations`).set(bearer(admin))
      .send({ email: target.email, roleId: await roleId(app, a, 'Inventory manager') }).expect(201);
    await http(app).patch(`/v1/orgs/${a.id}/members/${admin.membershipId}`).set(bearer(a.owner)).send({ status: 'REVOKED' }).expect(200);
    await http(app).post('/v1/invitations/accept').set(bearer(target))
      .send({ token: await tokenFromMail(app, target.email, '/accept-invitation') }).expect(403);
  });

  it('F3: pending invitations can be listed and revoked', async () => {
    const email = 'revoke-me@example.test';
    const inv = await http(app).post(`/v1/orgs/${a.id}/invitations`).set(bearer(a.owner)).send({ email }).expect(201);
    const list = await http(app).get(`/v1/orgs/${a.id}/invitations`).set(bearer(a.owner)).expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).toContain(inv.body.id);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|token_hash/);
    await http(app).delete(`/v1/orgs/${a.id}/invitations/${inv.body.id}`).set(bearer(a.owner)).expect(204);
    // Another organization's owner cannot revoke it.
    await http(app).delete(`/v1/orgs/${a.id}/invitations/${inv.body.id}`).set(bearer(b.owner)).expect(403);
  });

  it('F5: platform scope cannot read tenant business audit data', async () => {
    await http(app).post(`/v1/orgs/${b.id}/products`).set(bearer(b.owner)).send({ sku: 'AUD-SECRET', name: 'Confidential formula' }).expect(201);
    const rows = await inAppTx({ 'app.platform_scope': 'on' }, (c) =>
      c.query("SELECT count(*)::int AS n FROM audit_events WHERE organization_id = $1 AND actor_type <> 'PLATFORM_ADMIN'", [b.id]));
    expect(rows.rows[0].n).toBe(0);
  });

  it("F6: inside one organization's context, the user's memberships in other organizations are invisible", async () => {
    // a.owner is also a member of b.
    await http(app).post(`/v1/orgs/${b.id}/invitations`).set(bearer(b.owner)).send({ email: a.owner.email }).expect(201);
    await http(app).post('/v1/invitations/accept').set(bearer(a.owner))
      .send({ token: await tokenFromMail(app, a.owner.email, '/accept-invitation') }).expect(200);
    const res = await inAppTx({ 'app.org_id': a.id, 'app.user_id': a.owner.userId }, async (c) => ({
      memberships: (await c.query('SELECT DISTINCT organization_id FROM organization_memberships')).rows,
      orgs: (await c.query('SELECT id FROM organizations')).rows,
    }));
    expect(res.memberships).toEqual([{ organization_id: a.id }]);
    expect(res.orgs).toEqual([{ id: a.id }]);
  });

  it('F7: outside platform scope, the runtime role cannot change plans or platform RBAC', async () => {
    await inAppTx({ 'app.org_id': a.id, 'app.user_id': a.owner.userId }, async (c) => {
      const upd = await c.query("UPDATE plan_entitlements SET limit_value = NULL");
      expect(upd.rowCount).toBe(0);
      const price = await c.query("UPDATE plan_prices SET amount_minor = 0");
      expect(price.rowCount).toBe(0);
    });
    await expect(
      inAppTx({ 'app.org_id': a.id, 'app.user_id': a.owner.userId }, (c) =>
        c.query('INSERT INTO platform_admins (user_id, status) VALUES ($1, \'ACTIVE\')', [a.owner.userId])),
    ).rejects.toThrow(/row-level security/);
  });

  it('F8: an organization cannot create itself a paid, active subscription', async () => {
    const orgId = '0b4c3f5e-9a1d-4e2f-8c3b-1a2b3c4d5e6f';
    await expect(
      inAppTx({ 'app.org_id': orgId, 'app.user_id': a.owner.userId }, async (c) => {
        await c.query("INSERT INTO organizations (id, name, slug, created_by_user_id, updated_at) VALUES ($1, 'F8 org', 'f8-org', $2, now())", [orgId, a.owner.userId]);
        await c.query(
          `INSERT INTO organization_subscriptions (organization_id, plan_id, status, current_period_start, current_period_end, updated_at)
           VALUES ($1, (SELECT id FROM plans WHERE code = 'enterprise'), 'ACTIVE', now(), now() + interval '10 years', now())`, [orgId]);
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('F9: the runtime role cannot create objects in the public schema', async () => {
    const pool = pools.app();
    try {
      const res = await pool.query("SELECT has_schema_privilege('public', 'CREATE') AS can");
      expect(res.rows[0].can).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it('F10: a cashier assigned at a branch can read the product catalog (branch-assignable reads)', async () => {
    const cashier = await addMember(app, a, 'branch-cashier', 'Cashier', a.mainBranchId);
    await http(app).get(`/v1/orgs/${a.id}/products`).set(bearer(cashier)).expect(200);
    // ...but organization-scoped administration is never granted through a branch assignment.
    const custom = await http(app).post(`/v1/orgs/${a.id}/roles`).set(bearer(a.owner))
      .send({ name: 'Branch admin attempt', permissions: ['organization.member.manage', 'inventory.stock.read'] }).expect(201);
    const m = await addMember(app, a, 'branch-admin', 'Read-only viewer');
    const res = await http(app).put(`/v1/orgs/${a.id}/members/${m.membershipId}/roles`).set(bearer(a.owner))
      .send({ assignments: [{ roleId: custom.body.id, branchId: a.mainBranchId }] }).expect(200);
    expect(res.body.notAppliedAtBranch).toEqual([{ roleId: custom.body.id, branchId: a.mainBranchId, permissions: ['organization.member.manage'] }]);
    await http(app).get(`/v1/orgs/${a.id}/members`).set(bearer(m)).expect(403);
  });

  it('F11: RBAC changes use the actor\'s access as of the locked transaction, not the guard snapshot', async () => {
    const admin = await addMember(app, a, 'toctou', 'Organization administrator');
    const victim = await addMember(app, a, 'toctou-victim', 'Read-only viewer');
    const cashier = await roleId(app, a, 'Cashier');
    // Hold the organization lock, demote the admin inside it, and let the admin's request queue behind it.
    const pool = pools.app();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.org_id', $1, true)", [a.id]);
      await holder.query("SELECT set_config('app.user_id', $1, true)", [a.owner.userId]);
      const locked = await holder.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [a.id]);
      expect(locked.rowCount).toBe(1); // the lock is really held
      const pending = http(app).put(`/v1/orgs/${a.id}/members/${victim.membershipId}/roles`).set(bearer(admin))
        .send({ assignments: [{ roleId: cashier }] }).then((r) => r);
      // Give the request time to pass the guard and block on the lock.
      await new Promise((r) => setTimeout(r, 400));
      await holder.query('DELETE FROM membership_roles WHERE membership_id = $1', [admin.membershipId]);
      await holder.query('COMMIT');
      const res = await pending;
      expect(res.status).toBe(403);
    } finally {
      holder.release();
      await pool.end();
    }
  });

  it('F12: a member cannot remove their own DENY override', async () => {
    const admin = await addMember(app, a, 'self-undeny', 'Organization administrator');
    const ov = await http(app).post(`/v1/orgs/${a.id}/members/${admin.membershipId}/overrides`).set(bearer(a.owner))
      .send({ permissionKey: 'inventory.product.archive', effect: 'DENY', reason: 'probation' }).expect(201);
    await http(app).delete(`/v1/orgs/${a.id}/members/${admin.membershipId}/overrides/${ov.body.id}`).set(bearer(admin)).expect(403);
  });
});

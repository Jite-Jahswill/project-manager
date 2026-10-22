/**
 * Mandatory tests 3, 4, 5, 8 and 12: branch scoping, least privilege, prompt
 * revocation, no privilege escalation, and audit records for permission changes.
 */
import { INestApplication } from '@nestjs/common';
import { addMember, bearer, createOrg, createTestApp, http, resetDatabase, roleId, setPlan, signUp, TestOrg } from './support/harness';

describe('Organization RBAC', () => {
  let app: INestApplication;
  let org: TestOrg;
  let branch2: string;
  let product: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'rbac-owner'), 'rbac');
    await setPlan(org.id, 'growth');
    branch2 = (await http(app).post(`/v1/orgs/${org.id}/branches`).set(bearer(org.owner)).send({ name: 'Second', code: 'B2' }).expect(201)).body.id;
    product = (await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).send({ sku: 'P1', name: 'Rice' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const adjust = (user: { token: string }, branchId: string, key: string, delta = '1') =>
    http(app).post(`/v1/orgs/${org.id}/branches/${branchId}/stock/adjustments`).set(bearer(user)).set('Idempotency-Key', key)
      .send({ productId: product, quantityDelta: delta, reason: 'count' });

  it('a branch-assigned storekeeper can act only at their branch', async () => {
    const sk = await addMember(app, org, 'storekeeper', 'Storekeeper', org.mainBranchId);
    await adjust(sk, org.mainBranchId, 'sk-main-0001').expect(201);
    await adjust(sk, branch2, 'sk-b2-00001').expect(403);
    await http(app).get(`/v1/orgs/${org.id}/branches/${org.mainBranchId}/stock`).set(bearer(sk)).expect(200);
    await http(app).get(`/v1/orgs/${org.id}/branches/${branch2}/stock`).set(bearer(sk)).expect(403);
  });

  it('a cashier cannot perform administrative, audit or payroll actions', async () => {
    const cashier = await addMember(app, org, 'cashier', 'Cashier', org.mainBranchId);
    await http(app).get(`/v1/orgs/${org.id}/members`).set(bearer(cashier)).expect(403);
    await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(cashier)).send({ name: 'mine', permissions: ['hr.payroll.approve'] }).expect(403);
    await http(app).get(`/v1/orgs/${org.id}/audit-events`).set(bearer(cashier)).expect(403);
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(cashier)).send({ sku: 'C1', name: 'c' }).expect(403);
    const me = await http(app).get(`/v1/orgs/${org.id}`).set(bearer(cashier)).expect(200);
    const all = [...me.body.permissions.organizationWide, ...Object.values<string[]>(me.body.permissions.byBranch).flat()];
    expect(all.filter((k: string) => k.startsWith('hr.payroll') || k.startsWith('finance.'))).toEqual([]);
  });

  it('removing a role takes effect on the very next request with the same token', async () => {
    const im = await addMember(app, org, 'inv-mgr', 'Inventory manager');
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(im)).send({ sku: 'IM1', name: 'by im' }).expect(201);
    await http(app).put(`/v1/orgs/${org.id}/members/${im.membershipId}/roles`).set(bearer(org.owner)).send({ assignments: [] }).expect(200);
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(im)).send({ sku: 'IM2', name: 'by im' }).expect(403);
  });

  it('suspending a membership revokes access immediately', async () => {
    const v = await addMember(app, org, 'viewer', 'Read-only viewer');
    await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(v)).expect(200);
    await http(app).patch(`/v1/orgs/${org.id}/members/${v.membershipId}`).set(bearer(org.owner)).send({ status: 'SUSPENDED' }).expect(200);
    await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(v)).expect(403);
    const mine = await http(app).get('/v1/me/organizations').set(bearer(v)).expect(200);
    expect(mine.body).toEqual([]);
  });

  it('a DENY override beats a role grant', async () => {
    const im = await addMember(app, org, 'denied', 'Inventory manager');
    await http(app).post(`/v1/orgs/${org.id}/members/${im.membershipId}/overrides`).set(bearer(org.owner))
      .send({ permissionKey: 'inventory.product.create', effect: 'DENY', reason: 'probation' }).expect(201);
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(im)).send({ sku: 'D1', name: 'd' }).expect(403);
    await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(im)).expect(200);
  });

  describe('privilege escalation', () => {
    let admin: Awaited<ReturnType<typeof addMember>>;
    beforeAll(async () => {
      admin = await addMember(app, org, 'org-admin', 'Organization administrator');
    });

    it('an org admin cannot create or edit a role with permissions they lack', async () => {
      await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(admin)).send({ name: 'Payroll boss', permissions: ['hr.payroll.approve'] }).expect(403);
      const custom = await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(admin)).send({ name: 'Shelf staff', permissions: ['inventory.product.read'] }).expect(201);
      await http(app).patch(`/v1/orgs/${org.id}/roles/${custom.body.id}`).set(bearer(admin)).send({ permissions: ['inventory.product.read', 'hr.payroll.export'] }).expect(403);
    });

    it('an org admin cannot assign a role containing permissions they lack (including to themselves)', async () => {
      const payroll = await roleId(app, org, 'Payroll officer');
      await http(app).put(`/v1/orgs/${org.id}/members/${admin.membershipId}/roles`).set(bearer(admin))
        .send({ assignments: [{ roleId: payroll }] }).expect(403);
    });

    it('an org admin cannot grant themselves overrides or obtain the Owner role', async () => {
      await http(app).post(`/v1/orgs/${org.id}/members/${admin.membershipId}/overrides`).set(bearer(admin))
        .send({ permissionKey: 'hr.payroll.approve', effect: 'GRANT', reason: 'self-service' }).expect(403);
      const owner = await roleId(app, org, 'Owner');
      const adminRole = await roleId(app, org, 'Organization administrator');
      await http(app).put(`/v1/orgs/${org.id}/members/${admin.membershipId}/roles`).set(bearer(admin))
        .send({ assignments: [{ roleId: adminRole }, { roleId: owner }] }).expect(403);
    });

    it('an org admin cannot suspend the owner', async () => {
      const members = await http(app).get(`/v1/orgs/${org.id}/members`).set(bearer(admin)).expect(200);
      const ownerMembership = members.body.find((m: { user: { id: string } }) => m.user.id === org.owner.userId).membershipId;
      await http(app).patch(`/v1/orgs/${org.id}/members/${ownerMembership}`).set(bearer(admin)).send({ status: 'SUSPENDED' }).expect(403);
    });

    it('the Owner role itself cannot be edited or deleted', async () => {
      const owner = await roleId(app, org, 'Owner');
      await http(app).patch(`/v1/orgs/${org.id}/roles/${owner}`).set(bearer(org.owner)).send({ name: 'Boss' }).expect(403);
      await http(app).delete(`/v1/orgs/${org.id}/roles/${owner}`).set(bearer(org.owner)).expect(403);
    });

    it('request bodies cannot smuggle extra authority fields', async () => {
      await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(admin)).send({ name: 'Sneaky', permissions: [], isSystem: true, templateKey: 'owner' }).expect(400);
    });
  });

  it('the last owner cannot remove their own ownership', async () => {
    const members = await http(app).get(`/v1/orgs/${org.id}/members`).set(bearer(org.owner)).expect(200);
    const mine = members.body.find((m: { user: { id: string } }) => m.user.id === org.owner.userId).membershipId;
    const viewer = await roleId(app, org, 'Read-only viewer');
    const res = await http(app).put(`/v1/orgs/${org.id}/members/${mine}/roles`).set(bearer(org.owner)).send({ assignments: [{ roleId: viewer }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('last_owner');
  });

  it('owners can create, clone and delete custom roles', async () => {
    const role = await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(org.owner)).send({ name: 'Night shift', permissions: ['inventory.stock.read'] }).expect(201);
    const clone = await http(app).post(`/v1/orgs/${org.id}/roles/${role.body.id}/clone`).set(bearer(org.owner)).send({ name: 'Weekend shift' }).expect(201);
    expect(clone.body.permissions).toEqual(['inventory.stock.read']);
    await http(app).delete(`/v1/orgs/${org.id}/roles/${clone.body.id}`).set(bearer(org.owner)).expect(204);
  });

  it('permission and role changes produce audit events with before/after values', async () => {
    const res = await http(app).get(`/v1/orgs/${org.id}/audit-events?limit=100`).set(bearer(org.owner)).expect(200);
    const actions = res.body.map((e: { action: string }) => e.action);
    for (const a of ['organization.role.created', 'organization.role.deleted', 'organization.member.roles_changed',
      'organization.member.status_changed', 'organization.permission_override.created', 'inventory.stock.adjusted']) {
      expect(actions).toContain(a);
    }
    const change = res.body.find((e: { action: string }) => e.action === 'organization.member.roles_changed');
    expect(change.actorUserId).toBe(org.owner.userId);
    expect(change.before).toBeDefined();
    expect(change.after).toEqual([]);
  });
});

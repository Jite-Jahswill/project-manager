/**
 * Phase 5.1: existing organizations converge on the current role template version
 * (docs/architecture/10-organizations.md §10.6). Real PostgreSQL and Redis.
 *
 * Legacy organizations are built for real: created through the API, then their template
 * roles are put back into the exact state an older release created (that version's template
 * permissions, no recorded version), and customized through the API like an administrator
 * would (so the audit log holds genuine edits). The sync runs through the seed, as deployed.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PoolClient } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { ROLE_TEMPLATE_VERSION, templateSnapshot } from '../src/authz/role-template-history';
import { RoleTemplateSyncReport, syncRoleTemplates } from '../src/authz/role-template-sync';
import { seed } from '../prisma/seed';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, roleId, setPlan, signUp, TestOrg, TestUser } from './support/harness';

jest.setTimeout(240_000);

type Member = TestUser & { membershipId: string };

const snap = (version: number, key: string) => [...(templateSnapshot(version)?.templates[key] ?? [])].sort();
const union = (...lists: readonly string[][]) => [...new Set(lists.flat())].sort();
const minus = (a: readonly string[], b: readonly string[]) => a.filter((k) => !b.includes(k)).sort();

describe('Role template sync for existing organizations (phase 5.1)', () => {
  let app: INestApplication;
  let migrator: PrismaClient;
  let L: TestOrg; // legacy v1, customized
  let M: TestOrg; // legacy v2 (phase 4 era), with an explicit removal of a v2 permission
  let S: TestOrg; // legacy v1, organization suspended
  let N: TestOrg; // created at the current version
  let cashier: Member;
  let deniedCashier: Member;
  let suspendedCashier: Member;
  let admin: Member;
  let report: RoleTemplateSyncReport;
  let n = 0;

  const key = (label: string) => `${label}-${Date.now()}-${++n}`;
  const as = (o: TestOrg, u: { token: string }) => ({
    get: (p: string) => http(app).get(`/v1/orgs/${o.id}${p}`).set(bearer(u)),
    post: (p: string, body: object = {}, k?: string) => {
      const r = http(app).post(`/v1/orgs/${o.id}${p}`).set(bearer(u));
      return (k ? r.set('Idempotency-Key', k) : r).send(body);
    },
    patch: (p: string, body: object) => http(app).patch(`/v1/orgs/${o.id}${p}`).set(bearer(u)).send(body),
    delete: (p: string) => http(app).delete(`/v1/orgs/${o.id}${p}`).set(bearer(u)),
  });
  const ctx = (o: TestOrg) => ({ 'app.org_id': o.id, 'app.user_id': o.owner.userId });
  async function sql<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>, commit = false, pool = pools.app()): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(settings)) await c.query('SELECT set_config($1, $2, true)', [k, v]);
      const out = await fn(c);
      if (commit) await c.query('COMMIT');
      return out;
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
      await pool.end();
    }
  }

  /** Puts every template role back into the state release `version` created: its template's permissions, no recorded version. */
  async function makeLegacy(o: TestOrg, version: number) {
    await sql(ctx(o), async (c) => {
      const roles = (await c.query('SELECT id, template_key FROM roles WHERE template_key IS NOT NULL AND NOT is_system')).rows;
      for (const r of roles) {
        const keep = snap(version, r.template_key);
        await c.query('DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_key = ANY($2::text[]))', [r.id, keep]);
        await c.query(
          'INSERT INTO role_permissions (organization_id, role_id, permission_key) SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING',
          [o.id, r.id, keep],
        );
      }
      await c.query('UPDATE roles SET template_version = NULL WHERE template_key IS NOT NULL AND NOT is_system');
    }, true);
  }

  /** Role id -> sorted permissions, plus the role rows, by template key or name. */
  async function rolesOf(o: TestOrg) {
    return sql(ctx(o), async (c) => {
      const roles = (await c.query(
        `SELECT r.id, r.name, r.description, r.is_system, r.template_key, r.template_version, r.created_at, r.updated_at,
           coalesce(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name`)).rows;
      return roles as { id: string; name: string; is_system: boolean; template_key: string | null; template_version: number | null; permissions: string[] }[];
    });
  }
  const permsOf = async (o: TestOrg, templateKey: string) => (await rolesOf(o)).find((r) => r.template_key === templateKey)?.permissions;
  /** Everything an organization's access is made of, besides template roles: custom roles, assignments, overrides. */
  async function accessFingerprint(o: TestOrg) {
    const roles = (await rolesOf(o)).filter((r) => r.template_key === null);
    const rest = await sql(ctx(o), async (c) => ({
      assignments: (await c.query('SELECT id, membership_id, role_id, branch_id, assigned_by_user_id, created_at FROM membership_roles ORDER BY id')).rows,
      overrides: (await c.query('SELECT id, membership_id, permission_key, effect, branch_id, reason, created_by_user_id, created_at, expires_at FROM membership_permission_overrides ORDER BY id')).rows,
      memberships: (await c.query('SELECT id, user_id, status, updated_at FROM organization_memberships ORDER BY id')).rows,
    }));
    return { customRoles: roles, ...rest };
  }
  const upgradeAudits = (o: TestOrg) => sql(ctx(o), async (c) => (await c.query(
    "SELECT resource_id, actor_type, actor_user_id, metadata FROM audit_events WHERE action = 'organization.role.template_upgraded' ORDER BY occurred_at, id")).rows);
  const setRolePerms = async (o: TestOrg, templateKey: string, permissions: string[]) => {
    const id = (await rolesOf(o)).find((r) => r.template_key === templateKey)!.id;
    return as(o, o.owner).patch(`/roles/${id}`, { permissions }).expect(200);
  };

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    migrator = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL as string }) });

    // --- L: an organization from the stage 1 era (template v1), customized by its administrators.
    L = await createOrg(app, await signUp(app, 'tpl-l-owner'), 'tpl-legacy');
    await setPlan(L.id, 'growth');
    await makeLegacy(L, 1);
    cashier = await addMember(app, L, 'tpl-cashier', 'Cashier', L.mainBranchId);
    deniedCashier = await addMember(app, L, 'tpl-cashier-denied', 'Cashier', L.mainBranchId);
    suspendedCashier = await addMember(app, L, 'tpl-cashier-suspended', 'Cashier', L.mainBranchId);
    admin = await addMember(app, L, 'tpl-admin', 'Organization administrator');
    await addMember(app, L, 'tpl-accountant', 'Accountant');
    const owner = as(L, L.owner);
    // Custom roles (one hand-made, one cloned from a template role): must stay exactly as they are.
    await owner.post('/roles', { name: 'Night auditor', description: 'custom', permissions: ['sales.sale.read', 'inventory.stock.read'] }).expect(201);
    await owner.post(`/roles/${await roleId(app, L, 'Cashier')}/clone`, { name: 'Senior cashier' }).expect(201);
    // Customized template roles: a removal of a v1 permission, an addition, a rename, a deletion.
    await setRolePerms(L, 'cashier', minus(snap(1, 'cashier'), ['sales.customer.read']));
    await setRolePerms(L, 'storekeeper', union(snap(1, 'storekeeper'), ['reports.operational.read']));
    await owner.patch(`/roles/${await roleId(app, L, 'Read-only viewer')}`, { name: 'Guest viewer' }).expect(200);
    await owner.delete(`/roles/${await roleId(app, L, 'Logistics officer')}`).expect(204);
    // Overrides: a DENY of a permission the sync will grant (must keep winning), and a GRANT.
    await owner.post(`/members/${deniedCashier.membershipId}/overrides`, { permissionKey: 'sales.session.manage', effect: 'DENY', reason: 'trainee: no drawer' }).expect(201);
    await owner.post(`/members/${cashier.membershipId}/overrides`, { permissionKey: 'organization.branch.read', effect: 'GRANT', reason: 'sees branch list' }).expect(201);
    await owner.patch(`/members/${suspendedCashier.membershipId}`, { status: 'SUSPENDED' }).expect(200);

    // --- M: phase 4 era (template v2, no recorded version); the organization removed a v2 permission.
    M = await createOrg(app, await signUp(app, 'tpl-m-owner'), 'tpl-phase4');
    await makeLegacy(M, 2);
    await setRolePerms(M, 'accountant', minus(snap(2, 'accountant'), ['inventory.cost.read']));
    await sql(ctx(M), async (c) => {
      // A role from a template that no longer exists, and one at a version newer than this code.
      await c.query("INSERT INTO roles (organization_id, name, template_key, updated_at) VALUES ($1, 'Retired template', 'retired_template', now())", [M.id]);
      await c.query("UPDATE roles SET template_version = 99 WHERE template_key = 'viewer'");
    }, true);

    // --- S: legacy v1, organization suspended by the platform.
    S = await createOrg(app, await signUp(app, 'tpl-s-owner'), 'tpl-suspended');
    await makeLegacy(S, 1);
    await sql({ 'app.platform_scope': 'on', 'app.user_id': S.owner.userId }, (c) =>
      c.query("UPDATE organizations SET status = 'SUSPENDED' WHERE id = $1", [S.id]), true);
  });

  afterAll(async () => {
    await migrator?.$disconnect();
    await app?.close();
  });

  describe('before the sync', () => {
    it('a legacy cashier lacks the phase 5 permissions it needs to sell', async () => {
      expect(await permsOf(L, 'cashier')).toEqual(minus(snap(1, 'cashier'), ['sales.customer.read']));
      await as(L, cashier).post(`/branches/${L.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(403);
    });

    it('a dry run reports the plan and changes nothing', async () => {
      const before = await rolesOf(L);
      const dry = await syncRoleTemplates(migrator, { dryRun: true });
      expect(dry.dryRun).toBe(true);
      expect(dry.changes.find((c) => c.organizationId === L.id && c.templateKey === 'cashier')?.added).toEqual(['sales.return.accept', 'sales.session.manage']);
      expect(await rolesOf(L)).toEqual(before);
      expect(await upgradeAudits(L)).toEqual([]);
    });
  });

  describe('the sync (run through the seed)', () => {
    let fingerprintBefore: Awaited<ReturnType<typeof accessFingerprint>>;
    let rolesBefore: Awaited<ReturnType<typeof rolesOf>>;

    beforeAll(async () => {
      fingerprintBefore = await accessFingerprint(L);
      rolesBefore = await rolesOf(L);
      report = await seed(process.env.TEST_MIGRATION_DATABASE_URL as string, { devEmailProvider: 'CAPTURE' });
    });

    it('1. grants each untouched legacy template role exactly what template versions 2 and 3 added', async () => {
      for (const key of ['org_admin', 'branch_manager', 'inventory_manager', 'accountant', 'auditor', 'sales_rep', 'hr_manager', 'payroll_officer']) {
        expect({ key, perms: await permsOf(L, key) }).toEqual({ key, perms: snap(3, key) });
        expect({ key, perms: await permsOf(S, key) }).toEqual({ key, perms: snap(3, key) });
      }
      for (const r of (await rolesOf(L)).filter((x) => x.template_key && !x.is_system)) expect({ role: r.name, v: r.template_version }).toEqual({ role: r.name, v: 3 });
      expect(report.toVersion).toBe(ROLE_TEMPLATE_VERSION);
    });

    it('7. follows the customization policy: removals and additions kept, renamed roles synced, deleted roles not recreated', async () => {
      // The v1 permission the organization removed stays removed; the cashier gets the v3 additions.
      expect(await permsOf(L, 'cashier')).toEqual(union(minus(snap(1, 'cashier'), ['sales.customer.read']), ['sales.return.accept', 'sales.session.manage']));
      // An added permission stays; the v2 additions arrive.
      expect(await permsOf(L, 'storekeeper')).toEqual(union(snap(3, 'storekeeper'), ['reports.operational.read']));
      // Renamed: still the viewer template (identity is the template key), name kept.
      const viewer = (await rolesOf(L)).find((r) => r.template_key === 'viewer')!;
      expect({ name: viewer.name, v: viewer.template_version, perms: viewer.permissions }).toEqual({ name: 'Guest viewer', v: 3, perms: snap(3, 'viewer') });
      // Deleted: not recreated, and reported.
      expect((await rolesOf(L)).some((r) => r.template_key === 'logistics_officer')).toBe(false);
      expect(report.missingRoles).toContainEqual({ organizationId: L.id, templateKeys: ['logistics_officer'] });
      // A v2 permission the organization explicitly removed is withheld (audited), the rest is granted.
      expect(await permsOf(M, 'accountant')).toEqual(union(minus(snap(2, 'accountant'), ['inventory.cost.read']), ['sales.report.read']));
      const change = report.changes.find((c) => c.organizationId === M.id && c.templateKey === 'accountant');
      expect(change).toMatchObject({ fromVersion: 1, added: ['sales.report.read'], withheld: ['inventory.cost.read'] });
    });

    it('5+6. custom roles, assignments, overrides and memberships are unchanged', async () => {
      expect(await accessFingerprint(L)).toEqual(fingerprintBefore);
      const customs = (await rolesOf(L)).filter((r) => !r.template_key);
      expect(customs.map((r) => r.name).sort()).toEqual(['Night auditor', 'Senior cashier']);
      expect(customs.find((r) => r.name === 'Senior cashier')?.permissions).toEqual(snap(1, 'cashier'));
      // Only template roles changed, and the Owner role not at all.
      const owner = (r: { template_key: string | null }) => r.template_key === 'owner';
      expect((await rolesOf(L)).filter(owner)).toEqual(rolesBefore.filter(owner));
    });

    it('2. existing cashiers can run their workflow: open a session, sell, take cash', async () => {
      const owner = as(L, L.owner);
      const p = (await owner.post('/products', { sku: key('SKU'), name: 'Rice', sellingPriceMinor: '500', costPriceMinor: '300' }).expect(201)).body;
      await owner.post(`/branches/${L.mainBranchId}/stock/opening-balances`, { productId: p.id, quantity: '10', reason: 'opening' }).expect(201);
      const c = as(L, cashier);
      await c.post(`/branches/${L.mainBranchId}/cashier-sessions`, { openingFloatMinor: '1000' }).expect(201);
      const sale = (await c.post(`/branches/${L.mainBranchId}/sales`, { lines: [{ productId: p.id, quantity: '2' }] }, key('sale')).expect(201)).body.sale;
      const paid = await c.post(`/sales/${sale.id}/payments`, { method: 'CASH', amountMinor: sale.totalMinor }, key('pay'));
      expect({ status: paid.status, body: paid.status === 201 ? 'ok' : paid.body }).toEqual({ status: 201, body: 'ok' });
      const payment = paid.body.payment;
      expect(payment.status).toBe('CONFIRMED');
      // The returns permission it received works too.
      const line = (await c.get(`/sales/${sale.id}`).expect(200)).body.lines[0];
      await c.post(`/sales/${sale.id}/returns`, { reason: 'wrong size', lines: [{ saleLineId: line.id, quantity: '1', disposition: 'RESALEABLE' }] }, key('ret')).expect(201);

      // 3. ...but nothing elevated: no refund, void, purchase approval, cost prices or reports.
      await c.post(`/payments/${payment.id}/refunds`, { amountMinor: '100', reason: 'goodwill' }, key('ref')).expect(403);
      await c.post(`/sales/${sale.id}/void`, { version: sale.version, reason: 'mistake' }).expect(403);
      await c.post(`/returns/${(await c.get(`/sales/${sale.id}`).expect(200)).body.returns[0].id}/restock`).expect(403);
      await c.get('/sales/report').expect(403);
      expect((await c.get(`/products/${p.id}`).expect(200)).body).not.toHaveProperty('costPriceMinor');
      const supplier = (await owner.post('/suppliers', { code: key('S').slice(0, 20), name: `Supplier ${n}` }).expect(201)).body;
      const po = (await owner.post(`/branches/${L.mainBranchId}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: p.id, quantity: '1', unitCostMinor: '300' }] }).expect(201)).body;
      const submitted = (await owner.post(`/purchase-orders/${po.id}/submit`, { version: po.version }).expect(200)).body;
      expect((await c.get('/purchase-orders').expect(200)).body.items).toEqual([]);
      await c.post(`/purchase-orders/${po.id}/approve`, { version: submitted.version }).expect(404);
      expect(await permsOf(L, 'cashier')).not.toEqual(expect.arrayContaining(['sales.sale.refund']));
      for (const k of ['sales.sale.refund', 'sales.sale.void', 'inventory.cost.read', 'purchasing.order.approve', 'sales.session.supervise', 'sales.return.restock']) {
        expect({ k, held: (await permsOf(L, 'cashier'))!.includes(k) }).toEqual({ k, held: false });
      }
    });

    it('4. organization administrators get the new permissions, but not self-approval', async () => {
      const perms = (await permsOf(L, 'org_admin'))!;
      expect(perms).toEqual(expect.arrayContaining(['purchasing.order.submit', 'purchasing.order.read', 'sales.sale.void', 'sales.report.read', 'inventory.cost.read']));
      expect(perms).not.toContain('purchasing.order.self_approve');
      const a = as(L, admin);
      await a.get('/sales/report').expect(200);
      const p = (await a.post('/products', { sku: key('SKU'), name: 'Beans', sellingPriceMinor: '700' }).expect(201)).body;
      const supplier = (await a.post('/suppliers', { code: key('A').slice(0, 20), name: `Admin supplier ${n}` }).expect(201)).body;
      const po = (await a.post(`/branches/${L.mainBranchId}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: p.id, quantity: '1', unitCostMinor: '100' }] }).expect(201)).body;
      const submitted = (await a.post(`/purchase-orders/${po.id}/submit`, { version: po.version }).expect(200)).body;
      await a.post(`/purchase-orders/${po.id}/approve`, { version: submitted.version }).expect(403);
    });

    it('6+12. overrides keep their precedence; suspended members, branch scope and tenant isolation still hold', async () => {
      // DENY beats the newly granted role permission.
      await as(L, deniedCashier).post(`/branches/${L.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(403);
      // A suspended member gets nothing.
      await as(L, suspendedCashier).post(`/branches/${L.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(403);
      // Branch scope: the cashier is assigned to the main branch only.
      const second = (await as(L, L.owner).post('/branches', { name: 'Second', code: 'SECOND' }).expect(201)).body.id;
      await as(L, cashier).post(`/branches/${second}/cashier-sessions`, { openingFloatMinor: '0' }).expect(403);
      // Tenant isolation: L's cashier sees nothing of M.
      await http(app).get(`/v1/orgs/${M.id}/sales`).set(bearer(cashier)).expect(403);
    });

    it('13. unknown templates, newer versions and suspended organizations are handled observably', async () => {
      const retired = (await rolesOf(M)).find((r) => r.template_key === 'retired_template')!;
      expect({ v: retired.template_version, perms: retired.permissions }).toEqual({ v: null, perms: [] });
      expect(report.unknownTemplates).toContainEqual({ organizationId: M.id, roleId: retired.id, templateKey: 'retired_template' });
      const viewer = (await rolesOf(M)).find((r) => r.template_key === 'viewer')!;
      expect({ v: viewer.template_version, perms: viewer.permissions }).toEqual({ v: 99, perms: snap(2, 'viewer') });
      expect(report.ahead).toContainEqual({ organizationId: M.id, roleId: viewer.id, templateVersion: 99 });
      // A suspended organization converges too (suspension is enforced at access time, not by stale roles).
      expect(await permsOf(S, 'cashier')).toEqual(snap(3, 'cashier'));
    });

    it('every grant is audited as a SYSTEM change with before, after and what was withheld', async () => {
      const audits = await upgradeAudits(L);
      const cashierRole = (await rolesOf(L)).find((r) => r.template_key === 'cashier')!;
      const entry = audits.find((a) => a.resource_id === cashierRole.id);
      expect(entry).toMatchObject({
        actor_type: 'SYSTEM', actor_user_id: null,
        metadata: { templateKey: 'cashier', fromVersion: 1, toVersion: 3, added: ['sales.return.accept', 'sales.session.manage'], withheld: [] },
      });
      expect(audits.length).toBe(report.changes.filter((c) => c.organizationId === L.id).length);
      const state = await migrator.roleTemplateState.findUnique({ where: { id: 1 } });
      expect(state?.version).toBe(ROLE_TEMPLATE_VERSION);
    });

    it('8. running it again changes nothing', async () => {
      const before = await Promise.all([L, M, S].map(rolesOf));
      const audits = await Promise.all([L, M, S].map(upgradeAudits));
      const again = await syncRoleTemplates(migrator);
      expect({ upgraded: again.rolesUpgraded, granted: again.permissionsGranted, changes: again.changes }).toEqual({ upgraded: 0, granted: 0, changes: [] });
      expect(await Promise.all([L, M, S].map(rolesOf))).toEqual(before);
      expect(await Promise.all([L, M, S].map(upgradeAudits))).toEqual(audits);
    });
  });

  describe('concurrency, new organizations and boundaries', () => {
    it('9. concurrent syncs grant once: no duplicates, one audit event per role', async () => {
      const C = await createOrg(app, await signUp(app, 'tpl-c-owner'), 'tpl-concurrent');
      await makeLegacy(C, 1);
      const clients = [0, 1, 2].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL as string }) }));
      try {
        const reports = await Promise.all(clients.map((c) => syncRoleTemplates(c)));
        const forC = reports.flatMap((r) => r.changes.filter((c) => c.organizationId === C.id));
        const audits = await upgradeAudits(C);
        expect(audits.length).toBe(forC.length);
        expect(new Set(audits.map((a) => a.resource_id)).size).toBe(audits.length);
      } finally {
        await Promise.all(clients.map((c) => c.$disconnect()));
      }
      for (const key of ['org_admin', 'cashier', 'accountant', 'storekeeper']) expect({ key, perms: await permsOf(C, key) }).toEqual({ key, perms: snap(3, key) });
      const dupes = await sql(ctx(C), async (c) => (await c.query('SELECT role_id, permission_key, count(*)::int AS n FROM role_permissions GROUP BY 1, 2 HAVING count(*) > 1')).rows);
      expect(dupes).toEqual([]);
    });

    it('9. a sync racing an administrator editing the same role serializes; either order ends consistent and audited', async () => {
      const D = await createOrg(app, await signUp(app, 'tpl-d-owner'), 'tpl-race');
      await makeLegacy(D, 1);
      const id = (await rolesOf(D)).find((r) => r.template_key === 'cashier')!.id;
      // The administrator submits a full permission set computed from what they saw before the sync.
      const submitted = minus(snap(1, 'cashier'), ['sales.customer.read']);
      await Promise.all([syncRoleTemplates(migrator), as(D, D.owner).patch(`/roles/${id}`, { permissions: submitted }).expect(200)]);
      const audits = await sql(ctx(D), async (c) => (await c.query(
        "SELECT action, metadata FROM audit_events WHERE resource_id = $1 AND action IN ('organization.role.updated', 'organization.role.template_upgraded')",
        [id])).rows);
      expect(audits.map((e) => e.action).sort()).toEqual(['organization.role.template_upgraded', 'organization.role.updated']);
      const edit = audits.find((e) => e.action === 'organization.role.updated')!;
      const added = ['sales.return.accept', 'sales.session.manage'];
      // Both lock the role row, so they serialized; the final state says which committed first
      // (occurred_at is each transaction's start time, not its commit order).
      if ((await permsOf(D, 'cashier'))!.includes('sales.session.manage')) {
        // Edit first: the sync waited for it, then granted the additions on top of it.
        expect(edit.metadata.removed).toEqual(['sales.customer.read']);
        expect(await permsOf(D, 'cashier')).toEqual(union(submitted, added));
      } else {
        // Sync first: the edit replaced the whole set (PATCH semantics), removing the fresh grants, and its
        // audit records that removal. A later sync does not re-grant them: the role is already at the
        // current version (and, were it not, the recorded removal would withhold them).
        expect([...edit.metadata.removed].sort()).toEqual(['sales.customer.read', ...added].sort());
        expect(await permsOf(D, 'cashier')).toEqual(submitted);
        const later = await syncRoleTemplates(migrator);
        expect(later.changes.filter((c) => c.organizationId === D.id)).toEqual([]);
        expect(await permsOf(D, 'cashier')).toEqual(submitted);
      }
    });

    it('a stale full-set edit after a sync removes the fresh grants on record, and they stay removed', async () => {
      const E = await createOrg(app, await signUp(app, 'tpl-e-owner'), 'tpl-stale');
      await makeLegacy(E, 1);
      const id = (await rolesOf(E)).find((r) => r.template_key === 'cashier')!.id;
      const stale = snap(1, 'cashier'); // what the administrator's screen showed before the sync
      await syncRoleTemplates(migrator);
      expect(await permsOf(E, 'cashier')).toEqual(snap(3, 'cashier'));
      await as(E, E.owner).patch(`/roles/${id}`, { permissions: stale }).expect(200);
      const edit = (await sql(ctx(E), (c) => c.query("SELECT metadata FROM audit_events WHERE resource_id = $1 AND action = 'organization.role.updated'", [id]))).rows[0];
      expect([...edit.metadata.removed].sort()).toEqual(['sales.return.accept', 'sales.session.manage']);
      await syncRoleTemplates(migrator);
      expect(await permsOf(E, 'cashier')).toEqual(stale);
    });

    it('10. a newly created organization starts at the same baseline and needs no sync', async () => {
      N = await createOrg(app, await signUp(app, 'tpl-n-owner'), 'tpl-new');
      const roles = await rolesOf(N);
      for (const r of roles.filter((x) => x.template_key && !x.is_system)) {
        expect({ key: r.template_key, v: r.template_version, perms: r.permissions }).toEqual({ key: r.template_key, v: 3, perms: snap(3, r.template_key!) });
      }
      // Same baseline as an upgraded, untouched legacy role.
      expect(await permsOf(N, 'auditor')).toEqual(await permsOf(L, 'auditor'));
      const again = await syncRoleTemplates(migrator);
      expect(again.changes.filter((c) => c.organizationId === N.id)).toEqual([]);
      expect(await rolesOf(N)).toEqual(roles);
    });

    it('11. platform permissions cannot enter organization roles; the sync scope cannot delete or touch custom roles', async () => {
      const custom = (await rolesOf(L)).find((r) => r.name === 'Night auditor')!;
      const cashierRole = (await rolesOf(L)).find((r) => r.template_key === 'cashier')!;
      const asSync = <T>(fn: (c: PoolClient) => Promise<T>) => sql({ 'app.template_sync': 'on' }, fn, false, pools.migrator());
      // A platform permission is not in the organization catalog (foreign key).
      await expect(asSync((c) => c.query('INSERT INTO role_permissions (organization_id, role_id, permission_key) VALUES ($1, $2, $3)',
        [L.id, cashierRole.id, 'platform.admin.manage']))).rejects.toMatchObject({ code: '23503' });
      // Custom roles are outside the sync's insert policy.
      await expect(asSync((c) => c.query('INSERT INTO role_permissions (organization_id, role_id, permission_key) VALUES ($1, $2, $3)',
        [L.id, custom.id, 'sales.sale.refund']))).rejects.toMatchObject({ code: '42501' });
      // No delete or update policy: nothing can be removed.
      expect(await asSync(async (c) => (await c.query('DELETE FROM role_permissions WHERE role_id = $1', [cashierRole.id])).rowCount)).toBe(0);
      expect(await asSync(async (c) => (await c.query("UPDATE roles SET name = 'x' WHERE id = $1", [custom.id])).rowCount)).toBe(0);
      // Without the scope the schema owner sees no tenant rows; the runtime role gains nothing from it.
      expect((await sql({}, async (c) => (await c.query('SELECT count(*)::int AS n FROM roles')).rows[0].n, false, pools.migrator()))).toBe(0);
      expect((await sql({ 'app.template_sync': 'on' }, async (c) => (await c.query('SELECT count(*)::int AS n FROM roles')).rows[0].n))).toBe(0);
    });

    it('the API refuses to start while existing organizations are behind the role templates', async () => {
      await migrator.roleTemplateState.update({ where: { id: 1 }, data: { version: ROLE_TEMPLATE_VERSION - 1 } });
      try {
        await expect(createTestApp()).rejects.toThrow(/role templates not synced .*Run: pnpm api db:seed/);
      } finally {
        await migrator.roleTemplateState.update({ where: { id: 1 }, data: { version: ROLE_TEMPLATE_VERSION } });
      }
    });
  });
});

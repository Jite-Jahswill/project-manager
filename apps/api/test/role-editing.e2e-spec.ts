/**
 * Phase 5.2: role edits use optimistic concurrency, and deliberate removals from template roles
 * are recorded as exclusions (docs/architecture/10-organizations.md §10.6). Real PostgreSQL and
 * Redis. Races are deterministic: concurrent requests are issued together with Promise.all and
 * the outcome is asserted exactly (the role row lock decides the winner).
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, signUp, TestOrg, TestUser } from './support/harness';

jest.setTimeout(180_000);

interface RoleView { id: string; name: string; templateKey: string | null; version: number; permissions: string[] }

describe('Role editing: versions and exclusions (phase 5.2)', () => {
  let app: INestApplication;
  let org: TestOrg;
  let other: TestOrg;
  let admin: TestUser & { membershipId: string };

  const roles = async (o: TestOrg = org): Promise<RoleView[]> => (await http(app).get(`/v1/orgs/${o.id}/roles`).set(bearer(o.owner)).expect(200)).body;
  const role = async (id: string, o: TestOrg = org) => (await roles(o)).find((r) => r.id === id)!;
  const byTemplate = async (key: string, o: TestOrg = org) => (await roles(o)).find((r) => r.templateKey === key)!;
  const patch = (id: string, body: object, u: { token: string } = org.owner, o: TestOrg = org) =>
    http(app).patch(`/v1/orgs/${o.id}/roles/${id}`).set(bearer(u)).send(body);
  async function sql<T>(fn: (c: PoolClient) => Promise<T>, o: TestOrg = org): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [o.id, o.owner.userId]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
      await pool.end();
    }
  }
  const exclusionsOf = (roleId: string) => sql(async (c) =>
    (await c.query('SELECT permission_key, excluded_by_user_id FROM role_permission_exclusions WHERE role_id = $1 ORDER BY permission_key', [roleId])).rows);
  const editAudits = (roleId: string) => sql(async (c) =>
    (await c.query("SELECT before, after, metadata FROM audit_events WHERE action = 'organization.role.updated' AND resource_id = $1 ORDER BY occurred_at, id", [roleId])).rows);
  const custom = async (name: string, permissions: string[]) =>
    (await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(org.owner)).send({ name, permissions }).expect(201)).body as RoleView;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'edit-owner'), 'role-edit');
    other = await createOrg(app, await signUp(app, 'edit-other'), 'role-edit-other');
    admin = await addMember(app, org, 'edit-admin', 'Organization administrator');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('roles carry a version; new and cloned roles start at 1', async () => {
    for (const r of await roles()) expect({ name: r.name, version: r.version }).toEqual({ name: r.name, version: 1 });
    const c = await custom('Shelf staff', ['inventory.product.read']);
    expect(c.version).toBe(1);
    const clone = (await http(app).post(`/v1/orgs/${org.id}/roles/${c.id}/clone`).set(bearer(org.owner)).send({ name: 'Shelf staff 2' }).expect(201)).body;
    expect(clone.version).toBe(1);
  });

  it('1. an edit with the current version succeeds and increments it', async () => {
    const c = await custom('Night shift', ['inventory.stock.read']);
    const res = await patch(c.id, { version: 1, name: 'Night crew', permissions: ['inventory.stock.read', 'inventory.product.read'] }).expect(200);
    expect(res.body).toMatchObject({ id: c.id, name: 'Night crew', version: 2, permissions: ['inventory.product.read', 'inventory.stock.read'] });
    expect(await role(c.id)).toMatchObject({ name: 'Night crew', version: 2 });
    const [audit] = await editAudits(c.id);
    expect({ before: audit.before.version, after: audit.after.version }).toEqual({ before: 1, after: 2 });
  });

  it('2. a stale edit gets 409 with the current version and changes nothing', async () => {
    const c = await custom('Weekend shift', ['inventory.stock.read']);
    await patch(c.id, { version: 1, permissions: ['inventory.stock.read', 'sales.sale.read'] }).expect(200);
    const before = await role(c.id);
    const stale = await patch(c.id, { version: 1, name: 'Overwritten', permissions: [] });
    expect({ status: stale.status, code: stale.body.code, message: stale.body.message })
      .toEqual({ status: 409, code: 'version_conflict', message: 'The role changed (current version 2); reload and retry' });
    expect(await role(c.id)).toEqual(before);
    expect((await editAudits(c.id)).length).toBe(1);
    // A newer-than-current version is just as wrong.
    expect((await patch(c.id, { version: 99, name: 'Future' })).body.code).toBe('version_conflict');
  });

  it('3. concurrent edits from the same version: exactly one wins, the rest get 409', async () => {
    const c = await custom('Race role', ['inventory.stock.read']);
    const sets = [['inventory.product.read'], ['sales.sale.read'], ['inventory.stock.read', 'sales.customer.read'], [], ['reports.operational.read']];
    const results = await Promise.all(sets.map((permissions, i) => patch(c.id, { version: 1, name: `Race ${i}`, permissions })));
    const winners = results.filter((r) => r.status === 200);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe('version_conflict');
    // The stored role is exactly the winner's edit, at version 2, with one audited change.
    const after = await role(c.id);
    expect({ name: after.name, permissions: after.permissions, version: after.version })
      .toEqual({ name: winners[0].body.name, permissions: winners[0].body.permissions, version: 2 });
    expect((await editAudits(c.id)).length).toBe(1);
  });

  it('validates the version strictly, and refuses unknown and platform permission keys', async () => {
    const c = await custom('Strict role', ['inventory.stock.read']);
    for (const body of [{ name: 'No version' }, { version: '1', name: 'String' }, { version: 0, name: 'Zero' }, { version: 1.5, name: 'Fraction' }, { version: null }]) {
      const res = await patch(c.id, body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    expect((await patch(c.id, { version: 1, permissions: ['inventory.stock.read', 'no.such.permission'] })).body.code).toBe('unknown_permission');
    expect((await patch(c.id, { version: 1, permissions: ['platform.admin.manage'] })).body.code).toBe('unknown_permission');
    expect((await http(app).post(`/v1/orgs/${org.id}/roles`).set(bearer(org.owner)).send({ name: 'Platform role', permissions: ['platform.admin.manage'] })).body.code)
      .toBe('unknown_permission');
    expect(await role(c.id)).toMatchObject({ version: 1, permissions: ['inventory.stock.read'] });
  });

  it('a refused edit rolls back completely (name, permissions, version, exclusions)', async () => {
    // The administrator may not delegate payroll export; the whole edit is refused, including the rename.
    const cashier = await byTemplate('cashier');
    const res = await patch(cashier.id, {
      version: cashier.version, name: 'Renamed cashier', permissions: [...cashier.permissions.filter((k) => k !== 'sales.customer.read'), 'hr.payroll.export'],
    }, admin);
    expect(res.status).toBe(403);
    expect(await byTemplate('cashier')).toEqual(cashier);
    expect(await exclusionsOf(cashier.id)).toEqual([]);
  });

  it("does not leak another organization's roles: 404 under the wrong URL, 403 for non-members", async () => {
    const theirs = await byTemplate('cashier', other);
    const res = await patch(theirs.id, { version: 99, name: 'Hijack' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/version \d|Cashier|sales\./);
    await patch(theirs.id, { version: theirs.version, name: 'Hijack' }, org.owner, other).expect(403);
    await http(app).delete(`/v1/orgs/${org.id}/roles/${theirs.id}?version=${theirs.version}`).set(bearer(org.owner)).expect(404);
    expect(await byTemplate('cashier', other)).toEqual(theirs);
  });

  it('records deliberate removals from template roles as exclusions and withdraws them when re-added', async () => {
    const viewer = await byTemplate('viewer');
    const removed = await patch(viewer.id, { version: viewer.version, permissions: viewer.permissions.filter((k) => k !== 'reports.operational.read') }).expect(200);
    expect(await exclusionsOf(viewer.id)).toEqual([{ permission_key: 'reports.operational.read', excluded_by_user_id: org.owner.userId }]);
    // Renaming does not touch exclusions.
    const renamed = await patch(viewer.id, { version: removed.body.version, name: 'Guest' }).expect(200);
    expect((await exclusionsOf(viewer.id)).length).toBe(1);
    await patch(viewer.id, { version: renamed.body.version, permissions: viewer.permissions }).expect(200);
    expect(await exclusionsOf(viewer.id)).toEqual([]);
  });

  it('custom roles never get exclusions (the template sync does not touch them)', async () => {
    const c = await custom('Custom with removal', ['inventory.stock.read', 'sales.sale.read']);
    await patch(c.id, { version: 1, permissions: ['inventory.stock.read'] }).expect(200);
    expect(await exclusionsOf(c.id)).toEqual([]);
  });

  it('deleting needs the current version; protections for roles in use and the Owner role still apply', async () => {
    const c = await custom('Delete me', ['inventory.stock.read']);
    const del = (id: string, v: unknown) => http(app).delete(`/v1/orgs/${org.id}/roles/${id}${v === undefined ? '' : `?version=${v}`}`).set(bearer(org.owner));
    await del(c.id, undefined).expect(400);
    await del(c.id, 'abc').expect(400);
    await del(c.id, 0).expect(400);
    await patch(c.id, { version: 1, name: 'Delete me later' }).expect(200);
    expect((await del(c.id, 1)).body.code).toBe('version_conflict');
    expect(await role(c.id)).toBeDefined();
    await del(c.id, 2).expect(204);
    expect(await role(c.id)).toBeUndefined();
    // In use (the administrator holds it): refused even with the current version.
    const adminRole = await byTemplate('org_admin');
    expect((await del(adminRole.id, adminRole.version)).body.code).toBe('role_in_use');
    // The Owner role cannot be deleted or edited at all.
    const owner = (await roles()).find((r) => r.templateKey === 'owner')!;
    await del(owner.id, owner.version).expect(403);
    await patch(owner.id, { version: owner.version, name: 'Boss' }).expect(403);
  });

  it('a concurrent edit and delete from the same version: exactly one succeeds', async () => {
    const c = await custom('Edit or delete', ['inventory.stock.read']);
    const [edit, del] = await Promise.all([
      patch(c.id, { version: 1, name: 'Edited' }),
      http(app).delete(`/v1/orgs/${org.id}/roles/${c.id}?version=1`).set(bearer(org.owner)),
    ]);
    const outcome = [edit.status, del.status].sort();
    // Either the edit won (the delete is stale: 409) or the delete won (the edit finds no role: 404).
    expect([[200, 409], [204, 404]]).toContainEqual(outcome);
    if (edit.status === 200) expect(await role(c.id)).toMatchObject({ name: 'Edited', version: 2 });
    else expect(await role(c.id)).toBeUndefined();
  });
});

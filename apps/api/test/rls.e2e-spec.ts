/**
 * Database-level tenant isolation, tested directly against PostgreSQL as the
 * runtime role. These hold even if application code forgets a WHERE clause.
 */
import { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { createOrg, createTestApp, http, bearer, pools, resetDatabase, signUp, TestOrg } from './support/harness';

describe('PostgreSQL row-level security (runtime role)', () => {
  let app: INestApplication;
  let pool: Pool;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let productB: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    pool = pools.app();
    orgA = await createOrg(app, await signUp(app, 'rls-owner-a'), 'rls-a');
    orgB = await createOrg(app, await signUp(app, 'rls-owner-b'), 'rls-b');
    const res = await http(app).post(`/v1/orgs/${orgB.id}/products`).set(bearer(orgB.owner)).send({ sku: 'B-1', name: 'B product' }).expect(201);
    productB = res.body.id;
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  /** Runs fn in a transaction with the given tenant settings, then rolls back. */
  async function inTx<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [k, v] of Object.entries(settings)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('runtime role cannot bypass RLS and owns no tables', async () => {
    const role = await pool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");
    expect(owned.rows[0].n).toBe(0);
  });

  it('every table with an organization_id column has RLS enabled and forced', async () => {
    const res = await pool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'organization_id')`);
    expect(res.rows.length).toBeGreaterThanOrEqual(12);
    for (const row of res.rows) expect({ table: row.relname, rls: row.relrowsecurity, forced: row.relforcerowsecurity }).toEqual({ table: row.relname, rls: true, forced: true });
    const orgs = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'organizations'");
    expect(orgs.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  async function tenantTables(): Promise<string[]> {
    const res = await pool.query(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name`);
    return res.rows.map((r) => r.table_name);
  }

  it("in A's context, no tenant table exposes a single row belonging to B (generated over all tables)", async () => {
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThanOrEqual(12);
    await inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, async (c) => {
      for (const t of tables) {
        const res = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgB.id]);
        expect({ table: t, rowsOfB: res.rows[0].n }).toEqual({ table: t, rowsOfB: 0 });
      }
      const orgs = await c.query('SELECT id FROM organizations');
      expect(orgs.rows).toEqual([{ id: orgA.id }]);
    });
  });

  it('policy lint: every policy on a tenant table is bound to the app role and keyed on the tenant context', async () => {
    const res = await pool.query(`
      SELECT tablename, policyname, cmd, roles::text[] AS roles, coalesce(qual, '') AS qual, coalesce(with_check, '') AS with_check
      FROM pg_policies WHERE schemaname = 'public'`);
    // The role template sync (schema owner, docs/architecture/10-organizations.md §10.6) has
    // exactly these policies, all keyed on its scope. None deletes; none covers other tables.
    const syncPolicies = res.rows.filter((p) => p.roles.includes('ventidoc_migrator'));
    expect(syncPolicies.map((p) => `${p.tablename}.${p.policyname}:${p.cmd}`).sort()).toEqual([
      'audit_events.template_sync_insert:INSERT',
      'organizations.template_sync_select:SELECT',
      'role_permission_exclusions.template_sync_select:SELECT',
      'role_permissions.template_sync_insert:INSERT', 'role_permissions.template_sync_select:SELECT',
      'roles.template_sync_select:SELECT', 'roles.template_sync_update:UPDATE',
    ]);
    for (const p of syncPolicies) {
      expect({ policy: `${p.tablename}.${p.policyname}`, roles: p.roles, keyed: /app_template_sync_scope\(\)/.test(`${p.qual} ${p.with_check}`) })
        .toEqual({ policy: `${p.tablename}.${p.policyname}`, roles: ['ventidoc_migrator'], keyed: true });
    }
    res.rows = res.rows.filter((p) => !p.roles.includes('ventidoc_migrator'));
    // User-owned tables that carry organization_id only as context (support conversations):
    // the organization's tenant context must grant nothing, so they have their own, stricter rule below.
    const USER_OWNED = new Set(['support_conversations']);
    const tables = new Set([...(await tenantTables()), 'organizations'].filter((t) => !USER_OWNED.has(t)));
    for (const p of res.rows.filter((r) => USER_OWNED.has(r.tablename))) {
      const text = `${p.qual} ${p.with_check}`;
      expect({ policy: `${p.tablename}.${p.policyname}`, roles: p.roles, user: /app_current_user_id\(\)/.test(text), tenantOrPlatform: /app_current_org_id\(\)|app_platform_scope\(\)|app_tenant_ok|app_is_active_member\(\)/.test(text) })
        .toEqual({ policy: `${p.tablename}.${p.policyname}`, roles: ['ventidoc_app'], user: true, tenantOrPlatform: false });
    }
    expect(res.rows.filter((r) => USER_OWNED.has(r.tablename)).length).toBeGreaterThanOrEqual(3);
    const tenantPolicies = res.rows.filter((p) => tables.has(p.tablename));
    expect(tenantPolicies.length).toBeGreaterThan(0);
    for (const p of tenantPolicies) {
      expect({ policy: `${p.tablename}.${p.policyname}`, roles: p.roles }).toEqual({ policy: `${p.tablename}.${p.policyname}`, roles: ['ventidoc_app'] });
      const text = `${p.qual} ${p.with_check}`;
      // Every clause must depend on the tenant context; a bare "true" would disable isolation.
      expect({ policy: `${p.tablename}.${p.policyname}`, keyed: /app_current_org_id\(\)|app_platform_scope\(\)|app_email_worker_scope\(\)/.test(text) })
        .toEqual({ policy: `${p.tablename}.${p.policyname}`, keyed: true });
      expect(p.qual.trim()).not.toBe('true');
      expect(p.with_check.trim()).not.toBe('true');
    }
    // Business tables must never be readable in platform scope.
    for (const p of res.rows.filter((r) => ['products', 'stock_balances', 'stock_movements', 'branches', 'roles', 'role_permissions',
      'membership_roles', 'membership_permission_overrides', 'organization_invitations', 'organization_memberships'].includes(r.tablename))) {
      expect({ policy: `${p.tablename}.${p.policyname}`, platform: /app_platform_scope/.test(`${p.qual} ${p.with_check}`) })
        .toEqual({ policy: `${p.tablename}.${p.policyname}`, platform: false });
    }
  });

  it('without tenant context, tenant tables return no rows (fail closed)', async () => {
    for (const table of ['organizations', 'branches', 'roles', 'products', 'organization_memberships', 'audit_events', 'organization_subscriptions']) {
      const res = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect({ table, n: res.rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it("organization A's context sees only A's rows", async () => {
    await inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, async (c) => {
      const products = await c.query('SELECT organization_id FROM products');
      expect(products.rows.every((r) => r.organization_id === orgA.id)).toBe(true);
      const direct = await c.query('SELECT id FROM products WHERE id = $1', [productB]);
      expect(direct.rowCount).toBe(0);
      const branches = await c.query('SELECT DISTINCT organization_id FROM branches');
      expect(branches.rows).toEqual([{ organization_id: orgA.id }]);
    });
  });

  it("cannot insert a row tagged with another organization's ID", async () => {
    await expect(
      inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, (c) =>
        c.query("INSERT INTO products (organization_id, sku, name, updated_at) VALUES ($1, 'X', 'smuggled', now())", [orgB.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another organization's rows (they are invisible)", async () => {
    await inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, async (c) => {
      const upd = await c.query("UPDATE products SET name = 'pwned' WHERE id = $1", [productB]);
      expect(upd.rowCount).toBe(0);
      const del = await c.query('DELETE FROM membership_roles WHERE organization_id = $1', [orgB.id]);
      expect(del.rowCount).toBe(0);
    });
    // Organizations and branches cannot be deleted at all by the runtime role (history protection, phase 3).
    for (const sql of ['DELETE FROM branches WHERE organization_id = $1', 'DELETE FROM organizations WHERE id = $1']) {
      await expect(inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, (c) => c.query(sql, [orgA.id]))).rejects.toThrow(/permission denied/);
    }
  });

  it("composite foreign keys reject linking A's records to B's", async () => {
    await expect(
      inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, async (c) => {
        // A role ID from org B, written with org A's organization_id.
        const foreignRole = await foreignRoleId();
        const membership = await c.query('SELECT id FROM organization_memberships LIMIT 1');
        return c.query(
          'INSERT INTO membership_roles (id, organization_id, membership_id, role_id) VALUES (gen_random_uuid(), $1, $2, $3)',
          [orgA.id, membership.rows[0].id, foreignRole],
        );
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it('platform scope exposes organization metadata but no business data', async () => {
    await inTx({ 'app.platform_scope': 'on' }, async (c) => {
      const orgs = await c.query('SELECT id FROM organizations');
      expect(orgs.rowCount).toBeGreaterThanOrEqual(2);
      for (const table of ['products', 'branches', 'roles', 'stock_balances', 'stock_movements', 'organization_memberships']) {
        const res = await c.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect({ table, n: res.rows[0].n }).toEqual({ table, n: 0 });
      }
    });
  });

  it('audit events are append-only for the runtime role and the schema owner', async () => {
    await expect(inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, (c) => c.query("UPDATE audit_events SET action = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(inTx({ 'app.org_id': orgA.id, 'app.user_id': orgA.owner.userId }, (c) => c.query('DELETE FROM audit_events'))).rejects.toThrow(/permission denied/);
    const owner = pools.migrator();
    try {
      const client = await owner.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.org_id', $1, true)", [orgA.id]);
        // Forced RLS with no policy for the owner: default deny, nothing is visible to change.
        const upd = await client.query("UPDATE audit_events SET action = 'tampered'");
        expect(upd.rowCount).toBe(0);
        // Backstop for roles that bypass RLS (superusers): a BEFORE UPDATE/DELETE trigger that always raises.
        const trg = await client.query(
          "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal AND tgenabled = 'O'",
        );
        expect(trg.rows.map((r) => r.tgname)).toContain('audit_events_append_only');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    } finally {
      await owner.end();
    }
  });

  it('stock balances change only through the ledger and cannot go negative', async () => {
    const ctx = { 'app.org_id': orgB.id, 'app.user_id': orgB.owner.userId };
    // No direct write of any kind: the runtime role holds SELECT only.
    await expect(inTx(ctx, (c) =>
      c.query('INSERT INTO stock_balances (organization_id, branch_id, product_id, quantity, updated_at) VALUES ($1, $2, $3, 5, now())', [orgB.id, orgB.mainBranchId, productB]),
    )).rejects.toThrow(/permission denied/);
    await expect(inTx(ctx, (c) => c.query('UPDATE stock_balances SET quantity = 1000'))).rejects.toThrow(/permission denied/);
    await expect(inTx(ctx, (c) => c.query('DELETE FROM stock_balances'))).rejects.toThrow(/permission denied/);
    // A ledger row that would make the balance negative is refused by the posting trigger.
    await expect(inTx(ctx, (c) => c.query(
      `INSERT INTO stock_movements (organization_id, branch_id, product_id, type, quantity_delta, balance_after, reason, actor_user_id, idempotency_key)
       VALUES ($1, $2, $3, 'ADJUSTMENT', -1, 0, 'negative attempt', $4, 'rls-negative-1')`, [orgB.id, orgB.mainBranchId, productB, orgB.owner.userId]),
    )).rejects.toThrow(/insufficient_stock/);
    // The database (not the client) computes balance_after.
    const posted = await inTx(ctx, async (c) => (await c.query(
      `INSERT INTO stock_movements (organization_id, branch_id, product_id, type, quantity_delta, balance_after, reason, actor_user_id, idempotency_key)
       VALUES ($1, $2, $3, 'ADJUSTMENT', 2, 999999, 'forged balance_after', $4, 'rls-forge-1') RETURNING balance_after::text`, [orgB.id, orgB.mainBranchId, productB, orgB.owner.userId])).rows[0]);
    expect(posted.balance_after).toBe('2.000');
  });

  async function foreignRoleId(): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgB.id]);
      await client.query("SELECT set_config('app.user_id', $1, true)", [orgB.owner.userId]);
      const res = await client.query('SELECT id FROM roles LIMIT 1');
      return res.rows[0].id;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
});

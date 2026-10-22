/**
 * Security gate 2026-10-22 (docs/security/2026-10-22-security-gate.md).
 *
 *  A. Password hashes are readable only by the credential-store role.
 *  B. A wrong-tenant context opened by an application bug cannot read or change
 *     another organization's data, because RLS verifies membership itself;
 *     tenant context never leaks across pooled connections.
 */
import { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PrismaService } from '../src/database/prisma.service';
import { TenantDb } from '../src/database/tenant-db.service';
import {
  addMember, bearer, createOrg, createTestApp, http, login, PASSWORD, pools, resetDatabase, signUp, TestOrg, tokenFromMail,
} from './support/harness';

describe('Security gate', () => {
  let app: INestApplication;
  let a: TestOrg;
  let b: TestOrg;
  let productB: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    a = await createOrg(app, await signUp(app, 'gate-owner-a'), 'gate-a');
    b = await createOrg(app, await signUp(app, 'gate-owner-b'), 'gate-b');
    productB = (await http(app).post(`/v1/orgs/${b.id}/products`).set(bearer(b.owner)).send({ sku: 'GATE-B', name: 'B only' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  async function tx<T>(pool: Pool, settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
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

  describe('A. credential isolation', () => {
    it('the application role cannot read, write or even see password hashes', async () => {
      const pool = pools.app();
      try {
        await expect(pool.query('SELECT password_hash FROM user_credentials')).rejects.toThrow(/permission denied/);
        await expect(pool.query("UPDATE user_credentials SET password_hash = 'x'")).rejects.toThrow(/permission denied/);
        const col = await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE column_name = 'password_hash' AND table_name = 'users'");
        expect(col.rows[0].n).toBe(0);
        // Even the platform scope does not help.
        await expect(tx(pool, { 'app.platform_scope': 'on' }, (c) => c.query('SELECT * FROM user_credentials'))).rejects.toThrow(/permission denied/);
      } finally {
        await pool.end();
      }
    });

    it('the credential role can read hashes and nothing else', async () => {
      const pool = pools.auth();
      try {
        const res = await pool.query('SELECT count(*)::int AS n FROM user_credentials');
        expect(res.rows[0].n).toBeGreaterThan(0);
        for (const t of ['users', 'sessions', 'refresh_tokens', 'organizations', 'products', 'audit_events', 'platform_admins']) {
          await expect(pool.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
        }
        await expect(pool.query('DELETE FROM user_credentials')).rejects.toThrow(/permission denied/);
        const role = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
        expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      } finally {
        await pool.end();
      }
    });

    it('hashes are argon2id and login, re-authentication and reset still work end to end', async () => {
      const user = await signUp(app, 'gate-cred');
      const pool = pools.auth();
      try {
        const res = await pool.query('SELECT password_hash FROM user_credentials WHERE user_id = $1', [user.userId]);
        expect(res.rows[0].password_hash).toMatch(/^\$argon2id\$/);
      } finally {
        await pool.end();
      }
      await http(app).post('/v1/auth/reauthenticate').set(bearer(user)).send({ password: PASSWORD }).expect(204);
      await http(app).post('/v1/auth/reauthenticate').set(bearer(user)).send({ password: 'wrong-password-here' }).expect(401);
      await http(app).post('/v1/auth/password/forgot').send({ email: user.email }).expect(202);
      await http(app).post('/v1/auth/password/reset')
        .send({ token: tokenFromMail(app, user.email, '/reset-password'), newPassword: 'gate-new-password-1' }).expect(204);
      await http(app).get('/v1/auth/me').set(bearer(user)).expect(401);
      await http(app).post('/v1/auth/login').send({ email: user.email, password: PASSWORD, clientType: 'MOBILE' }).expect(401);
      await http(app).post('/v1/auth/login').send({ email: user.email, password: 'gate-new-password-1', clientType: 'MOBILE' }).expect(200);
    });

    it('sessions older than the last password change are rejected even if not revoked', async () => {
      const user = await signUp(app, 'gate-stamp');
      // Simulate a revocation that did not happen (e.g. a crash between the two connections).
      await app.get(PrismaService).user.update({ where: { id: user.userId }, data: { passwordChangedAt: new Date(Date.now() + 1000) } });
      await http(app).get('/v1/auth/me').set(bearer(user)).expect(401);
    });
  });

  describe('B. wrong-tenant context (the broken-guard scenario, reproduced at the database)', () => {
    // Exactly what the planted bug produced: organization B's context with A's owner as user.
    const wrongCtx = () => ({ 'app.org_id': b.id, 'app.user_id': a.owner.userId });

    it("cannot read any of B's rows", async () => {
      const pool = pools.app();
      try {
        await tx(pool, wrongCtx(), async (c) => {
          const tables = (await c.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id'")).rows.map((r) => r.table_name);
          for (const t of [...tables, 'organizations']) {
            const res = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
            expect({ table: t, n: res.rows[0].n }).toEqual({ table: t, n: 0 });
          }
        });
      } finally {
        await pool.end();
      }
    });

    it("cannot change or delete B's rows, nor insert into B", async () => {
      const pool = pools.app();
      try {
        await tx(pool, wrongCtx(), async (c) => {
          expect((await c.query("UPDATE products SET name = 'pwned' WHERE id = $1", [productB])).rowCount).toBe(0);
          expect((await c.query('DELETE FROM membership_roles')).rowCount).toBe(0);
          expect((await c.query("UPDATE organizations SET name = 'pwned' WHERE id = $1", [b.id])).rowCount).toBe(0);
        });
        for (const sql of [
          ["INSERT INTO products (organization_id, sku, name, updated_at) VALUES ($1, 'X', 'smuggled', now())", [b.id]],
          ["INSERT INTO roles (organization_id, name, updated_at) VALUES ($1, 'smuggled', now())", [b.id]],
          ['INSERT INTO organization_memberships (organization_id, user_id, updated_at) VALUES ($1, $2, now())', [b.id, a.owner.userId]],
        ] as const) {
          await expect(tx(pool, wrongCtx(), (c) => c.query(sql[0], [...sql[1]]))).rejects.toThrow(/row-level security/);
        }
      } finally {
        await pool.end();
      }
    });

    it('cannot make itself a member of B, even with full knowledge of B', async () => {
      const pool = pools.app();
      try {
        // No invitation: denied. A forged invitation hash: denied.
        await expect(tx(pool, { ...wrongCtx(), 'app.invitation_token_hash': 'f'.repeat(64) }, (c) =>
          c.query('INSERT INTO organization_memberships (organization_id, user_id, updated_at) VALUES ($1, $2, now())', [b.id, a.owner.userId]),
        )).rejects.toThrow(/row-level security/);
        // Claiming to be B's creator: denied, because B already has members.
        await expect(tx(pool, { 'app.org_id': b.id, 'app.user_id': b.owner.userId }, (c) =>
          c.query('INSERT INTO organization_memberships (organization_id, user_id, updated_at) VALUES ($1, $2, now())', [b.id, b.owner.userId]),
        )).rejects.toThrow(/duplicate key|row-level security/);
      } finally {
        await pool.end();
      }
    });

    it('suspended or revoked members lose database-level access too', async () => {
      const m = await addMember(app, a, 'gate-revoked', 'Inventory manager');
      await http(app).patch(`/v1/orgs/${a.id}/members/${m.membershipId}`).set(bearer(a.owner)).send({ status: 'SUSPENDED' }).expect(200);
      const pool = pools.app();
      try {
        await tx(pool, { 'app.org_id': a.id, 'app.user_id': m.userId }, async (c) => {
          expect((await c.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(0);
          expect((await c.query('SELECT count(*)::int AS n FROM roles')).rows[0].n).toBe(0);
        });
      } finally {
        await pool.end();
      }
    });

    it("TenantDb.inOrgUnchecked with B's ID for A's owner (the planted bug) changes nothing in B", async () => {
      const db = app.get(TenantDb);
      const seen = await db.inOrgUnchecked(b.id, a.owner.userId, async (t) => ({
        products: await t.product.findMany(),
        updated: (await t.product.updateMany({ data: { name: 'pwned' } })).count,
      }));
      expect(seen).toEqual({ products: [], updated: 0 });
      const after = await http(app).get(`/v1/orgs/${b.id}/products/${productB}`).set(bearer(b.owner)).expect(200);
      expect(after.body.name).toBe('B only');
    });
  });

  describe('B. tenant context never leaks between pooled connections', () => {
    it('settings are transaction-local: gone after COMMIT and after ROLLBACK on the same connection', async () => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
      try {
        const c = await pool.connect();
        try {
          for (const end of ['COMMIT', 'ROLLBACK']) {
            await c.query('BEGIN');
            await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [a.id, a.owner.userId]);
            await c.query(end);
            const res = await c.query("SELECT coalesce(current_setting('app.org_id', true), '') AS org, coalesce(current_setting('app.user_id', true), '') AS usr");
            expect({ end, ...res.rows[0] }).toEqual({ end, org: '', usr: '' });
            expect((await c.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(0);
          }
        } finally {
          c.release();
        }
      } finally {
        await pool.end();
      }
    });

    it('after TenantDb transactions (including failed ones), the shared Prisma pool carries no context', async () => {
      const db = app.get(TenantDb);
      const prisma = app.get(PrismaService);
      await db.inOrgUnchecked(a.id, a.owner.userId, (t) => t.product.findMany());
      await expect(db.inOrgUnchecked(a.id, a.owner.userId, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      await db.asPlatform(a.owner.userId, (t) => t.organization.findMany());
      // Hit many pooled connections outside any TenantDb transaction.
      const results = await Promise.all(Array.from({ length: 20 }, () =>
        prisma.$queryRaw<{ org: string; usr: string; plat: string; inv: string }[]>`
          SELECT coalesce(current_setting('app.org_id', true), '') AS org, coalesce(current_setting('app.user_id', true), '') AS usr,
                 coalesce(current_setting('app.platform_scope', true), '') AS plat, coalesce(current_setting('app.invitation_token_hash', true), '') AS inv`));
      for (const [row] of results) expect(row).toEqual({ org: '', usr: '', plat: '', inv: '' });
      expect(await prisma.product.count()).toBe(0);
    });

    it('a valid session for one organization cannot be steered into another by any request input', async () => {
      // Covered exhaustively by authorization-matrix; here, the end-to-end login path for completeness.
      const relog = await login(app, a.owner.email);
      await http(app).get(`/v1/orgs/${b.id}/products`).set(bearer(relog)).expect(403);
    });
  });
});

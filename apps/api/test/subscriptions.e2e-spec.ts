/** Mandatory test 9: plan limits and subscription state are enforced by the backend. */
import { INestApplication } from '@nestjs/common';
import { bearer, createOrg, createTestApp, http, resetDatabase, setPlan, signUp, TestOrg } from './support/harness';

describe('Subscription entitlements', () => {
  let app: INestApplication;
  let org: TestOrg;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'sub-owner'), 'sub');
  });
  afterAll(() => app.close());

  it('starts new organizations on a trial of the starter plan', async () => {
    const res = await http(app).get(`/v1/orgs/${org.id}/subscription`).set(bearer(org.owner)).expect(200);
    expect(res.body.plan.code).toBe('starter');
    expect(res.body.status).toBe('TRIALING');
    expect(res.body.usage['limit.branches']).toEqual({ used: 1, limit: 1 });
  });

  it('blocks creating a branch beyond the plan limit', async () => {
    const res = await http(app).post(`/v1/orgs/${org.id}/branches`).set(bearer(org.owner)).send({ name: 'Two', code: 'TWO' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('entitlement_limit_reached');
  });

  it('concurrent creations cannot exceed the limit', async () => {
    await setPlan(org.id, 'growth'); // 5 branches, 1 used
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        http(app).post(`/v1/orgs/${org.id}/branches`).set(bearer(org.owner)).send({ name: `Race ${i}`, code: `R${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 403)).toHaveLength(4);
    const branches = await http(app).get(`/v1/orgs/${org.id}/branches`).set(bearer(org.owner)).expect(200);
    expect(branches.body).toHaveLength(5);
  });

  it('an expired subscription makes the organization read-only without losing data', async () => {
    await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).send({ sku: 'KEEP', name: 'Keep me' }).expect(201);
    await setPlan(org.id, 'growth', 'EXPIRED');
    const write = await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).send({ sku: 'NEW', name: 'blocked' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('subscription_read_only');
    const read = await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).expect(200);
    expect(read.body.map((p: { sku: string }) => p.sku)).toEqual(['KEEP']);
  });

  it('organizations cannot change their own subscription (no RLS update path)', async () => {
    // There is no API endpoint; the database refuses org-scoped updates too.
    const { pools } = await import('./support/harness');
    const pool = pools.app();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [org.id]);
      await client.query("SELECT set_config('app.user_id', $1, true)", [org.owner.userId]);
      const visible = await client.query('SELECT count(*)::int AS n FROM organization_subscriptions');
      expect(visible.rows[0].n).toBe(1); // the owner can see it...
      const res = await client.query("UPDATE organization_subscriptions SET status = 'ACTIVE'");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});

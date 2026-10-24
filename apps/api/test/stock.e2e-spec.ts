/** Mandatory test 10: concurrent stock operations never produce invalid balances. */
import { INestApplication } from '@nestjs/common';
import { bearer, createOrg, createTestApp, http, resetDatabase, signUp, TestOrg } from './support/harness';

describe('Stock adjustments', () => {
  let app: INestApplication;
  let org: TestOrg;
  let product: string;

  const adjust = (key: string, delta: string) =>
    http(app).post(`/v1/orgs/${org.id}/branches/${org.mainBranchId}/stock/adjustments`).set(bearer(org.owner))
      .set('Idempotency-Key', key).send({ productId: product, quantityDelta: delta, reason: 'test' });

  const balance = async () => {
    const res = await http(app).get(`/v1/orgs/${org.id}/branches/${org.mainBranchId}/stock`).set(bearer(org.owner)).expect(200);
    return res.body.items.find((b: { product: { id: string } }) => b.product.id === product)?.quantity;
  };

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'stock-owner'), 'stock');
    product = (await http(app).post(`/v1/orgs/${org.id}/products`).set(bearer(org.owner)).send({ sku: 'SUGAR', name: 'Sugar', unit: 'kg' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('uses exact decimal arithmetic', async () => {
    await adjust('dec-000001', '0.1').expect(201);
    await adjust('dec-000002', '0.2').expect(201);
    expect(await balance()).toBe('0.300');
    await adjust('dec-000003', '-0.3').expect(201);
    expect(await balance()).toBe('0.000');
  });

  it('serializes concurrent decrements: exactly the available quantity is removed', async () => {
    await adjust('seed-00010', '10').expect(201);
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => adjust(`race-${String(i).padStart(5, '0')}`, '-1')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'insufficient_stock')).toBe(true);
    expect(await balance()).toBe('0.000');
  });

  it('the ledger reconciles with the balance', async () => {
    const res = await http(app).get(`/v1/orgs/${org.id}/branches/${org.mainBranchId}/stock/movements`).set(bearer(org.owner)).expect(200);
    const sum = res.body.items.reduce((acc: number, m: { quantityDelta: string }) => acc + Math.round(Number(m.quantityDelta) * 1000), 0);
    expect(sum).toBe(0);
  });

  it('replaying an idempotency key does not apply the adjustment twice, even concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => adjust('same-key-0001', '7')));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.body.movement.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
    expect(await balance()).toBe('7.000');
  });

  it('rejects reusing an idempotency key for a different request, and missing keys', async () => {
    const res = await adjust('same-key-0001', '8');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('idempotency_key_reused');
    await http(app).post(`/v1/orgs/${org.id}/branches/${org.mainBranchId}/stock/adjustments`).set(bearer(org.owner))
      .send({ productId: product, quantityDelta: '1', reason: 'no key' }).expect(400);
  });

  it('rejects floating-point style or malformed quantities', async () => {
    await adjust('bad-qty-001', '1e3').expect(400);
    await adjust('bad-qty-002', '0.0001').expect(400);
    await adjust('bad-qty-003', '0').expect(400);
  });
});

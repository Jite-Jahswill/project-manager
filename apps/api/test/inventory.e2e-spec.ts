/**
 * Phase 4: product catalogue, literal-safe search and the database-maintained stock ledger
 * (opening balances, adjustments, counts, transfers, reversals, reconciliation).
 * Real PostgreSQL and Redis. Purchasing: purchasing.e2e-spec.ts.
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, setPlan, signUp, TestOrg, TestUser } from './support/harness';

jest.setTimeout(120_000);

describe('Inventory (phase 4)', () => {
  let app: INestApplication;
  let org: TestOrg;
  let other: TestOrg;
  let second: string;
  let keeper: TestUser & { membershipId: string };
  let cashier: TestUser & { membershipId: string };
  let n = 0;

  const as = (u: { token: string }) => ({
    get: (p: string) => http(app).get(`/v1/orgs/${org.id}${p}`).set(bearer(u)),
    post: (p: string, body: object = {}, key?: string) => {
      const r = http(app).post(`/v1/orgs/${org.id}${p}`).set(bearer(u));
      return (key ? r.set('Idempotency-Key', key) : r).send(body);
    },
    patch: (p: string, body: object) => http(app).patch(`/v1/orgs/${org.id}${p}`).set(bearer(u)).send(body),
  });
  const owner = () => as(org.owner);
  const key = (label: string) => `${label}-${Date.now()}-${++n}`.replace(/[^A-Za-z0-9_-]/g, '-');

  async function product(fields: Record<string, unknown> = {}) {
    return (await owner().post('/products', { sku: key('SKU'), name: `Item ${++n}`, ...fields }).expect(201)).body as { id: string; version: number };
  }
  async function stockOf(productId: string, branchId = org.mainBranchId): Promise<string> {
    const r = await owner().get(`/branches/${branchId}/stock?limit=200`).expect(200);
    return r.body.items.find((b: { product: { id: string } }) => b.product.id === productId)?.quantity ?? '0.000';
  }
  async function sql<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(settings)) await c.query('SELECT set_config($1, $2, true)', [k, v]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
      await pool.end();
    }
  }
  const ctx = () => ({ 'app.org_id': org.id, 'app.user_id': org.owner.userId });

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'inv-owner'), 'inv');
    other = await createOrg(app, await signUp(app, 'inv-other'), 'inv-other');
    await setPlan(org.id, 'growth');
    second = (await owner().post('/branches', { name: 'Second', code: 'SECOND' }).expect(201)).body.id;
    keeper = await addMember(app, org, 'inv-keeper', 'Storekeeper', org.mainBranchId);
    cashier = await addMember(app, org, 'inv-cashier', 'Cashier', org.mainBranchId);
  });
  afterAll(() => app.close());

  describe('catalogue', () => {
    it('creates, reads, edits and paginates products; costs are visible only with inventory.cost.read', async () => {
      const cat = (await owner().post('/product-categories', { name: 'Textiles' }).expect(201)).body;
      const p = (await owner().post('/products', {
        sku: 'TSHIRT-1', name: 'T-shirt', unit: 'each', barcode: '4006381333931', categoryId: cat.id, costPriceMinor: '1250', sellingPriceMinor: '2500', reorderLevel: '5',
      }).expect(201)).body;
      expect(p).toMatchObject({ sku: 'TSHIRT-1', unit: 'each', quantityScale: 0, currency: 'USD', costPriceMinor: '1250', sellingPriceMinor: '2500', reorderLevel: '5.000', version: 1, category: { id: cat.id } });
      const asCashier = (await as(cashier).get(`/products/${p.id}`).expect(200)).body;
      expect(asCashier).not.toHaveProperty('costPriceMinor');
      expect(asCashier.sellingPriceMinor).toBe('2500');
      const edited = (await owner().patch(`/products/${p.id}`, { version: 1, name: 'T-shirt (cotton)', sellingPriceMinor: '2600' }).expect(200)).body;
      expect(edited).toMatchObject({ name: 'T-shirt (cotton)', sellingPriceMinor: '2600', version: 2 });
      expect((await owner().patch(`/products/${p.id}`, { version: 1, name: 'stale' })).body.code).toBe('version_conflict');
      await owner().patch(`/products/${p.id}`, { version: 2, unit: 'furlong' }).expect(400);
      // Pagination is stable and complete.
      for (let i = 0; i < 5; i++) await product({ name: `Paged ${i}` });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const r: { body: { items: { id: string; name: string }[]; nextCursor: string | null } } = await owner().get(`/products?q=Paged&limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
        seen.push(...r.body.items.map((x) => x.name));
        cursor = r.body.nextCursor;
      } while (cursor);
      expect(seen).toEqual(['Paged 0', 'Paged 1', 'Paged 2', 'Paged 3', 'Paged 4']);
      await owner().get('/products?cursor=not-a-cursor').expect(400);
    });

    it('SKUs and barcodes are unique per organization (also under concurrency), not across organizations', async () => {
      await product({ sku: 'DUP-1', barcode: 'BAR-0001' });
      expect((await owner().post('/products', { sku: 'DUP-1', name: 'x' })).body.code).toBe('sku_taken');
      expect((await owner().post('/products', { sku: 'DUP-2', name: 'x', barcode: 'BAR-0001' })).body.code).toBe('barcode_taken');
      const race = await Promise.all([1, 2, 3].map(() => owner().post('/products', { sku: 'RACE-1', name: 'race' })));
      expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      // The same SKU in another organization is independent.
      await http(app).post(`/v1/orgs/${other.id}/products`).set(bearer(other.owner)).send({ sku: 'DUP-1', name: 'theirs', barcode: 'BAR-0001' }).expect(201);
    });

    it('search treats %, _, backslashes and quotes literally, handles Unicode and empty input, and never crosses organizations', async () => {
      const names = ['100% cotton', '1000 cotton', 'a_b widget', 'axb widget', 'back\\slash bolt', 'backslash bolt', "O'Brien \"quoted\" nut", 'Café crème cup'];
      for (const name of names) await product({ name });
      await http(app).post(`/v1/orgs/${other.id}/products`).set(bearer(other.owner)).send({ sku: 'SECRET-1', name: '100% secret' }).expect(201);
      const search = async (q: string) => (await owner().get(`/products?limit=200&q=${encodeURIComponent(q)}`).expect(200)).body.items.map((p: { name: string }) => p.name).sort();
      expect(await search('%')).toEqual(['100% cotton']);
      expect(await search('100%')).toEqual(['100% cotton']);
      expect(await search('_')).toEqual(['a_b widget']);
      expect(await search('a_b')).toEqual(['a_b widget']);
      expect(await search('\\')).toEqual(['back\\slash bolt']);
      expect(await search("O'Brien \"quoted\"")).toEqual(["O'Brien \"quoted\" nut"]);
      expect(await search("'; DROP TABLE products; --")).toEqual([]);
      expect(await search('CRÈME')).toEqual(['Café crème cup']);
      expect(await search('secret')).toEqual([]);
      const all = (await owner().get('/products?limit=200&q=').expect(200)).body.items;
      expect(all.length).toBeGreaterThanOrEqual(names.length);
      // Barcode and SKU are searchable too.
      const byBarcode = await product({ barcode: 'EAN-7777777' });
      expect((await owner().get('/products?q=7777777').expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([byBarcode.id]);
    });

    it('categories are unique by name, nest one level, and archived ones cannot be assigned', async () => {
      const top = (await owner().post('/product-categories', { name: 'Hardware' }).expect(201)).body;
      expect((await owner().post('/product-categories', { name: '  hardware ' })).body.code).toBe('category_name_taken');
      const sub = (await owner().post('/product-categories', { name: 'Bolts', parentId: top.id }).expect(201)).body;
      expect((await owner().post('/product-categories', { name: 'Tiny bolts', parentId: sub.id })).body.code).toBe('invalid_parent');
      expect((await owner().post(`/product-categories/${top.id}/archive`, { version: top.version })).body.code).toBe('category_has_children');
      await owner().post(`/product-categories/${sub.id}/archive`, { version: sub.version }).expect(200);
      await owner().post('/products', { sku: key('CAT'), name: 'x', categoryId: sub.id }).expect(404);
      await as(cashier).post('/product-categories', { name: 'Cashier category' }).expect(403);
    });

    it('lifecycle: inactive products leave the default list; archiving needs zero stock; archived products cannot be edited', async () => {
      const p = await product({ unit: 'kg' });
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: p.id, quantity: '2.5', reason: 'initial stock' }).expect(201);
      expect((await owner().post(`/products/${p.id}/archive`)).body.code).toBe('stock_on_hand');
      await owner().patch(`/products/${p.id}`, { version: 1, status: 'INACTIVE' }).expect(200);
      expect((await owner().get('/products?limit=200')).body.items.map((x: { id: string }) => x.id)).not.toContain(p.id);
      expect((await owner().get('/products?status=INACTIVE&limit=200')).body.items.map((x: { id: string }) => x.id)).toContain(p.id);
      // The unit is fixed once stock history exists.
      expect((await owner().patch(`/products/${p.id}`, { version: 2, unit: 'g' })).body.code).toBe('unit_locked');
      await owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: p.id, quantityDelta: '-2.5', reason: 'written off' }, key('wo')).expect(201);
      await owner().post(`/products/${p.id}/archive`).expect(201);
      expect((await owner().patch(`/products/${p.id}`, { version: 3, name: 'x' })).body.code).toBe('product_archived');
    });
  });

  describe('stock ledger', () => {
    it('opening balances post once, even when repeated or concurrent', async () => {
      const p = await product();
      const body = { productId: p.id, quantity: '10', reason: 'opening stock' };
      const results = await Promise.all([1, 2, 3].map(() => owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, body)));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.movement.id)).size).toBe(1);
      expect(await stockOf(p.id)).toBe('10.000');
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { ...body, quantity: '11' })).body.code).toBe('opening_balance_exists');
      const later = await product();
      await owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: later.id, quantityDelta: '1', reason: 'found' }, key('adj')).expect(201);
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: later.id, quantity: '5', reason: 'late opening' })).body.code).toBe('stock_history_exists');
    });

    it('validates quantity precision against the unit and refuses negative stock', async () => {
      const each = await product({ unit: 'each' });
      const kg = await product({ unit: 'kg' });
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: each.id, quantityDelta: '1.5', reason: 'half' }, key('p'))).body.code).toBe('invalid_quantity_precision');
      await owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: kg.id, quantityDelta: '0.125', reason: 'weighed' }, key('p')).expect(201);
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: kg.id, quantityDelta: '-0.126', reason: 'too much' }, key('p'))).body.code).toBe('insufficient_stock');
      expect(await stockOf(kg.id)).toBe('0.125');
      // The database enforces precision too, not only the API.
      await expect(sql(ctx(), (c) => c.query(
        `INSERT INTO stock_movements (organization_id, branch_id, product_id, type, quantity_delta, balance_after, reason, actor_user_id, idempotency_key)
         VALUES ($1, $2, $3, 'ADJUSTMENT', 0.5, 0, 'sql half', $4, 'sql-half-1')`, [org.id, org.mainBranchId, each.id, org.owner.userId]))).rejects.toThrow(/quantity_precision/);
    });

    it('counts post the difference against the locked balance; matching lines post nothing; replays return the same count', async () => {
      const a = await product();
      const b = await product();
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: a.id, quantity: '10', reason: 'opening' }).expect(201);
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: b.id, quantity: '4', reason: 'opening' }).expect(201);
      const k = key('count');
      const body = { note: 'monthly count', lines: [{ productId: a.id, countedQuantity: '7' }, { productId: b.id, countedQuantity: '4' }] };
      const first = (await as(keeper).post(`/branches/${org.mainBranchId}/stock/counts`, body, k).expect(201)).body;
      const lines = Object.fromEntries(first.count.lines.map((l: { productId: string }) => [l.productId, l]));
      expect(lines[a.id]).toMatchObject({ expectedQuantity: '10.000', countedQuantity: '7.000', difference: '-3.000', movementId: expect.any(String) });
      expect(lines[b.id]).toMatchObject({ expectedQuantity: '4.000', difference: '0.000', movementId: null });
      expect(await stockOf(a.id)).toBe('7.000');
      const again = (await as(keeper).post(`/branches/${org.mainBranchId}/stock/counts`, body, k).expect(201)).body;
      expect(again).toMatchObject({ replayed: true, count: { id: first.count.id } });
      expect(await stockOf(a.id)).toBe('7.000');
      await as(keeper).get(`/branches/${org.mainBranchId}/stock/counts/${first.count.id}`).expect(200);
      // A count during concurrent adjustments still lands on the counted quantity (computed under the lock).
      await Promise.all([
        owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: a.id, quantityDelta: '1', reason: 'concurrent' }, key('c1')),
        as(keeper).post(`/branches/${org.mainBranchId}/stock/counts`, { note: 'recount', lines: [{ productId: a.id, countedQuantity: '20' }] }, key('c2')),
      ]);
      expect(['20.000', '21.000']).toContain(await stockOf(a.id));
      // Branch scope: the keeper counts only at their branch; a cashier cannot count.
      await as(keeper).post(`/branches/${second}/stock/counts`, body, key('c3')).expect(403);
      await as(cashier).post(`/branches/${org.mainBranchId}/stock/counts`, body, key('c4')).expect(403);
    });

    it('transfers move stock atomically between active branches; insufficient stock moves nothing', async () => {
      const a = await product();
      const b = await product();
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: a.id, quantity: '10', reason: 'opening' }).expect(201);
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: b.id, quantity: '1', reason: 'opening' }).expect(201);
      const t = (await owner().post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: second, reason: 'restock second', lines: [{ productId: a.id, quantity: '4' }] }, key('t')).expect(201)).body;
      expect(t.transfer.movements.map((m: { type: string; quantityDelta: string }) => [m.type, m.quantityDelta]).sort()).toEqual([['TRANSFER_IN', '4.000'], ['TRANSFER_OUT', '-4.000']]);
      expect([await stockOf(a.id), await stockOf(a.id, second)]).toEqual(['6.000', '4.000']);
      // Two lines, the second insufficient: neither moves.
      const fail = await owner().post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: second, reason: 'too much', lines: [{ productId: a.id, quantity: '1' }, { productId: b.id, quantity: '5' }] }, key('t'));
      expect(fail.body.code).toBe('insufficient_stock');
      expect([await stockOf(a.id), await stockOf(b.id), await stockOf(a.id, second)]).toEqual(['6.000', '1.000', '4.000']);
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: org.mainBranchId, reason: 'loop', lines: [{ productId: a.id, quantity: '1' }] }, key('t'))).body.code).toBe('same_branch');
      // The keeper has no transfer permission; a branch-limited transferrer cannot send into a branch they lack.
      await as(keeper).post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: second, reason: 'x', lines: [{ productId: a.id, quantity: '1' }] }, key('t')).expect(403);
      const logistics = await addMember(app, org, 'inv-logistics', 'Logistics officer', org.mainBranchId);
      await as(logistics).post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: second, reason: 'into a branch they lack', lines: [{ productId: a.id, quantity: '1' }] }, key('t')).expect(403);
    });

    it('concurrent opposite transfers and adjustments neither deadlock nor lose updates; the ledger reconciles', async () => {
      const ps = [await product(), await product()];
      for (const p of ps) {
        for (const br of [org.mainBranchId, second]) await owner().post(`/branches/${br}/stock/opening-balances`, { productId: p.id, quantity: '50', reason: 'opening' }).expect(201);
      }
      const lines = (rev: boolean) => (rev ? [...ps].reverse() : ps).map((p) => ({ productId: p.id, quantity: '1' }));
      const ops = Array.from({ length: 16 }, (_, i) => (i % 4 === 3
        ? owner().post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: ps[i % 2].id, quantityDelta: '-1', reason: 'parallel' }, key('pa'))
        : owner().post(`/branches/${i % 2 ? second : org.mainBranchId}/stock/transfers`, { toBranchId: i % 2 ? org.mainBranchId : second, reason: 'parallel', lines: lines(i % 2 === 1) }, key('pt'))));
      const results = await Promise.all(ops);
      expect(results.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
      const total = async (p: string) => Number(await stockOf(p)) + Number(await stockOf(p, second));
      expect(await total(ps[0].id) + await total(ps[1].id)).toBe(200 - 4);
      for (const br of [org.mainBranchId, second]) {
        const r = (await owner().get(`/branches/${br}/stock/reconciliation`).expect(200)).body;
        expect(r).toMatchObject({ consistent: true, discrepancies: [] });
        expect(r.productsChecked).toBeGreaterThan(0);
      }
    });

    it('reversals are correcting entries, once only, for adjustments/openings/counts and with approval permission', async () => {
      const p = await product();
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: p.id, quantity: '5', reason: 'opening' }).expect(201);
      const adj = (await as(keeper).post(`/branches/${org.mainBranchId}/stock/adjustments`, { productId: p.id, quantityDelta: '-2', reason: 'damaged' }, key('r')).expect(201)).body.movement;
      await as(keeper).post(`/branches/${org.mainBranchId}/stock/movements/${adj.id}/reverse`, { reason: 'not damaged' }).expect(403);
      const rev = (await owner().post(`/branches/${org.mainBranchId}/stock/movements/${adj.id}/reverse`, { reason: 'not damaged after all' }).expect(201)).body;
      expect(rev.movement).toMatchObject({ type: 'REVERSAL', quantityDelta: '2.000', balanceAfter: '5.000' });
      const twice = (await owner().post(`/branches/${org.mainBranchId}/stock/movements/${adj.id}/reverse`, { reason: 'again' }).expect(201)).body;
      expect(twice).toMatchObject({ replayed: true, movement: { id: rev.movement.id } });
      expect(await stockOf(p.id)).toBe('5.000');
      const t = (await owner().post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: second, reason: 'move', lines: [{ productId: p.id, quantity: '1' }] }, key('r')).expect(201)).body;
      const out = t.transfer.movements.find((m: { type: string }) => m.type === 'TRANSFER_OUT');
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/movements/${out.id}/reverse`, { reason: 'undo transfer' })).body.code).toBe('not_reversible');
    });

    it('posted history is immutable; balances cannot be written directly; archived branches accept no movements', async () => {
      const p = await product();
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: p.id, quantity: '3', reason: 'opening' }).expect(201);
      await expect(sql(ctx(), (c) => c.query("UPDATE stock_movements SET quantity_delta = 100 WHERE product_id = $1", [p.id]))).rejects.toThrow(/permission denied|append-only/);
      await expect(sql(ctx(), (c) => c.query('DELETE FROM stock_movements WHERE product_id = $1', [p.id]))).rejects.toThrow(/permission denied|append-only/);
      await expect(sql(ctx(), (c) => c.query('UPDATE stock_balances SET quantity = 99 WHERE product_id = $1', [p.id]))).rejects.toThrow(/permission denied/);
      const br = (await owner().post('/branches', { name: 'Closing', code: key('CLOSE').toUpperCase().slice(0, 20) }).expect(201)).body;
      await owner().post(`/branches/${br.id}/stock/opening-balances`, { productId: p.id, quantity: '1', reason: 'opening' }).expect(201);
      await owner().post(`/branches/${br.id}/stock/adjustments`, { productId: p.id, quantityDelta: '-1', reason: 'emptied' }, key('cl')).expect(201);
      await owner().post(`/branches/${br.id}/archive`, { version: br.version }).expect(200);
      expect((await owner().post(`/branches/${br.id}/stock/counts`, { note: 'after close', lines: [{ productId: p.id, countedQuantity: '1' }] }, key('cl'))).body.code).toBe('branch_archived');
      expect((await owner().post(`/branches/${org.mainBranchId}/stock/transfers`, { toBranchId: br.id, reason: 'into closed', lines: [{ productId: p.id, quantity: '1' }] }, key('cl'))).body.code).toBe('branch_archived');
      await expect(sql(ctx(), (c) => c.query(
        `INSERT INTO stock_movements (organization_id, branch_id, product_id, type, quantity_delta, balance_after, reason, actor_user_id, idempotency_key)
         VALUES ($1, $2, $3, 'ADJUSTMENT', 1, 0, 'sql into archived', $4, 'sql-archived-1')`, [org.id, br.id, p.id, org.owner.userId]))).rejects.toThrow(/branch_archived/);
      // History stays readable.
      expect((await owner().get(`/branches/${br.id}/stock/movements`).expect(200)).body.items).toHaveLength(2);
    });

    it('low-stock lists products at or below their reorder level; branch scope applies to every stock route', async () => {
      const low = await product({ reorderLevel: '5' });
      const ok = await product({ reorderLevel: '1' });
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: low.id, quantity: '3', reason: 'opening' }).expect(201);
      await owner().post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: ok.id, quantity: '3', reason: 'opening' }).expect(201);
      const items = (await as(keeper).get(`/branches/${org.mainBranchId}/stock/low`).expect(200)).body.items.map((x: { product: { id: string } }) => x.product.id);
      expect(items).toContain(low.id);
      expect(items).not.toContain(ok.id);
      for (const path of ['/stock', '/stock/movements', '/stock/low', '/stock/reconciliation']) await as(keeper).get(`/branches/${second}${path}`).expect(403);
      await as(keeper).post(`/branches/${second}/stock/adjustments`, { productId: low.id, quantityDelta: '1', reason: 'x' }, key('s')).expect(403);
      // Another organization's branch and products are invisible.
      await http(app).get(`/v1/orgs/${other.id}/branches/${org.mainBranchId}/stock`).set(bearer(other.owner)).expect(404);
    });

    it('stock operations are audited with actor and safe metadata', async () => {
      const r = await owner().get('/audit-events?limit=100').expect(200);
      const actions = new Set(r.body.map((e: { action: string }) => e.action));
      for (const a of ['inventory.stock.opening_balance', 'inventory.stock.adjusted', 'inventory.stock.counted', 'inventory.stock.transferred', 'inventory.stock.reversed', 'inventory.product.created', 'inventory.category.created']) {
        expect({ action: a, present: actions.has(a) }).toEqual({ action: a, present: true });
      }
      for (const e of r.body) expect(e.actorUserId).toEqual(expect.any(String));
    });
  });
});

/**
 * Phase 5: customers, cashier sessions, sales posted through the stock ledger, payments,
 * refunds and returns (docs/architecture/12-sales.md). Real PostgreSQL and Redis.
 * Races are deterministic: concurrent requests are issued together with Promise.all and
 * the outcome is asserted exactly (row locks and unique indexes decide the winners).
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, setPlan, signUp, TestOrg, TestUser } from './support/harness';

jest.setTimeout(180_000);

type Member = TestUser & { membershipId: string };

describe('Sales, POS, payments and returns (phase 5)', () => {
  let app: INestApplication;
  let org: TestOrg;
  let other: TestOrg;
  let second: string;
  let cashier: Member;
  let manager: Member;
  let accountant: Member;
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

  async function product(fields: Record<string, unknown> = {}, stock?: string, branchId = org.mainBranchId) {
    const p = (await owner().post('/products', { sku: key('SKU'), name: `Item ${++n}`, sellingPriceMinor: '250', ...fields }).expect(201)).body as { id: string; version: number };
    if (stock) await owner().post(`/branches/${branchId}/stock/opening-balances`, { productId: p.id, quantity: stock, reason: 'opening' }).expect(201);
    return p;
  }
  async function stockOf(productId: string, branchId = org.mainBranchId): Promise<string> {
    const r = await owner().get(`/branches/${branchId}/stock?limit=200`).expect(200);
    return r.body.items.find((b: { product: { id: string } }) => b.product.id === productId)?.quantity ?? '0.000';
  }
  async function sql<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
    const pool = pools.app();
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
  const ctx = () => ({ 'app.org_id': org.id, 'app.user_id': org.owner.userId });
  const sell = (u: { token: string }, lines: { productId: string; quantity: string }[], k = key('sale'), extra: object = {}, branchId = org.mainBranchId) =>
    as(u).post(`/branches/${branchId}/sales`, { lines, ...extra }, k);
  const pay = (u: { token: string }, saleId: string, method: string, amountMinor: string, k = key('pay'), extra: object = {}) =>
    as(u).post(`/sales/${saleId}/payments`, { method, amountMinor, ...extra }, k);
  /** Audit rows for an action, read under the organization's RLS context (the API pages at 100). */
  const auditOf = async (action: string) => (await sql(ctx(), (c) => c.query(
    'SELECT action, resource_id AS "resourceId", actor_user_id AS "actorUserId", metadata FROM audit_events WHERE action = $1', [action]))).rows;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'pos-owner'), 'pos');
    other = await createOrg(app, await signUp(app, 'pos-other'), 'pos-other');
    await setPlan(org.id, 'growth');
    second = (await owner().post('/branches', { name: 'Second', code: 'SECOND' }).expect(201)).body.id;
    cashier = await addMember(app, org, 'pos-cashier', 'Cashier', org.mainBranchId);
    manager = await addMember(app, org, 'pos-manager', 'Branch manager', org.mainBranchId);
    accountant = await addMember(app, org, 'pos-accountant', 'Accountant');
    // The owner sells at both branches; the cashier and the manager at the main branch.
    await owner().post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201);
    await owner().post(`/branches/${second}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201);
    await as(manager).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201);
  });
  afterAll(() => app.close());

  // ---------------------------------------------------------------- customers

  describe('customers', () => {
    it('normalizes contacts, rejects duplicates (also concurrently) and keeps personal data out of the audit log', async () => {
      const c = (await owner().post('/customers', { name: ' Ada Obi ', email: 'Ada@Example.TEST', phone: '+234 (803) 000-0001', homeBranchId: org.mainBranchId }).expect(201)).body;
      expect(c).toMatchObject({ name: 'Ada Obi', email: 'ada@example.test', phone: '+2348030000001', status: 'ACTIVE', version: 1 });
      expect((await owner().post('/customers', { name: 'Other', email: 'ADA@example.test' })).body.code).toBe('customer_email_taken');
      expect((await owner().post('/customers', { name: 'Other', phone: '+234-803-000-0001' })).body.code).toBe('customer_phone_taken');
      await owner().post('/customers', { name: 'Bad', phone: '12' }).expect(400);
      const race = await Promise.all(Array.from({ length: 4 }, () => owner().post('/customers', { name: 'Twin', email: 'twin@example.test' })));
      expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      const audit = await auditOf('sales.customer.created');
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit)).not.toMatch(/ada@example|2348030000001/);
    });

    it('searches literally, filters and paginates', async () => {
      await owner().post('/customers', { name: '100% Cotton Ltd' }).expect(201);
      await owner().post('/customers', { name: '1000 Cottons' }).expect(201);
      const hits = (await owner().get(`/customers?q=${encodeURIComponent('100%')}`).expect(200)).body.items.map((c: { name: string }) => c.name);
      expect(hits).toEqual(['100% Cotton Ltd']);
      const p1 = (await owner().get('/customers?limit=2').expect(200)).body;
      expect(p1.items).toHaveLength(2);
      const p2 = (await owner().get(`/customers?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`).expect(200)).body;
      expect(p2.items.map((c: { id: string }) => c.id)).not.toContain(p1.items[0].id);
      expect((await owner().get('/customers?q=example.test').expect(200)).body.items.length).toBeGreaterThan(0);
    });

    it('deactivates and reactivates with optimistic concurrency; concurrent edits have one winner', async () => {
      const c = (await owner().post('/customers', { name: 'Edit Me' }).expect(201)).body;
      const race = await Promise.all([
        owner().patch(`/customers/${c.id}`, { version: 1, name: 'Edit A' }),
        owner().patch(`/customers/${c.id}`, { version: 1, name: 'Edit B' }),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(race.find((r) => r.status === 409)!.body.code).toBe('version_conflict');
      await owner().patch(`/customers/${c.id}`, { version: 2, status: 'INACTIVE' }).expect(200);
      expect((await owner().get('/customers?status=INACTIVE').expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(c.id);
      const p = await product({}, '5');
      expect((await sell(org.owner, [{ productId: p.id, quantity: '1' }], key('s'), { customerId: c.id })).body.code).toBe('customer_inactive');
      await owner().patch(`/customers/${c.id}`, { version: 3, status: 'ACTIVE' }).expect(200);
      await sell(org.owner, [{ productId: p.id, quantity: '1' }], key('s'), { customerId: c.id }).expect(201);
      expect((await auditOf('sales.customer.deactivated')).length).toBe(1);
      expect((await auditOf('sales.customer.reactivated')).length).toBe(1);
    });

    it('branch-limited staff see only their branches\' customers and cannot manage customers', async () => {
      const mine = (await owner().post('/customers', { name: 'Main Customer', homeBranchId: org.mainBranchId }).expect(201)).body;
      const theirs = (await owner().post('/customers', { name: 'Second Customer', homeBranchId: second }).expect(201)).body;
      const seen = (await as(cashier).get('/customers?limit=200').expect(200)).body.items.map((c: { id: string }) => c.id);
      expect(seen).toContain(mine.id);
      expect(seen).not.toContain(theirs.id);
      await as(cashier).get(`/customers/${theirs.id}`).expect(404);
      await as(cashier).post('/customers', { name: 'Nope' }).expect(403);
      // Another organization never sees them.
      await http(app).get(`/v1/orgs/${other.id}/customers/${mine.id}`).set(bearer(other.owner)).expect(404);
    });
  });

  // ---------------------------------------------------------------- cashier sessions

  describe('cashier sessions', () => {
    it('one open session per cashier and branch, also under concurrency; branch scope applies', async () => {
      const race = await Promise.all(Array.from({ length: 4 }, () => as(cashier).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '1000' })));
      expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect(race.filter((r) => r.status === 409).every((r) => r.body.code === 'session_already_open')).toBe(true);
      await as(cashier).post(`/branches/${second}/cashier-sessions`, { openingFloatMinor: '0' }).expect(403);
      // Cashiers see their own sessions; supervisors see everyone's.
      const own = (await as(cashier).get(`/branches/${org.mainBranchId}/cashier-sessions`).expect(200)).body.items;
      expect(own.every((s: { cashierUserId: string }) => s.cashierUserId === cashier.userId)).toBe(true);
      const all = (await as(manager).get(`/branches/${org.mainBranchId}/cashier-sessions`).expect(200)).body.items;
      expect(new Set(all.map((s: { cashierUserId: string }) => s.cashierUserId)).size).toBeGreaterThanOrEqual(3);
      const managers = all.find((s: { cashierUserId: string }) => s.cashierUserId === manager.userId);
      await as(cashier).get(`/cashier-sessions/${managers.id}`).expect(404);
    });

    it('close computes expected cash (float + cash taken − cash refunded) and the variance, once', async () => {
      const p = await product({ sellingPriceMinor: '500' }, '10');
      const session = (await as(cashier).get(`/branches/${org.mainBranchId}/cashier-sessions?status=OPEN`).expect(200)).body.items[0];
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      const payment = (await pay(cashier, sale.id, 'CASH', '500').expect(201)).body.payment;
      expect(payment).toMatchObject({ status: 'CONFIRMED', sessionId: session.id, verification: 'MANUAL' });
      // The cashier holds no refund permission; the manager refunds from their own drawer.
      await as(cashier).post(`/payments/${payment.id}/refunds`, { amountMinor: '100', reason: 'price match' }, key('r')).expect(403);
      const refund = (await as(manager).post(`/payments/${payment.id}/refunds`, { amountMinor: '100', reason: 'price match' }, key('r')).expect(201)).body.refund;
      expect(refund.sessionId).not.toBe(session.id);
      // A card payment does not count towards the drawer.
      const sale2 = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      await pay(cashier, sale2.id, 'CARD_EXTERNAL', '500', key('p'), { reference: 'TERM-0042' }).expect(201);
      const sale3 = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale; // left unpaid
      expect((await as(cashier).get(`/cashier-sessions/${session.id}`).expect(200)).body.expectedCashSoFarMinor).toBe('1500');
      await as(cashier).post(`/cashier-sessions/${session.id}/close`, { version: session.version + 5, declaredCashMinor: '1450' }).expect(409);
      const closed = (await as(cashier).post(`/cashier-sessions/${session.id}/close`, { version: session.version, declaredCashMinor: '1450', note: 'short 50' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'CLOSED', expectedCashMinor: '1500', declaredCashMinor: '1450', varianceMinor: '-50', closedByUserId: cashier.userId });
      expect((await as(cashier).post(`/cashier-sessions/${session.id}/close`, { version: closed.version, declaredCashMinor: '1450' })).body.code).toBe('session_closed');
      // No session: no sales, no cash.
      expect((await sell(cashier, [{ productId: p.id, quantity: '1' }])).body.code).toBe('no_open_session');
      expect((await pay(cashier, sale3.id, 'CASH', '1')).body.code).toBe('no_open_session');
      const audit = (await auditOf('sales.session.closed')).find((e: { resourceId: string }) => e.resourceId === session.id);
      expect(audit.metadata).toMatchObject({ expectedCashMinor: '1500', declaredCashMinor: '1450', varianceMinor: '-50' });
      // Closed sessions are final, also for the database role.
      await expect(sql(ctx(), (c) => c.query("UPDATE cashier_sessions SET status = 'OPEN' WHERE id = $1", [session.id]))).rejects.toThrow();
      // Reopen for later tests.
      await as(cashier).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201);
    });

    it('a supervisor may close another cashier\'s session; a plain cashier may not', async () => {
      const temp = await addMember(app, org, 'pos-temp-cashier', 'Cashier', org.mainBranchId);
      const s = (await as(temp).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '300' }).expect(201)).body;
      await as(cashier).post(`/cashier-sessions/${s.id}/close`, { version: s.version, declaredCashMinor: '300' }).expect(404);
      const closed = (await as(manager).post(`/cashier-sessions/${s.id}/close`, { version: s.version, declaredCashMinor: '300' }).expect(200)).body;
      expect(closed).toMatchObject({ varianceMinor: '0', closedByUserId: manager.userId });
    });
  });

  // ---------------------------------------------------------------- sales

  describe('sales', () => {
    it('prices on the server, respects unit precision and rounds line totals half-up', async () => {
      const soda = await product({ sellingPriceMinor: '250' }, '20');
      const rice = await product({ unit: 'kg', sellingPriceMinor: '333' }, '10.000');
      const res = (await sell(org.owner, [{ productId: soda.id, quantity: '3' }, { productId: rice.id, quantity: '0.5' }]).expect(201)).body;
      expect(res.replayed).toBe(false);
      expect(res.sale.number).toMatch(/^R-\d{6}$/);
      expect(res.sale.totalMinor).toBe(String(750 + 167));
      expect(res.sale.lines.map((l: { lineTotalMinor: string }) => l.lineTotalMinor)).toEqual(['750', '167']);
      expect(res.sale.amounts).toMatchObject({ paymentStatus: 'UNPAID', outstandingMinor: '917' });
      // Client-supplied prices are not accepted at all.
      await sell(org.owner, [{ productId: soda.id, quantity: '1', unitPriceMinor: '1' } as never]).expect(400);
      expect((await sell(org.owner, [{ productId: soda.id, quantity: '1.5' }])).body.code).toBe('invalid_quantity_precision');
      await sell(org.owner, [{ productId: soda.id, quantity: '1' }, { productId: soda.id, quantity: '1' }]).expect(400);
      expect(await stockOf(soda.id)).toBe('17.000');
      expect(await stockOf(rice.id)).toBe('9.500');
    });

    it('refuses unpriced, inactive and foreign products, and missing idempotency keys', async () => {
      const unpriced = await product({ sellingPriceMinor: undefined }, '5');
      expect((await sell(org.owner, [{ productId: unpriced.id, quantity: '1' }])).body.code).toBe('no_selling_price');
      const inactive = await product({}, undefined);
      await owner().patch(`/products/${inactive.id}`, { version: inactive.version, status: 'INACTIVE' }).expect(200);
      await sell(org.owner, [{ productId: inactive.id, quantity: '1' }]).expect(404);
      const foreign = (await http(app).post(`/v1/orgs/${other.id}/products`).set(bearer(other.owner)).send({ sku: 'FOREIGN', name: 'Foreign', sellingPriceMinor: '1' }).expect(201)).body;
      await sell(org.owner, [{ productId: foreign.id, quantity: '1' }]).expect(404);
      await owner().post(`/branches/${org.mainBranchId}/sales`, { lines: [{ productId: unpriced.id, quantity: '1' }] }).expect(400);
    });

    it('insufficient stock rolls the whole sale back: no sale, no lines, no movements', async () => {
      const a = await product({}, '5');
      const b = await product({}, '1');
      const before = (await owner().get('/sales?limit=200').expect(200)).body.items.length;
      const res = await sell(org.owner, [{ productId: a.id, quantity: '2' }, { productId: b.id, quantity: '2' }]);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('insufficient_stock');
      expect(await stockOf(a.id)).toBe('5.000');
      expect((await owner().get('/sales?limit=200').expect(200)).body.items.length).toBe(before);
      const moves = await sql(ctx(), (c) => c.query("SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1 AND type = 'SALE'", [a.id]));
      expect(moves.rows[0].n).toBe(0);
    });

    it('never oversells under concurrency, and receipt numbers stay unique', async () => {
      const p = await product({}, '5');
      const race = await Promise.all(Array.from({ length: 9 }, (_, i) => sell(i % 2 ? cashier : org.owner, [{ productId: p.id, quantity: '1' }])));
      const ok = race.filter((r) => r.status === 201);
      expect(ok).toHaveLength(5);
      expect(race.filter((r) => r.status === 409).every((r) => r.body.code === 'insufficient_stock')).toBe(true);
      expect(await stockOf(p.id)).toBe('0.000');
      const numbers = ok.map((r) => r.body.sale.number);
      expect(new Set(numbers).size).toBe(5);
      const all = await sql(ctx(), (c) => c.query('SELECT number FROM sales'));
      expect(new Set(all.rows.map((r) => r.number)).size).toBe(all.rows.length);
    });

    it('an idempotency key posts once, also when the same request races; reuse with another body is refused', async () => {
      const p = await product({}, '10');
      const k = key('same');
      const race = await Promise.all(Array.from({ length: 5 }, () => sell(org.owner, [{ productId: p.id, quantity: '2' }], k)));
      expect(race.every((r) => r.status === 201)).toBe(true);
      expect(new Set(race.map((r) => r.body.sale.id)).size).toBe(1);
      expect(race.filter((r) => r.body.replayed === false)).toHaveLength(1);
      expect(await stockOf(p.id)).toBe('8.000');
      expect((await sell(org.owner, [{ productId: p.id, quantity: '3' }], k)).body.code).toBe('idempotency_key_reused');
    });

    it('each line is linked to its SALE movement and the ledger still reconciles', async () => {
      const p = await product({}, '4');
      const sale = (await sell(org.owner, [{ productId: p.id, quantity: '3' }]).expect(201)).body.sale;
      const m = await sql(ctx(), (c) => c.query('SELECT type::text, quantity_delta::text, source_type, source_id, balance_after::text FROM stock_movements WHERE id = $1', [sale.lines[0].movementId]));
      expect(m.rows[0]).toEqual({ type: 'SALE', quantity_delta: '-3.000', source_type: 'SALE', source_id: sale.id, balance_after: '1.000' });
      const rec = (await owner().get(`/branches/${org.mainBranchId}/stock/reconciliation`).expect(200)).body;
      expect(rec.consistent).toBe(true);
      // A line cannot be attached to a movement after the fact, nor point at a foreign movement.
      await expect(sql(ctx(), (c) => c.query(
        `INSERT INTO sale_lines (organization_id, sale_id, line_no, product_id, quantity, unit_price_minor, line_total_minor, movement_id)
         VALUES ($1, $2, 9, $3, 1, 250, 250, $4)`, [org.id, sale.id, p.id, sale.lines[0].movementId]))).rejects.toThrow();
    });

    it('the database refuses a sale whose total does not match its lines', async () => {
      const session = (await sql(ctx(), (c) => c.query("SELECT id FROM cashier_sessions WHERE cashier_user_id = $1 AND branch_id = $2 AND status = 'OPEN'", [org.owner.userId, org.mainBranchId]))).rows[0];
      await expect(sql(ctx(), async (c) => {
        await c.query(
          `INSERT INTO sales (organization_id, branch_id, session_id, number, idempotency_key, currency, total_minor, cashier_user_id)
           VALUES ($1, $2, $3, 'R-999999', 'sql-total-1', 'USD', 1000, $4)`, [org.id, org.mainBranchId, session.id, org.owner.userId]);
        await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      })).rejects.toThrow();
    });

    it('lists with pagination and branch scope; another branch\'s sales are invisible to branch staff', async () => {
      const p = await product({}, '5', second);
      const there = (await sell(org.owner, [{ productId: p.id, quantity: '1' }], key('s2'), {}, second).expect(201)).body.sale;
      await sell(cashier, [{ productId: p.id, quantity: '1' }], key('s2'), {}, second).expect(403);
      const mine = (await as(cashier).get('/sales?limit=200').expect(200)).body.items;
      expect(mine.every((s: { branchId: string }) => s.branchId === org.mainBranchId)).toBe(true);
      await as(cashier).get(`/sales/${there.id}`).expect(404);
      expect((await as(cashier).get(`/sales?branchId=${second}`).expect(200)).body.items).toEqual([]);
      const p1 = (await owner().get('/sales?limit=3').expect(200)).body;
      const p2 = (await owner().get(`/sales?limit=3&cursor=${encodeURIComponent(p1.nextCursor)}`).expect(200)).body;
      expect(p2.items.map((s: { id: string }) => s.id).filter((id: string) => p1.items.some((x: { id: string }) => x.id === id))).toEqual([]);
      await http(app).get(`/v1/orgs/${other.id}/sales/${there.id}`).set(bearer(other.owner)).expect(404);
    });

    it('voids only with explicit authorization, nothing paid, and restores stock through the ledger', async () => {
      const p = await product({ sellingPriceMinor: '100' }, '5');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '2' }]).expect(201)).body.sale;
      await as(cashier).post(`/sales/${sale.id}/void`, { version: sale.version, reason: 'wrong item' }).expect(403);
      const paid = (await pay(cashier, sale.id, 'CASH', '200').expect(201)).body.payment;
      expect((await as(manager).post(`/sales/${sale.id}/void`, { version: sale.version, reason: 'wrong item' })).body.code).toBe('payments_outstanding');
      await as(manager).post(`/payments/${paid.id}/refunds`, { amountMinor: '200', reason: 'void' }, key('r')).expect(201);
      const voided = (await as(manager).post(`/sales/${sale.id}/void`, { version: sale.version, reason: 'wrong item' }).expect(200)).body;
      expect(voided).toMatchObject({ status: 'VOIDED', voidedByUserId: manager.userId, voidReason: 'wrong item' });
      expect(await stockOf(p.id)).toBe('5.000');
      expect((await as(manager).post(`/sales/${sale.id}/void`, { version: voided.version, reason: 'again' })).body.code).toBe('sale_voided');
      expect((await pay(cashier, sale.id, 'CASH', '1')).body.code).toBe('sale_voided');
      const m = await sql(ctx(), (c) => c.query("SELECT quantity_delta::text FROM stock_movements WHERE source_id = $1 AND type = 'SALE_VOID'", [sale.id]));
      expect(m.rows).toEqual([{ quantity_delta: '2.000' }]);
      expect((await auditOf('sales.sale.voided')).some((e: { resourceId: string }) => e.resourceId === sale.id)).toBe(true);
      // Posted history is never deleted or rewritten.
      await expect(sql(ctx(), (c) => c.query('DELETE FROM sales WHERE id = $1', [sale.id]))).rejects.toThrow(/permission denied/);
      await expect(sql(ctx(), (c) => c.query("UPDATE sales SET status = 'COMPLETED' WHERE id = $1", [sale.id]))).rejects.toThrow();
      await expect(sql(ctx(), (c) => c.query('UPDATE sales SET total_minor = 1 WHERE id = $1', [sale.id]))).rejects.toThrow();
      await expect(sql(ctx(), (c) => c.query('UPDATE sale_lines SET quantity = 1 WHERE sale_id = $1', [sale.id]))).rejects.toThrow();
    });

    it('archived branches accept no sessions or sales; an open session can still be closed', async () => {
      const br = (await owner().post('/branches', { name: 'Closing', code: key('CL').toUpperCase().slice(0, 20) }).expect(201)).body;
      const s = (await owner().post(`/branches/${br.id}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201)).body;
      await owner().post(`/branches/${br.id}/archive`, { version: br.version }).expect(200);
      const p = await product({}, undefined);
      expect((await sell(org.owner, [{ productId: p.id, quantity: '1' }], key('a'), {}, br.id)).body.code).toBe('branch_archived');
      await owner().post(`/cashier-sessions/${s.id}/close`, { version: s.version, declaredCashMinor: '0' }).expect(200);
      expect((await owner().post(`/branches/${br.id}/cashier-sessions`, { openingFloatMinor: '0' })).body.code).toBe('branch_archived');
    });
  });

  // ---------------------------------------------------------------- payments and refunds

  describe('payments and refunds', () => {
    it('records manual payments: cash confirmed, others pending until attested; never more than the total', async () => {
      const p = await product({ sellingPriceMinor: '1000' }, '5');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      expect((await pay(cashier, sale.id, 'BANK_TRANSFER', '1001')).body.code).toBe('overpayment');
      const transfer = (await pay(cashier, sale.id, 'BANK_TRANSFER', '600', key('p'), { reference: 'TRF-77' }).expect(201)).body.payment;
      expect(transfer).toMatchObject({ status: 'PENDING', verification: 'MANUAL', sessionId: null });
      expect((await pay(cashier, sale.id, 'CASH', '401')).body.code).toBe('overpayment');
      await as(cashier).post(`/payments/${transfer.id}/fail`, { version: transfer.version, reason: 'never arrived' }).expect(200);
      expect((await as(cashier).post(`/payments/${transfer.id}/confirm`, { version: transfer.version + 1 })).body.code).toBe('payment_not_pending');
      // A failed payment frees its amount.
      const card = (await pay(cashier, sale.id, 'CARD_EXTERNAL', '1000', key('p'), { reference: 'AUTH 553201' }).expect(201)).body.payment;
      expect((await as(cashier).post(`/payments/${card.id}/confirm`, { version: card.version + 3 })).body.code).toBe('version_conflict');
      const confirmed = (await as(cashier).post(`/payments/${card.id}/confirm`, { version: card.version }).expect(200)).body;
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', confirmedByUserId: cashier.userId });
      const view = (await as(cashier).get(`/sales/${sale.id}`).expect(200)).body;
      expect(view.amounts).toMatchObject({ confirmedMinor: '1000', pendingMinor: '0', outstandingMinor: '0', paymentStatus: 'PAID' });
      expect((await auditOf('sales.payment.failed')).length).toBeGreaterThan(0);
    });

    it('refuses card data and secrets in any form', async () => {
      const p = await product({}, '5');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      expect((await pay(cashier, sale.id, 'CARD_EXTERNAL', '100', key('p'), { reference: '4111 1111 1111 1111' })).body.code).toBe('card_data_refused');
      await pay(cashier, sale.id, 'CARD_EXTERNAL', '100', key('p'), { cardNumber: '4111111111111111', cvv: '123' }).expect(400);
      // The database refuses card-like references and anything but manual verification too.
      await expect(sql(ctx(), (c) => c.query(
        `INSERT INTO payments (organization_id, sale_id, branch_id, method, status, amount_minor, reference, idempotency_key, recorded_by_user_id)
         VALUES ($1, $2, $3, 'CARD_EXTERNAL', 'PENDING', 1, '4111111111111111', 'sql-card-1', $4)`, [org.id, sale.id, org.mainBranchId, org.owner.userId]))).rejects.toThrow(/payments_/);
      await expect(sql(ctx(), (c) => c.query(
        `INSERT INTO payments (organization_id, sale_id, branch_id, method, status, amount_minor, verification, idempotency_key, recorded_by_user_id)
         VALUES ($1, $2, $3, 'CARD_EXTERNAL', 'PENDING', 1, 'GATEWAY', 'sql-card-2', $4)`, [org.id, sale.id, org.mainBranchId, org.owner.userId]))).rejects.toThrow(/payments_/);
    });

    it('concurrent payments never exceed the total; a replayed key records once', async () => {
      const p = await product({ sellingPriceMinor: '1000' }, '5');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      const race = await Promise.all(Array.from({ length: 5 }, () => pay(cashier, sale.id, 'MOBILE_MONEY', '400')));
      expect(race.filter((r) => r.status === 201)).toHaveLength(2);
      expect(race.filter((r) => r.status === 409).every((r) => r.body.code === 'overpayment')).toBe(true);
      const k = key('dup');
      const dup = await Promise.all(Array.from({ length: 4 }, () => pay(cashier, sale.id, 'MOBILE_MONEY', '200', k)));
      expect(dup.every((r) => r.status === 201)).toBe(true);
      expect(new Set(dup.map((r) => r.body.payment.id)).size).toBe(1);
      expect((await pay(cashier, sale.id, 'MOBILE_MONEY', '100', k)).body.code).toBe('idempotency_key_reused');
      const sum = await sql(ctx(), (c) => c.query("SELECT sum(amount_minor)::text AS s FROM payments WHERE sale_id = $1 AND status <> 'FAILED'", [sale.id]));
      expect(sum.rows[0].s).toBe('1000');
    });

    it('partial and full refunds: authorized, reasoned, audited, cumulative ≤ captured (also concurrently), no restock', async () => {
      const p = await product({ sellingPriceMinor: '1000' }, '5');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      const pending = (await pay(cashier, sale.id, 'CARD_EXTERNAL', '1000', key('p'), { reference: 'T-1' }).expect(201)).body.payment;
      expect((await as(manager).post(`/payments/${pending.id}/refunds`, { amountMinor: '1', reason: 'too early' }, key('r'))).body.code).toBe('payment_not_confirmed');
      await as(cashier).post(`/payments/${pending.id}/confirm`, { version: pending.version }).expect(200);
      await as(manager).post(`/payments/${pending.id}/refunds`, { amountMinor: '1', reason: 'x' }, key('r')).expect(400);
      await as(manager).post(`/payments/${pending.id}/refunds`, { amountMinor: '1', reason: 'no key' }).expect(400);
      const race = await Promise.all(Array.from({ length: 5 }, () => as(manager).post(`/payments/${pending.id}/refunds`, { amountMinor: '300', reason: 'goodwill' }, key('r'))));
      expect(race.filter((r) => r.status === 201)).toHaveLength(3);
      expect(race.filter((r) => r.status === 409).every((r) => r.body.code === 'refund_exceeds_payment')).toBe(true);
      expect((await as(manager).post(`/payments/${pending.id}/refunds`, { amountMinor: '101', reason: 'too much' }, key('r'))).body.code).toBe('refund_exceeds_payment');
      await as(manager).post(`/payments/${pending.id}/refunds`, { amountMinor: '100', reason: 'rest' }, key('r')).expect(201);
      const view = (await as(manager).get(`/sales/${sale.id}`).expect(200)).body;
      expect(view.amounts).toMatchObject({ refundedMinor: '1000', refundStatus: 'FULL' });
      expect(view.payments[0].refundedMinor).toBe('1000');
      expect(await stockOf(p.id)).toBe('4.000');
      const audit = (await auditOf('sales.payment.refunded')).filter((e: { metadata: { paymentId: string } }) => e.metadata.paymentId === pending.id);
      expect(audit).toHaveLength(4);
      expect(audit.every((e: { metadata: { reason: string }; actorUserId: string }) => e.metadata.reason && e.actorUserId === manager.userId)).toBe(true);
      // Refunds are append-only; a payment's refunded total never shrinks.
      await expect(sql(ctx(), (c) => c.query('DELETE FROM refunds WHERE payment_id = $1', [pending.id]))).rejects.toThrow(/permission denied/);
      await expect(sql(ctx(), (c) => c.query('UPDATE payments SET refunded_minor = 0 WHERE id = $1', [pending.id]))).rejects.toThrow();
      await expect(sql(ctx(), (c) => c.query('UPDATE payments SET amount_minor = 5000 WHERE id = $1', [pending.id]))).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------- returns and exchanges

  describe('returns', () => {
    it('validates returnable quantities (also concurrently) and does not touch stock on acceptance', async () => {
      const p = await product({ sellingPriceMinor: '100' }, '10');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '3' }]).expect(201)).body.sale;
      const line = sale.lines[0].id;
      const ret = (await as(cashier).post(`/sales/${sale.id}/returns`, { reason: 'changed mind', lines: [{ saleLineId: line, quantity: '2', disposition: 'RESALEABLE' }] }, key('ret')).expect(201)).body.return;
      expect(ret).toMatchObject({ status: 'ACCEPTED', lines: [{ quantity: '2.000', disposition: 'RESALEABLE' }] });
      expect(await stockOf(p.id)).toBe('7.000');
      expect((await as(cashier).post(`/sales/${sale.id}/returns`, { reason: 'more', lines: [{ saleLineId: line, quantity: '2', disposition: 'RESALEABLE' }] }, key('ret'))).body.code).toBe('exceeds_returnable');
      const race = await Promise.all(Array.from({ length: 4 }, () => as(cashier).post(`/sales/${sale.id}/returns`, { reason: 'race', lines: [{ saleLineId: line, quantity: '1', disposition: 'DAMAGED' }] }, key('ret'))));
      expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect((await as(cashier).get(`/sales/${sale.id}`).expect(200)).body.lines[0].quantityReturned).toBe('3.000');
      // A sale with returns cannot be voided; a foreign sale line cannot be returned against.
      expect((await as(manager).post(`/sales/${sale.id}/void`, { version: sale.version, reason: 'try' })).body.code).toBe('sale_has_returns');
      const sale2 = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      await as(cashier).post(`/sales/${sale2.id}/returns`, { reason: 'wrong line', lines: [{ saleLineId: line, quantity: '1', disposition: 'RESALEABLE' }] }, key('ret')).expect(404);
      // Replaying a return key returns the same return.
      const k = key('ret');
      const dup = await Promise.all(Array.from({ length: 3 }, () => as(cashier).post(`/sales/${sale2.id}/returns`, { reason: 'dup', lines: [{ saleLineId: sale2.lines[0].id, quantity: '1', disposition: 'UNSELLABLE' }] }, k)));
      expect(dup.every((r) => r.status === 201)).toBe(true);
      expect(new Set(dup.map((r) => r.body.return.id)).size).toBe(1);
    });

    it('restocks only resaleable goods, through the ledger, once, with a separate permission', async () => {
      const p = await product({ sellingPriceMinor: '100' }, '10');
      const sale = (await sell(cashier, [{ productId: p.id, quantity: '4' }]).expect(201)).body.sale;
      const ret = (await as(cashier).post(`/sales/${sale.id}/returns`, {
        reason: 'one broken', lines: [{ saleLineId: sale.lines[0].id, quantity: '3', disposition: 'RESALEABLE' }],
      }, key('ret')).expect(201)).body.return;
      const damaged = (await as(cashier).post(`/sales/${sale.id}/returns`, {
        reason: 'broken', lines: [{ saleLineId: sale.lines[0].id, quantity: '1', disposition: 'DAMAGED' }],
      }, key('ret')).expect(201)).body.return;
      await as(cashier).post(`/returns/${ret.id}/restock`).expect(403);
      const race = await Promise.all(Array.from({ length: 3 }, () => as(manager).post(`/returns/${ret.id}/restock`)));
      expect(race.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(race.filter((r) => r.status === 409).every((r) => r.body.code === 'already_restocked')).toBe(true);
      expect(await stockOf(p.id)).toBe('9.000');
      expect((await as(manager).post(`/returns/${damaged.id}/restock`)).body.code).toBe('nothing_to_restock');
      expect(await stockOf(p.id)).toBe('9.000');
      const m = await sql(ctx(), (c) => c.query("SELECT quantity_delta::text, source_type FROM stock_movements WHERE source_id = $1", [ret.id]));
      expect(m.rows).toEqual([{ quantity_delta: '3.000', source_type: 'SALE_RETURN' }]);
      expect((await owner().get(`/branches/${org.mainBranchId}/stock/reconciliation`).expect(200)).body.consistent).toBe(true);
      // Return lines are append-only; a restocked return is final.
      await expect(sql(ctx(), (c) => c.query('UPDATE sale_return_lines SET quantity = 9 WHERE return_id = $1', [ret.id]))).rejects.toThrow(/permission denied/);
      await expect(sql(ctx(), (c) => c.query("UPDATE sale_returns SET status = 'ACCEPTED' WHERE id = $1", [ret.id]))).rejects.toThrow();
      // Returns can be refunded against the same sale only.
      const payment = (await pay(cashier, sale.id, 'CASH', '400').expect(201)).body.payment;
      const other = (await sell(cashier, [{ productId: p.id, quantity: '1' }]).expect(201)).body.sale;
      const otherRet = (await as(cashier).post(`/sales/${other.id}/returns`, { reason: 'other sale', lines: [{ saleLineId: other.lines[0].id, quantity: '1', disposition: 'RESALEABLE' }] }, key('ret')).expect(201)).body.return;
      await as(manager).post(`/payments/${payment.id}/refunds`, { amountMinor: '300', reason: 'returned', returnId: otherRet.id }, key('r')).expect(404);
      const refund = (await as(manager).post(`/payments/${payment.id}/refunds`, { amountMinor: '300', reason: 'returned', returnId: ret.id }, key('r')).expect(201)).body.refund;
      expect(refund.returnId).toBe(ret.id);
      expect((await auditOf('sales.return.restocked')).some((e: { resourceId: string }) => e.resourceId === ret.id)).toBe(true);
    });

    it('an exchange is a return plus a separate new sale; the original sale is unchanged', async () => {
      const small = await product({ sellingPriceMinor: '100' }, '5');
      const large = await product({ sellingPriceMinor: '150' }, '5');
      const sale = (await sell(cashier, [{ productId: small.id, quantity: '1' }]).expect(201)).body.sale;
      const ret = (await as(cashier).post(`/sales/${sale.id}/returns`, { reason: 'size swap', lines: [{ saleLineId: sale.lines[0].id, quantity: '1', disposition: 'RESALEABLE' }] }, key('ret')).expect(201)).body.return;
      const exchange = (await sell(cashier, [{ productId: large.id, quantity: '1' }], key('ex'), { relatedReturnId: ret.id }).expect(201)).body.sale;
      expect(exchange).toMatchObject({ relatedReturnId: ret.id, totalMinor: '150' });
      const original = (await as(cashier).get(`/sales/${sale.id}`).expect(200)).body;
      expect(original).toMatchObject({ totalMinor: '100', status: 'COMPLETED', version: sale.version });
      expect(original.returns.map((r: { id: string }) => r.id)).toEqual([ret.id]);
    });
  });

  // ---------------------------------------------------------------- access control, RLS, reports

  describe('access control', () => {
    it('suspended memberships, revoked permissions and disabled users are refused', async () => {
      const p = await product({}, '5');
      const temp = await addMember(app, org, 'pos-suspend', 'Cashier', org.mainBranchId);
      await as(temp).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201);
      await sell(temp, [{ productId: p.id, quantity: '1' }]).expect(201);
      const override = (await owner().post(`/members/${temp.membershipId}/overrides`, { permissionKey: 'sales.sale.create', effect: 'DENY', reason: 'revoked' }).expect(201)).body;
      await sell(temp, [{ productId: p.id, quantity: '1' }]).expect(403);
      await http(app).delete(`/v1/orgs/${org.id}/members/${temp.membershipId}/overrides/${override.id}`).set(bearer(org.owner)).expect((r) => expect([200, 204]).toContain(r.status));
      await sell(temp, [{ productId: p.id, quantity: '1' }]).expect(201);
      await owner().patch(`/members/${temp.membershipId}`, { status: 'SUSPENDED' }).expect(200);
      const res = await sell(temp, [{ productId: p.id, quantity: '1' }]);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(p.id);
      await as(temp).get('/sales').expect(403);

      const gone = await addMember(app, org, 'pos-disabled', 'Cashier', org.mainBranchId);
      const pool = pools.migrator();
      try {
        await pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [gone.userId]);
      } finally {
        await pool.end();
      }
      await as(gone).get('/sales').expect(401);
    });

    it('the accountant reads sales and reports but cannot sell, take payments or refund', async () => {
      await as(accountant).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(403);
      const sales = (await as(accountant).get('/sales?limit=1').expect(200)).body.items;
      await pay(accountant, sales[0].id, 'CASH', '1').expect(403);
      await as(accountant).post(`/sales/${sales[0].id}/void`, { version: 1, reason: 'not mine' }).expect(403);
      const inventoryOnly = await addMember(app, org, 'pos-keeper', 'Storekeeper', org.mainBranchId);
      await as(inventoryOnly).get('/sales').expect(403);
      await as(inventoryOnly).get(`/sales/${sales[0].id}`).expect(404);
      const report = (await as(accountant).get('/sales/report').expect(200)).body;
      expect(report.sales.length).toBeGreaterThan(0);
      expect(report.note).toMatch(/not .*verified|none is verified/);
      await as(cashier).get('/sales/report').expect(403);
    });

    it('RLS: another organization\'s context sees none of the sales tables\' rows', async () => {
      const tables = ['customers', 'cashier_sessions', 'sales', 'sale_lines', 'payments', 'refunds', 'sale_returns', 'sale_return_lines'];
      const mine = await sql(ctx(), async (c) => Promise.all(tables.map(async (t) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n)));
      expect(mine.every((x) => x > 0)).toBe(true);
      const theirs = await sql({ 'app.org_id': other.id, 'app.user_id': other.owner.userId }, async (c) =>
        Promise.all(tables.map(async (t) => (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [org.id])).rows[0].n)));
      expect(theirs).toEqual(tables.map(() => 0));
      // No context: nothing.
      const none = await sql({}, async (c) => (await c.query('SELECT count(*)::int AS n FROM sales')).rows[0].n);
      expect(none).toBe(0);
      // Cannot write into another organization.
      await expect(sql({ 'app.org_id': other.id, 'app.user_id': other.owner.userId }, (c) =>
        c.query("INSERT INTO customers (organization_id, name, created_by_user_id) VALUES ($1, 'x', $2)", [org.id, other.owner.userId]))).rejects.toThrow(/row-level security/);
      // The runtime role still cannot write stock balances.
      await expect(sql(ctx(), (c) => c.query('UPDATE stock_balances SET quantity = 999'))).rejects.toThrow(/permission denied/);
    });

    it('privileged actions are audited with the actor', async () => {
      for (const a of ['sales.sale.posted', 'sales.sale.voided', 'sales.payment.recorded', 'sales.payment.confirmed', 'sales.payment.refunded',
        'sales.return.accepted', 'sales.return.restocked', 'sales.session.opened', 'sales.session.closed', 'sales.customer.updated']) {
        const rows = await auditOf(a);
        expect({ action: a, present: rows.length > 0, actors: rows.every((e: { actorUserId: string }) => !!e.actorUserId) }).toEqual({ action: a, present: true, actors: true });
      }
    });
  });
});

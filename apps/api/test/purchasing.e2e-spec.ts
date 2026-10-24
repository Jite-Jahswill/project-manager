/**
 * Phase 4: suppliers and purchase orders: lifecycle, separation of duties, branch scope,
 * receipts (partial, complete, duplicate, concurrent, over-receipt, atomic), returns and
 * receipt corrections, cost visibility, database-level integrity and audit.
 * Real PostgreSQL and Redis.
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, roleId, setPlan, signUp, TestOrg, TestUser } from './support/harness';

jest.setTimeout(180_000);

type Member = TestUser & { membershipId: string };

describe('Purchasing (phase 4)', () => {
  let app: INestApplication;
  let org: TestOrg;
  let other: TestOrg;
  let second: string;
  let buyer: Member; // Inventory manager: create, submit, receive; no approval
  let approver: Member; // Branch manager at main: approve at main only
  let keeper: Member; // Storekeeper at main: receive, read; no costs
  let accountant: Member; // costs and reports, no ordering
  let cashier: Member; // nothing in purchasing
  let supplier: { id: string; version: number };
  let sugar: { id: string };
  let bolts: { id: string };
  let n = 0;

  const as = (u: { token: string }) => ({
    get: (p: string) => http(app).get(`/v1/orgs/${org.id}${p}`).set(bearer(u)),
    post: (p: string, body: object = {}, key?: string) => {
      const r = http(app).post(`/v1/orgs/${org.id}${p}`).set(bearer(u));
      return (key ? r.set('Idempotency-Key', key) : r).send(body);
    },
    patch: (p: string, body: object) => http(app).patch(`/v1/orgs/${org.id}${p}`).set(bearer(u)).send(body),
    put: (p: string, body: object) => http(app).put(`/v1/orgs/${org.id}${p}`).set(bearer(u)).send(body),
  });
  const owner = () => as(org.owner);
  const key = (label: string) => `${label}-${Date.now()}-${++n}`;

  async function stockOf(productId: string, branchId = org.mainBranchId): Promise<string> {
    const r = await owner().get(`/branches/${branchId}/stock?limit=200`).expect(200);
    return r.body.items.find((b: { product: { id: string } }) => b.product.id === productId)?.quantity ?? '0.000';
  }
  async function sql<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [org.id, org.owner.userId]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
      await pool.end();
    }
  }

  /** A draft by the buyer at the main branch: 2.5 kg sugar at 1999 + 10 bolts at 15. */
  async function draft(branchId = org.mainBranchId, by: Member = buyer) {
    return (await as(by).post(`/branches/${branchId}/purchase-orders`, {
      supplierId: supplier.id, notes: 'weekly order', lines: [{ productId: sugar.id, quantity: '2.5', unitCostMinor: '1999' }, { productId: bolts.id, quantity: '10', unitCostMinor: '15' }],
    }).expect(201)).body;
  }
  /** Draft -> submitted (buyer) -> approved (approver) -> issued (buyer). */
  async function issued() {
    let po = await draft();
    po = (await as(buyer).post(`/purchase-orders/${po.id}/submit`, { version: po.version }).expect(200)).body;
    po = (await as(approver).post(`/purchase-orders/${po.id}/approve`, { version: po.version }).expect(200)).body;
    return (await as(buyer).post(`/purchase-orders/${po.id}/issue`, { version: po.version }).expect(200)).body;
  }
  const lineOf = (po: { lines: { id: string; product: { id: string } }[] }, productId: string) => po.lines.find((l) => l.product.id === productId)!.id;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'pur-owner'), 'pur');
    other = await createOrg(app, await signUp(app, 'pur-other'), 'pur-other');
    await setPlan(org.id, 'growth');
    second = (await owner().post('/branches', { name: 'Second', code: 'SECOND' }).expect(201)).body.id;
    buyer = await addMember(app, org, 'pur-buyer', 'Inventory manager');
    approver = await addMember(app, org, 'pur-approver', 'Branch manager', org.mainBranchId);
    keeper = await addMember(app, org, 'pur-keeper', 'Storekeeper', org.mainBranchId);
    accountant = await addMember(app, org, 'pur-accountant', 'Accountant');
    cashier = await addMember(app, org, 'pur-cashier', 'Cashier', org.mainBranchId);
    supplier = (await owner().post('/suppliers', { code: 'ACME', name: 'Acme Trading Ltd', email: 'Orders@Acme.example', paymentTermsDays: 30 }).expect(201)).body;
    sugar = (await owner().post('/products', { sku: 'SUGAR', name: 'Sugar', unit: 'kg' }).expect(201)).body;
    bolts = (await owner().post('/products', { sku: 'BOLT', name: 'Bolt', unit: 'each' }).expect(201)).body;
  });
  afterAll(() => app.close());

  describe('suppliers', () => {
    it('are unique by code and normalized name, versioned, isolated per organization, and minimal in personal data', async () => {
      expect(supplier).toMatchObject({ code: 'ACME', name: 'Acme Trading Ltd', email: 'orders@acme.example', currency: 'USD', status: 'ACTIVE', version: 1 });
      expect((await owner().post('/suppliers', { code: 'ACME', name: 'Other' })).body.code).toBe('supplier_code_taken');
      expect((await owner().post('/suppliers', { code: 'ACME2', name: '  acme   TRADING ltd ' })).body.code).toBe('supplier_name_taken');
      await owner().post('/suppliers', { code: 'X1', name: 'x', dateOfBirth: '1990-01-01' }).expect(400);
      const s = (await owner().post('/suppliers', { code: 'BETA', name: 'Beta Supplies' }).expect(201)).body;
      const edited = (await owner().patch(`/suppliers/${s.id}`, { version: 1, phone: '+234 800 000 0000' }).expect(200)).body;
      expect(edited.version).toBe(2);
      expect((await owner().patch(`/suppliers/${s.id}`, { version: 1, notes: 'stale' })).body.code).toBe('version_conflict');
      expect((await owner().get('/suppliers?q=acme').expect(200)).body.items.map((x: { code: string }) => x.code)).toEqual(['ACME']);
      expect((await owner().get('/suppliers?q=%25').expect(200)).body.items).toEqual([]);
      await http(app).get(`/v1/orgs/${other.id}/suppliers/${s.id}`).set(bearer(other.owner)).expect(404);
      await as(cashier).post('/suppliers', { code: 'C1', name: 'Cashier supplier' }).expect(403);
    });

    it('supplier products hide default costs without inventory.cost.read; purchase history needs purchasing.report.read', async () => {
      await owner().put(`/suppliers/${supplier.id}/products/${sugar.id}`, { supplierSku: 'ACM-SUG', defaultUnitCostMinor: '1999', leadTimeDays: 3 }).expect(200);
      expect((await owner().get(`/suppliers/${supplier.id}/products`)).body.items[0]).toMatchObject({ supplierSku: 'ACM-SUG', defaultUnitCostMinor: '1999' });
      // The branch manager reads suppliers but has no cost access; the storekeeper cannot read suppliers at all.
      expect((await as(approver).get(`/suppliers/${supplier.id}/products`).expect(200)).body.items[0]).not.toHaveProperty('defaultUnitCostMinor');
      await as(keeper).get(`/suppliers/${supplier.id}/products`).expect(403);
      await as(keeper).get(`/suppliers/${supplier.id}/summary`).expect(403);
      await as(accountant).get(`/suppliers/${supplier.id}/summary`).expect(200);
    });
  });

  describe('purchase orders', () => {
    it('computes totals on the server, refuses client totals and unknown fields, and validates unit precision', async () => {
      const po = await draft();
      expect(po).toMatchObject({ status: 'DRAFT', number: expect.stringMatching(/^PO-\d{6}$/), currency: 'USD', version: 1, subtotalMinor: '5148' });
      expect(po.lines.map((l: { lineTotalMinor: string }) => l.lineTotalMinor)).toEqual(['4998', '150']); // 2.5 × 1999 = 4997.5 -> 4998
      await as(buyer).post(`/branches/${org.mainBranchId}/purchase-orders`, { supplierId: supplier.id, subtotalMinor: '1', lines: [{ productId: bolts.id, quantity: '1', unitCostMinor: '1' }] }).expect(400);
      await as(buyer).post(`/branches/${org.mainBranchId}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: bolts.id, quantity: '1', unitCostMinor: '1', lineTotalMinor: '999' }] }).expect(400);
      expect((await as(buyer).post(`/branches/${org.mainBranchId}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: bolts.id, quantity: '1.5', unitCostMinor: '1' }] })).body.code).toBe('invalid_quantity_precision');
      // Editing replaces the lines and recomputes the subtotal; the version moves on.
      const edited = (await as(buyer).patch(`/purchase-orders/${po.id}`, { version: 1, lines: [{ productId: bolts.id, quantity: '3', unitCostMinor: '33' }] }).expect(200)).body;
      expect(edited).toMatchObject({ subtotalMinor: '99', version: 2 });
      expect((await as(buyer).patch(`/purchase-orders/${po.id}`, { version: 1, notes: 'stale' })).body.code).toBe('version_conflict');
      // The database refuses a wrong line total and keeps the subtotal equal to the lines.
      await expect(sql((c) => c.query('UPDATE purchase_order_lines SET line_total_minor = 1 WHERE purchase_order_id = $1', [po.id]))).rejects.toThrow(/purchase_order_lines_total/);
    });

    it('runs the full lifecycle with events and audit: submit, approve, issue, partial and complete receipt', async () => {
      const before = { sugar: await stockOf(sugar.id), bolts: await stockOf(bolts.id) };
      const po = await issued();
      expect(po).toMatchObject({ status: 'ISSUED', submittedByUserId: buyer.userId, decidedByUserId: approver.userId, selfApproved: false });
      const r1 = (await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: lineOf(po, sugar.id), quantity: '1.250' }] }, key('rc')).expect(201)).body;
      expect(r1.order.status).toBe('PARTIALLY_RECEIVED');
      expect(r1.order).not.toHaveProperty('subtotalMinor'); // the keeper cannot see costs
      expect(r1.order.lines[0]).not.toHaveProperty('unitCostMinor');
      const r2 = (await as(keeper).post(`/purchase-orders/${po.id}/receipts`, {
        lines: [{ lineId: lineOf(po, sugar.id), quantity: '1.25' }, { lineId: lineOf(po, bolts.id), quantity: '10' }],
      }, key('rc')).expect(201)).body;
      expect(r2.order.status).toBe('RECEIVED');
      expect(await stockOf(sugar.id)).toBe((Number(before.sugar) + 2.5).toFixed(3));
      expect(await stockOf(bolts.id)).toBe((Number(before.bolts) + 10).toFixed(3));
      const events = (await as(buyer).get(`/purchase-orders/${po.id}/events`).expect(200)).body.items.map((e: { type: string; toStatus: string | null }) => `${e.type}:${e.toStatus}`);
      expect(events).toEqual(['CREATED:DRAFT', 'SUBMITTED:SUBMITTED', 'APPROVED:APPROVED', 'ISSUED:ISSUED', 'GOODS_RECEIVED:PARTIALLY_RECEIVED', 'GOODS_RECEIVED:RECEIVED']);
      const movements = (await owner().get(`/branches/${org.mainBranchId}/stock/movements?type=RECEIPT`)).body.items;
      expect(movements.filter((m: { sourceType: string }) => m.sourceType === 'GOODS_RECEIPT').length).toBeGreaterThanOrEqual(3);
      const audit = (await owner().get('/audit-events?limit=100')).body.filter((e: { resourceId: string }) => e.resourceId === po.id).map((e: { action: string }) => e.action);
      expect(audit).toEqual(expect.arrayContaining(['purchasing.order.created', 'purchasing.order.submitted', 'purchasing.order.approved', 'purchasing.order.issued']));
      const receipts = (await as(keeper).get(`/purchase-orders/${po.id}/receipts`).expect(200)).body.receipts;
      expect(receipts).toHaveLength(2);
    });

    it('enforces separation of duties; self-approval needs its own permission and is recorded; the database backs it', async () => {
      const own = await draft(org.mainBranchId, approver);
      const submitted = (await as(approver).post(`/purchase-orders/${own.id}/submit`, { version: own.version }).expect(200)).body;
      expect((await as(approver).post(`/purchase-orders/${own.id}/approve`, { version: submitted.version })).body.code).toBe('separation_of_duties');
      // A role with self-approval may approve its own order; the order records it.
      const role = (await owner().post('/roles', { name: `Self approver ${Date.now()}`, permissions: ['purchasing.order.read', 'purchasing.order.create', 'purchasing.order.submit', 'purchasing.order.approve', 'purchasing.order.self_approve'] }).expect(201)).body;
      const solo = await addMember(app, org, 'pur-solo', 'Cashier', org.mainBranchId);
      await owner().put(`/members/${solo.membershipId}/roles`, { assignments: [{ roleId: role.id, branchId: org.mainBranchId }] }).expect(200);
      const mine = await draft(org.mainBranchId, solo);
      const sub = (await as(solo).post(`/purchase-orders/${mine.id}/submit`, { version: mine.version }).expect(200)).body;
      const ok = (await as(solo).post(`/purchase-orders/${mine.id}/approve`, { version: sub.version }).expect(200)).body;
      expect(ok).toMatchObject({ status: 'APPROVED', selfApproved: true, decidedByUserId: solo.userId });
      // Direct SQL cannot approve on behalf of the submitter without the flag.
      const third = await draft();
      const thirdSub = (await as(buyer).post(`/purchase-orders/${third.id}/submit`, { version: third.version }).expect(200)).body;
      await expect(sql((c) => c.query("UPDATE purchase_orders SET status = 'APPROVED', decided_by_user_id = submitted_by_user_id, decided_at = now() WHERE id = $1", [thirdSub.id])))
        .rejects.toThrow(/purchase_orders_approval/);
      // Without approve permission: refused; at a branch where the approver has no access: invisible.
      await as(buyer).post(`/purchase-orders/${third.id}/approve`, { version: thirdSub.version }).expect(403);
      const elsewhere = await draft(second);
      await as(approver).get(`/purchase-orders/${elsewhere.id}`).expect(404);
      await as(approver).post(`/purchase-orders/${elsewhere.id}/approve`, { version: 1 }).expect(404);
      await as(cashier).get(`/purchase-orders/${third.id}`).expect(404);
      expect((await as(cashier).get('/purchase-orders')).body.items).toEqual([]);
      expect((await as(approver).get('/purchase-orders?limit=200')).body.items.every((p: { branchId: string }) => p.branchId === org.mainBranchId)).toBe(true);
    });

    it('rejects invalid transitions and stale versions; rejection returns the order for revision', async () => {
      const po = await draft();
      expect((await as(approver).post(`/purchase-orders/${po.id}/approve`, { version: po.version })).body.code).toBe('invalid_status');
      const sub = (await as(buyer).post(`/purchase-orders/${po.id}/submit`, { version: po.version }).expect(200)).body;
      expect((await as(buyer).patch(`/purchase-orders/${po.id}`, { version: sub.version, notes: 'late edit' })).body.code).toBe('invalid_status');
      expect((await as(approver).post(`/purchase-orders/${po.id}/approve`, { version: po.version })).body.code).toBe('version_conflict');
      const rejected = (await as(approver).post(`/purchase-orders/${po.id}/reject`, { version: sub.version, reason: 'Wrong supplier' }).expect(200)).body;
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'Wrong supplier' });
      const revised = (await as(buyer).patch(`/purchase-orders/${po.id}`, { version: rejected.version, notes: 'fixed' }).expect(200)).body;
      expect(revised).toMatchObject({ status: 'DRAFT', rejectionReason: null });
      expect((await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: lineOf(po, bolts.id), quantity: '1' }] }, key('x'))).body.code).toBe('invalid_status');
      // Lines cannot be changed once submitted, even with direct SQL.
      const sub2 = (await as(buyer).post(`/purchase-orders/${po.id}/submit`, { version: revised.version }).expect(200)).body;
      await expect(sql((c) => c.query('UPDATE purchase_order_lines SET quantity_ordered = 99, line_total_minor = 99 * unit_cost_minor WHERE purchase_order_id = $1', [sub2.id])))
        .rejects.toThrow(/lines change only while the order is a draft/);
    });

    it('receipts never exceed the order, are idempotent (also concurrently) and atomic', async () => {
      const po = await issued();
      const line = lineOf(po, bolts.id);
      expect((await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: line, quantity: '11' }] }, key('or'))).body.code).toBe('over_receipt');
      const start = await stockOf(bolts.id);
      const k = key('dup');
      const same = await Promise.all([1, 2, 3].map(() => as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: line, quantity: '4' }] }, k)));
      expect(same.every((r) => r.status === 201)).toBe(true);
      expect(new Set(same.map((r) => r.body.receiptId)).size).toBe(1);
      expect(await stockOf(bolts.id)).toBe((Number(start) + 4).toFixed(3));
      expect((await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: line, quantity: '5' }] }, k)).body.code).toBe('idempotency_key_reused');
      // Different keys racing for the remaining 6: never more than ordered in total.
      const race = await Promise.all([1, 2].map(() => as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: line, quantity: '6' }] }, key('race'))));
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await stockOf(bolts.id)).toBe((Number(start) + 10).toFixed(3));
      // Atomic: a receipt with one bad line posts nothing at all.
      const po2 = await issued();
      const sugarBefore = await stockOf(sugar.id);
      expect((await as(keeper).post(`/purchase-orders/${po2.id}/receipts`, {
        lines: [{ lineId: lineOf(po2, sugar.id), quantity: '1' }, { lineId: lineOf(po2, bolts.id), quantity: '100' }],
      }, key('atomic'))).body.code).toBe('over_receipt');
      expect(await stockOf(sugar.id)).toBe(sugarBefore);
      expect((await as(keeper).get(`/purchase-orders/${po2.id}/receipts`)).body.receipts).toEqual([]);
      // The database refuses over-receipt directly too.
      await expect(sql((c) => c.query('UPDATE purchase_order_lines SET quantity_received = quantity_ordered + 1 WHERE purchase_order_id = $1', [po2.id])))
        .rejects.toThrow(/purchase_order_lines_quantities/);
      await as(cashier).post(`/purchase-orders/${po2.id}/receipts`, { lines: [{ lineId: lineOf(po2, sugar.id), quantity: '1' }] }, key('c')).expect(404);
    });

    it('returns and receipt corrections post stock out and respect received quantities', async () => {
      const po = await issued();
      const line = lineOf(po, bolts.id);
      await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: line, quantity: '10' }] }, key('r')).expect(201);
      const start = await stockOf(bolts.id);
      const ret = (await as(buyer).post(`/purchase-orders/${po.id}/returns`, { type: 'RETURN', reason: 'Damaged in transit', lines: [{ lineId: line, quantity: '2' }] }, key('ret')).expect(201)).body;
      expect(ret.order.lines.find((l: { id: string }) => l.id === line)).toMatchObject({ quantityReceived: '10.000', quantityReturned: '2.000' });
      expect(await stockOf(bolts.id)).toBe((Number(start) - 2).toFixed(3));
      expect((await as(buyer).post(`/purchase-orders/${po.id}/returns`, { type: 'RETURN', reason: 'too many', lines: [{ lineId: line, quantity: '9' }] }, key('ret'))).body.code).toBe('exceeds_received');
      const sugarLine = lineOf(po, sugar.id);
      await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: sugarLine, quantity: '2.5' }] }, key('r')).expect(201);
      const corrected = (await as(buyer).post(`/purchase-orders/${po.id}/returns`, { type: 'RECEIPT_CORRECTION', reason: 'Counted 1 kg too much', lines: [{ lineId: sugarLine, quantity: '1' }] }, key('cor')).expect(201)).body;
      expect(corrected.order.status).toBe('PARTIALLY_RECEIVED');
      expect(corrected.order.lines.find((l: { id: string }) => l.id === sugarLine).quantityReceived).toBe('1.500');
      await as(keeper).post(`/purchase-orders/${po.id}/returns`, { type: 'RETURN', reason: 'keeper cannot', lines: [{ lineId: line, quantity: '1' }] }, key('ret')).expect(403);
      const moves = (await owner().get(`/branches/${org.mainBranchId}/stock/movements?limit=200`)).body.items.map((m: { type: string }) => m.type);
      expect(moves).toEqual(expect.arrayContaining(['RETURN_TO_SUPPLIER', 'RECEIPT_CORRECTION']));
    });

    it('cancellation keeps history and is impossible once goods arrived; partially received orders can be closed', async () => {
      const d = await draft();
      const cancelled = (await as(buyer).post(`/purchase-orders/${d.id}/cancel`, { version: d.version, reason: 'Not needed' }).expect(200)).body;
      expect(cancelled).toMatchObject({ status: 'CANCELLED', closeReason: 'Not needed' });
      await as(buyer).get(`/purchase-orders/${d.id}`).expect(200);
      expect((await as(buyer).post(`/purchase-orders/${d.id}/submit`, { version: cancelled.version })).body.code).toBe('invalid_status');
      const po = await issued();
      await as(buyer).post(`/purchase-orders/${po.id}/cancel`, { version: po.version, reason: 'buyer cannot cancel issued' }).expect(403);
      const got = (await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: lineOf(po, bolts.id), quantity: '1' }] }, key('cc')).expect(201)).body.order;
      expect((await as(approver).post(`/purchase-orders/${po.id}/cancel`, { version: got.version, reason: 'too late' })).body.code).toBe('goods_received');
      const closed = (await as(approver).post(`/purchase-orders/${po.id}/close`, { version: got.version, reason: 'Supplier out of stock' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'CLOSED', closeReason: 'Supplier out of stock' });
      expect((await as(keeper).post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: lineOf(po, bolts.id), quantity: '1' }] }, key('cc'))).body.code).toBe('invalid_status');
    });

    it('inactive suppliers and products cannot be ordered; archived destinations accept no orders or receipts', async () => {
      const s = (await owner().post('/suppliers', { code: 'GONE', name: 'Gone Supplies' }).expect(201)).body;
      await owner().patch(`/suppliers/${s.id}`, { version: 1, status: 'INACTIVE' }).expect(200);
      expect((await as(buyer).post(`/branches/${org.mainBranchId}/purchase-orders`, { supplierId: s.id, lines: [{ productId: bolts.id, quantity: '1', unitCostMinor: '1' }] })).body.code).toBe('supplier_inactive');
      const p = (await owner().post('/products', { sku: 'INACT', name: 'Inactive thing' }).expect(201)).body;
      await owner().patch(`/products/${p.id}`, { version: 1, status: 'INACTIVE' }).expect(200);
      await as(buyer).post(`/branches/${org.mainBranchId}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: p.id, quantity: '1', unitCostMinor: '1' }] }).expect(404);
      // An order issued to a branch that is then archived cannot be received there.
      const br = (await owner().post('/branches', { name: 'Closing', code: 'CLOSING' }).expect(201)).body;
      let po = (await as(buyer).post(`/branches/${br.id}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: bolts.id, quantity: '1', unitCostMinor: '1' }] }).expect(201)).body;
      po = (await as(buyer).post(`/purchase-orders/${po.id}/submit`, { version: po.version }).expect(200)).body;
      po = (await owner().post(`/purchase-orders/${po.id}/approve`, { version: po.version }).expect(200)).body;
      po = (await as(buyer).post(`/purchase-orders/${po.id}/issue`, { version: po.version }).expect(200)).body;
      await owner().post(`/branches/${br.id}/archive`, { version: br.version }).expect(200);
      expect((await owner().post(`/purchase-orders/${po.id}/receipts`, { lines: [{ lineId: po.lines[0].id, quantity: '1' }] }, key('arch'))).body.code).toBe('branch_archived');
      expect((await as(buyer).post(`/branches/${br.id}/purchase-orders`, { supplierId: supplier.id, lines: [{ productId: bolts.id, quantity: '1', unitCostMinor: '1' }] })).body.code).toBe('branch_archived');
    });

    it('costs and reports follow permissions; another organization cannot reach orders or use foreign suppliers', async () => {
      const po = await draft();
      expect((await as(accountant).get(`/purchase-orders/${po.id}`).expect(200)).body).toHaveProperty('subtotalMinor');
      expect((await as(keeper).get(`/purchase-orders/${po.id}`).expect(200)).body).not.toHaveProperty('subtotalMinor');
      const report = (await as(accountant).get('/purchasing/reports/summary').expect(200)).body;
      expect(report.byStatus.length).toBeGreaterThan(0);
      await as(keeper).get('/purchasing/reports/summary').expect(403);
      await http(app).get(`/v1/orgs/${other.id}/purchase-orders/${po.id}`).set(bearer(other.owner)).expect(404);
      await http(app).post(`/v1/orgs/${other.id}/branches/${other.mainBranchId}/purchase-orders`).set(bearer(other.owner))
        .send({ supplierId: supplier.id, lines: [{ productId: bolts.id, quantity: '1', unitCostMinor: '1' }] }).expect(404);
      // Support and platform roles never come from organization roles.
      await http(app).get('/v1/platform/support/conversations').set(bearer(org.owner)).expect(403);
      expect(await roleId(app, org, 'Inventory manager')).toEqual(expect.any(String));
    });
  });
});

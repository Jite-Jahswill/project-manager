/**
 * Phase 6: expenses, operational cash movements and financial summaries
 * (docs/architecture/13-finance.md). Real PostgreSQL and Redis. Races are deterministic:
 * concurrent requests are issued together with Promise.all and the outcome is asserted exactly
 * (row locks, unique keys and CHECK constraints decide the winners).
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import { addMember, bearer, createOrg, createTestApp, http, pools, resetDatabase, setPlan, signUp, TestOrg, TestUser } from './support/harness';
import { waitFor } from './support/tcp-proxy';
import { snapshot } from './support/templates';

jest.setTimeout(240_000);

type Member = TestUser & { membershipId: string };
interface Expense { id: string; number: string; status: string; version: number; amountMinor: string; currency: string; branchId: string | null; createdByUserId: string; occurredOn: string }

const today = new Date().toISOString().slice(0, 10);
const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4ea0000000049454e44ae426082', 'hex');

describe('Finance: expenses, cash movements and summaries (phase 6)', () => {
  let app: INestApplication;
  let org: TestOrg;
  let other: TestOrg;
  let second: string;
  let accountant: Member;
  let approver: Member;
  let manager: Member;
  let cashier: Member;
  let auditor: Member;
  let clerk: Member;
  let rent: string;
  let travel: string;
  let n = 0;

  const key = (label: string) => `${label}-${Date.now()}-${++n}`.replace(/[^A-Za-z0-9_-]/g, '-');
  const as = (u: { token: string }, o: TestOrg = org) => ({
    get: (p: string) => http(app).get(`/v1/orgs/${o.id}${p}`).set(bearer(u)),
    post: (p: string, body: object = {}, k?: string) => {
      const r = http(app).post(`/v1/orgs/${o.id}${p}`).set(bearer(u));
      return (k ? r.set('Idempotency-Key', k) : r).send(body);
    },
    patch: (p: string, body: object) => http(app).patch(`/v1/orgs/${o.id}${p}`).set(bearer(u)).send(body),
    upload: (p: string, data: Buffer, type: string, name = 'receipt') =>
      http(app).post(`/v1/orgs/${o.id}${p}`).set(bearer(u)).set('Content-Type', type).set('X-File-Name', name).send(data),
  });
  /** Direct SQL as the runtime role, in the tenant context of `o`, acting as `userId` (default: the owner). */
  async function sql<T>(fn: (c: PoolClient) => Promise<T>, o: TestOrg = org, commit = false, userId = o.owner.userId): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [o.id, userId]);
      const out = await fn(c);
      if (commit) await c.query('COMMIT');
      return out;
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
      await pool.end();
    }
  }
  const newExpense = async (u: Member | TestUser, fields: Record<string, unknown> = {}, o: TestOrg = org): Promise<Expense> => {
    const res = await as(u, o).post('/expenses', { categoryId: rent, amountMinor: '10000', description: 'Office rent', occurredOn: today, ...fields }, key('exp'));
    expect({ status: res.status, body: res.status === 201 ? 'ok' : res.body }).toEqual({ status: 201, body: 'ok' });
    return res.body.expense;
  };
  const submitted = async (u: Member, fields: Record<string, unknown> = {}) => {
    const e = await newExpense(u, fields);
    return (await as(u).post(`/expenses/${e.id}/submit`, { version: e.version }).expect(200)).body as Expense;
  };
  const approved = async (u: Member, fields: Record<string, unknown> = {}) => {
    const e = await submitted(u, fields);
    return (await as(approver).post(`/expenses/${e.id}/approve`, { version: e.version }).expect(200)).body as Expense;
  };
  const audits = (action: string) => sql(async (c) => (await c.query('SELECT resource_id, actor_user_id, metadata FROM audit_events WHERE action = $1 ORDER BY occurred_at', [action])).rows);

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'fin-owner'), 'finance');
    other = await createOrg(app, await signUp(app, 'fin-other'), 'finance-other');
    await setPlan(org.id, 'growth');
    second = (await as(org.owner).post('/branches', { name: 'Second', code: 'SECOND' }).expect(201)).body.id;
    accountant = await addMember(app, org, 'fin-accountant', 'Accountant');
    approver = await addMember(app, org, 'fin-approver', 'Accountant');
    manager = await addMember(app, org, 'fin-manager', 'Branch manager', org.mainBranchId);
    cashier = await addMember(app, org, 'fin-cashier', 'Cashier', org.mainBranchId);
    auditor = await addMember(app, org, 'fin-auditor', 'Auditor');
    // A custom, branch-limited role: may record and read expenses at the second branch only.
    await as(org.owner).post('/roles', { name: 'Expense clerk', permissions: ['finance.expense.create', 'finance.expense.read'] }).expect(201);
    clerk = await addMember(app, org, 'fin-clerk', 'Expense clerk', second);
    rent = (await as(accountant).post('/expense-categories', { name: 'Rent' }).expect(201)).body.id;
    travel = (await as(accountant).post('/expense-categories', { name: 'Travel  and   transport' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('permissions and role templates', () => {
    it('built-in roles carry the phase 6 finance permissions; Cashier carries none', async () => {
      const roles = (await as(org.owner).get('/roles').expect(200)).body as { templateKey: string; permissions: string[] }[];
      const perms = (k: string) => roles.find((r) => r.templateKey === k)!.permissions;
      expect(perms('cashier').filter((p) => p.startsWith('finance.'))).toEqual([]);
      expect(perms('org_admin')).toEqual(expect.arrayContaining(['finance.expense.void', 'finance.report.export', 'finance.cash.reverse']));
      expect(perms('org_admin')).not.toContain('purchasing.order.self_approve');
      expect(perms('branch_manager').filter((p) => p.startsWith('finance.')).sort()).toEqual(['finance.cash.read', 'finance.cash.record', 'finance.expense.create', 'finance.expense.read']);
      expect(perms('auditor').filter((p) => p.startsWith('finance.')).sort()).toEqual(['finance.cash.read', 'finance.expense.read', 'finance.report.read']);
    });
  });

  describe('categories', () => {
    it('names are unique per organization after normalization; only managers change them', async () => {
      const dup = await as(accountant).post('/expense-categories', { name: '  travel AND transport ' });
      expect({ status: dup.status, code: dup.body.code }).toEqual({ status: 409, code: 'category_name_taken' });
      const list = (await as(clerk).get('/expense-categories').expect(200)).body.items as { id: string; name: string }[];
      expect(list.find((c) => c.id === travel)?.name).toBe('Travel and transport');
      await as(manager).post('/expense-categories', { name: 'Manager category' }).expect(403);
      await as(cashier).get('/expense-categories').expect(403);
      // The other organization may reuse the name.
      await as(other.owner, other).post('/expense-categories', { name: 'Rent' }).expect(201);
    });

    it('an archived category takes no new expenses, and its version is checked', async () => {
      const c = (await as(accountant).post('/expense-categories', { name: 'Old stuff' }).expect(201)).body;
      expect((await as(accountant).patch(`/expense-categories/${c.id}`, { version: 99, status: 'ARCHIVED' })).body.code).toBe('version_conflict');
      await as(accountant).patch(`/expense-categories/${c.id}`, { version: c.version, status: 'ARCHIVED' }).expect(200);
      const res = await as(manager).post('/expenses', { categoryId: c.id, amountMinor: '100', description: 'x', occurredOn: today, branchId: org.mainBranchId }, key('e'));
      expect(res.body.code).toBe('category_archived');
    });
  });

  describe('expense lifecycle', () => {
    it('validates amount, currency, dates, references and descriptions', async () => {
      const base = { categoryId: rent, amountMinor: '100', description: 'x', occurredOn: today };
      const cases: [Record<string, unknown>, string | number][] = [
        [{ amountMinor: '0' }, 'invalid_amount'], [{ amountMinor: '1.5' }, 400], [{ amountMinor: '-1' }, 400], [{ amountMinor: 100 }, 400],
        [{ currency: 'usd' }, 400], [{ currency: 'US' }, 400], [{ occurredOn: '2026-02-30' }, 'invalid_date'], [{ occurredOn: dayOffset(3) }, 'invalid_date'],
        [{ occurredOn: '1999-12-31' }, 'invalid_date'], [{ reference: 'card 4111111111111111' }, 'card_data_refused'], [{ description: '   ' }, 400],
        [{ categoryId: '00000000-0000-4000-8000-000000000000' }, 404], [{ unknownField: 1 }, 400],
      ];
      for (const [fields, expected] of cases) {
        const res = await as(accountant).post('/expenses', { ...base, ...fields }, key('v'));
        const got = typeof expected === 'number' ? res.status : res.body.code;
        expect({ fields, got }).toEqual({ fields, got: expected });
      }
      expect((await as(accountant).post('/expenses', base)).body.code).toBe('idempotency_key_required');
    });

    it('creation is idempotent: a retry replays, a reused key with another body is refused', async () => {
      const k = key('idem');
      const body = { categoryId: rent, amountMinor: '4200', description: 'Printer paper', occurredOn: today };
      const [a, b] = await Promise.all([as(accountant).post('/expenses', body, k), as(accountant).post('/expenses', body, k)]);
      expect([a.status, b.status].sort()).toEqual([201, 201]);
      expect(a.body.expense.id).toBe(b.body.expense.id);
      expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
      expect((await as(accountant).post('/expenses', { ...body, amountMinor: '4300' }, k)).body.code).toBe('idempotency_key_reused');
      expect(a.body.expense).toMatchObject({ status: 'DRAFT', version: 1, currency: 'USD', number: expect.stringMatching(/^E-\d{6}$/) });
    });

    it('only the creator edits a draft, with the current version; submitted content is immutable', async () => {
      const e = await newExpense(accountant);
      await as(approver).patch(`/expenses/${e.id}`, { version: e.version, amountMinor: '1' }).expect(403);
      expect((await as(accountant).patch(`/expenses/${e.id}`, { version: 99, amountMinor: '1' })).body.code).toBe('version_conflict');
      const edited = (await as(accountant).patch(`/expenses/${e.id}`, { version: e.version, amountMinor: '12500', categoryId: travel, reference: 'INV-77' }).expect(200)).body;
      expect(edited).toMatchObject({ amountMinor: '12500', category: { id: travel }, reference: 'INV-77', version: e.version + 1 });
      const sub = (await as(accountant).post(`/expenses/${e.id}/submit`, { version: edited.version }).expect(200)).body;
      expect((await as(accountant).patch(`/expenses/${e.id}`, { version: sub.version, amountMinor: '1' })).body.code).toBe('invalid_status');
      // The database refuses it too, even for a direct write.
      await expect(sql((c) => c.query('UPDATE expenses SET amount_minor = 1 WHERE id = $1', [e.id]))).rejects.toThrow(/only a draft can be edited/);
      await expect(sql((c) => c.query("UPDATE expenses SET status = 'DRAFT' WHERE id = $1", [e.id]))).rejects.toThrow(/invalid status transition/);
    });

    it('nobody approves, rejects or voids their own expense, not even the owner; the database agrees', async () => {
      const own = await submitted(accountant);
      const self = await as(accountant).post(`/expenses/${own.id}/approve`, { version: own.version });
      expect(self.status).toBe(403);
      expect((await as(accountant).post(`/expenses/${own.id}/reject`, { version: own.version, reason: 'self reject' })).status).toBe(403);
      const ownerExpense = await (async () => {
        const e = await newExpense(org.owner);
        return (await as(org.owner).post(`/expenses/${e.id}/submit`, { version: e.version }).expect(200)).body as Expense;
      })();
      await as(org.owner).post(`/expenses/${ownerExpense.id}/approve`, { version: ownerExpense.version }).expect(403);
      // Acting as the creator, recording the creator as decider: the self-decision CHECK refuses it.
      await expect(sql((c) => c.query(
        "UPDATE expenses SET status = 'APPROVED', decided_by_user_id = created_by_user_id, decided_at = now() WHERE id = $1", [own.id]), org, false, accountant.userId))
        .rejects.toThrow(/expenses_no_self_decision/);
      // A refused transition leaves no trace: same version, no event.
      const after = (await as(accountant).get(`/expenses/${own.id}`).expect(200)).body;
      expect({ status: after.status, version: after.version, events: after.events.map((e: { type: string }) => e.type) })
        .toEqual({ status: 'SUBMITTED', version: own.version, events: ['created', 'submitted'] });
    });

    it('approval needs the approval permission; managers and cashiers cannot', async () => {
      const e = await submitted(manager, { branchId: org.mainBranchId });
      await as(manager).post(`/expenses/${e.id}/approve`, { version: e.version }).expect(403);
      await as(cashier).post(`/expenses/${e.id}/approve`, { version: e.version }).expect(404);
      const ok = (await as(approver).post(`/expenses/${e.id}/approve`, { version: e.version }).expect(200)).body;
      expect(ok).toMatchObject({ status: 'APPROVED', decidedByUserId: approver.userId, version: e.version + 1 });
      // A retry is deterministic: the expense is no longer SUBMITTED.
      expect((await as(approver).post(`/expenses/${e.id}/approve`, { version: e.version })).body.code).toBe('invalid_status');
      expect((await as(approver).post(`/expenses/${e.id}/reject`, { version: ok.version, reason: 'late' })).body.code).toBe('invalid_status');
      expect((await audits('finance.expense.approved')).some((a) => a.resource_id === e.id && a.actor_user_id === approver.userId)).toBe(true);
    });

    it('rejection requires a reason and is final', async () => {
      const e = await submitted(manager, { branchId: org.mainBranchId });
      await as(approver).post(`/expenses/${e.id}/reject`, { version: e.version }).expect(400);
      await as(approver).post(`/expenses/${e.id}/reject`, { version: e.version, reason: 'no' }).expect(400);
      const r = (await as(approver).post(`/expenses/${e.id}/reject`, { version: e.version, reason: 'No receipt attached' }).expect(200)).body;
      expect(r).toMatchObject({ status: 'REJECTED', rejectionReason: 'No receipt attached' });
      expect((await as(approver).post(`/expenses/${e.id}/approve`, { version: r.version })).body.code).toBe('invalid_status');
      expect((await as(manager).post(`/expenses/${e.id}/cancel`, { version: r.version })).body.code).toBe('invalid_status');
    });

    it('cancelling: the creator cancels a draft, an approver a submitted one; approved expenses are voided instead', async () => {
      const d = await newExpense(manager, { branchId: org.mainBranchId });
      expect((await as(manager).post(`/expenses/${d.id}/cancel`, { version: d.version, reason: 'duplicate' }).expect(200)).body.status).toBe('CANCELLED');
      const s = await submitted(manager, { branchId: org.mainBranchId });
      await as(clerk).post(`/expenses/${s.id}/cancel`, { version: s.version }).expect(404);
      expect((await as(approver).post(`/expenses/${s.id}/cancel`, { version: s.version }).expect(200)).body.status).toBe('CANCELLED');
      const a = await approved(manager, { branchId: org.mainBranchId });
      expect((await as(approver).post(`/expenses/${a.id}/cancel`, { version: a.version })).body.code).toBe('invalid_status');
    });

    it('corrections are explicit: void (with a reason, not by the creator) and a replacement that names the voided expense', async () => {
      const a = await approved(accountant, { amountMinor: '9900', description: 'Wrong amount' });
      await as(accountant).post(`/expenses/${a.id}/void`, { version: a.version, reason: 'Entered 99.00 instead of 90.00' }).expect(403);
      await as(manager).post(`/expenses/${a.id}/void`, { version: a.version, reason: 'Wrong amount' }).expect(404);
      await as(approver).post(`/expenses/${a.id}/void`, { version: a.version }).expect(400);
      const voided = (await as(approver).post(`/expenses/${a.id}/void`, { version: a.version, reason: 'Entered 99.00 instead of 90.00' }).expect(200)).body;
      expect(voided).toMatchObject({ status: 'VOIDED', voidedByUserId: approver.userId, amountMinor: '9900' });
      // The original keeps its history; a correction replaces it and goes through approval again.
      const fix = await newExpense(accountant, { amountMinor: '9000', description: 'Corrected amount', correctsExpenseId: a.id });
      expect(fix).toMatchObject({ status: 'DRAFT', correctsExpenseId: a.id });
      const second = await as(accountant).post('/expenses', { categoryId: rent, amountMinor: '9000', description: 'again', occurredOn: today, correctsExpenseId: a.id }, key('fix'));
      expect({ status: second.status, code: second.body.code }).toEqual({ status: 409, code: 'already_corrected' });
      const notVoided = await newExpense(accountant);
      expect((await as(accountant).post('/expenses', { categoryId: rent, amountMinor: '1', description: 'x', occurredOn: today, correctsExpenseId: notVoided.id }, key('nv'))).body.code)
        .toBe('not_voided');
      const history = (await as(approver).get(`/expenses/${a.id}`).expect(200)).body;
      expect(history.events.map((e: { type: string }) => e.type)).toEqual(['created', 'submitted', 'approved', 'voided']);
      expect(history.correctedBy).toEqual([{ id: fix.id, number: fix.number, status: 'DRAFT' }]);
    });

    it('stale and concurrent decisions: exactly one wins, the others change nothing', async () => {
      const e = await submitted(manager, { branchId: org.mainBranchId });
      const results = await Promise.all([
        as(approver).post(`/expenses/${e.id}/approve`, { version: e.version }),
        as(accountant).post(`/expenses/${e.id}/reject`, { version: e.version, reason: 'Concurrent reject' }),
        as(approver).post(`/expenses/${e.id}/cancel`, { version: e.version }),
      ]);
      expect(results.filter((r) => r.status === 200).length).toBe(1);
      for (const r of results.filter((x) => x.status !== 200)) expect({ status: r.status, code: ['invalid_status', 'version_conflict'].includes(r.body.code) }).toEqual({ status: 409, code: true });
      const final = (await as(approver).get(`/expenses/${e.id}`).expect(200)).body;
      expect(final.version).toBe(e.version + 1);
      expect(final.events.length).toBe(3);
    });
  });

  describe('visibility and branch scope', () => {
    it('creators see their own; branch readers their branches; organization-level expenses need organization-wide read', async () => {
      const atSecond = await newExpense(clerk, { branchId: second, description: 'Second branch supplies' });
      const atMain = await newExpense(manager, { branchId: org.mainBranchId });
      const orgLevel = await newExpense(accountant, { description: 'Audit fee' });
      await as(clerk).get(`/expenses/${atSecond.id}`).expect(200);
      await as(clerk).get(`/expenses/${atMain.id}`).expect(404);
      await as(manager).get(`/expenses/${atSecond.id}`).expect(404);
      await as(manager).get(`/expenses/${orgLevel.id}`).expect(404);
      await as(cashier).get(`/expenses/${atMain.id}`).expect(404);
      await as(auditor).get(`/expenses/${orgLevel.id}`).expect(200);
      const managerList = (await as(manager).get('/expenses?limit=100').expect(200)).body.items as Expense[];
      expect(managerList.every((x) => x.branchId === org.mainBranchId)).toBe(true);
      const clerkList = (await as(clerk).get('/expenses?limit=100').expect(200)).body.items as Expense[];
      expect(clerkList.map((x) => x.id)).toEqual([atSecond.id]);
      expect((await as(cashier).get('/expenses').expect(200)).body.items).toEqual([]);
      // A branch-limited clerk cannot create elsewhere or at organization level.
      await as(clerk).post('/expenses', { categoryId: rent, amountMinor: '1', description: 'x', occurredOn: today, branchId: org.mainBranchId }, key('x')).expect(403);
      await as(clerk).post('/expenses', { categoryId: rent, amountMinor: '1', description: 'x', occurredOn: today }, key('x')).expect(403);
    });

    it('listing pages with a stable cursor', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: Expense[]; nextCursor: string | null } = (await as(approver).get(`/expenses?limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body;
        seen.push(...page.items.map((x) => x.id));
        cursor = page.nextCursor;
      } while (cursor);
      const total = await sql(async (c) => (await c.query('SELECT count(*)::int AS n FROM expenses')).rows[0].n);
      expect(new Set(seen).size).toBe(total);
      await as(approver).get('/expenses?cursor=not-a-cursor').expect(400);
      await as(approver).get('/expenses?limit=101').expect(400);
      await as(approver).get(`/expenses?from=${today}`).expect(400);
    });

    it('suspended members and DENY overrides are refused', async () => {
      const temp = await addMember(app, org, 'fin-temp', 'Accountant');
      await as(org.owner).post(`/members/${temp.membershipId}/overrides`, { permissionKey: 'finance.expense.approve', effect: 'DENY', reason: 'not yet trained' }).expect(201);
      const e = await submitted(manager, { branchId: org.mainBranchId });
      await as(temp).post(`/expenses/${e.id}/approve`, { version: e.version }).expect(403);
      await as(org.owner).patch(`/members/${temp.membershipId}`, { status: 'SUSPENDED' }).expect(200);
      await as(temp).get('/expenses').expect(403);
      await as(temp).get(`/finance/summary?from=${today}&to=${today}`).expect(403);
    });

    it("another organization's records do not exist here", async () => {
      const mine = await newExpense(accountant);
      await as(other.owner, other).get(`/expenses/${mine.id}`).expect(404);
      await http(app).get(`/v1/orgs/${org.id}/expenses/${mine.id}`).set(bearer(other.owner)).expect(403);
      const theirs = (await as(other.owner, other).get('/expense-categories').expect(200)).body.items[0];
      const res = await as(accountant).post('/expenses', { categoryId: theirs.id, amountMinor: '1', description: 'x', occurredOn: today }, key('xt'));
      expect(res.status).toBe(404);
    });
  });

  describe('attachments', () => {
    it('the creator attaches allow-listed files to an open expense; readers download them privately', async () => {
      const e = await newExpense(manager, { branchId: org.mainBranchId });
      const up = (await as(manager).upload(`/expenses/${e.id}/attachments`, PDF, 'application/pdf', 'invoice%20Oct.pdf').expect(201)).body;
      expect(up).toEqual({ id: expect.any(String), fileName: 'invoice Oct.pdf', contentType: 'application/pdf', sizeBytes: PDF.length, uploadedByUserId: manager.userId, createdAt: expect.any(String), scanStatus: 'CLEAN' });
      expect(JSON.stringify(up)).not.toMatch(/finance\/|storage/);
      await as(manager).upload(`/expenses/${e.id}/attachments`, PNG, 'image/png').expect(201);
      expect((await as(manager).upload(`/expenses/${e.id}/attachments`, Buffer.from('MZ\x90\x00binary'), 'application/pdf')).status).toBe(415);
      expect((await as(manager).upload(`/expenses/${e.id}/attachments`, Buffer.alloc(0), 'text/plain')).status).toBe(400);
      await as(approver).upload(`/expenses/${e.id}/attachments`, PDF, 'application/pdf').expect(403);
      await as(cashier).upload(`/expenses/${e.id}/attachments`, PDF, 'application/pdf').expect(404);
      const dl = await as(approver).get(`/expense-attachments/${up.id}/content`).expect(200);
      expect(dl.headers['cache-control']).toBe('private, no-store');
      expect(dl.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(dl.body).equals(PDF)).toBe(true);
      await as(cashier).get(`/expense-attachments/${up.id}/content`).expect(404);
      await as(other.owner, other).get(`/expense-attachments/${up.id}/content`).expect(404);
      expect((await audits('finance.expense.attachment.downloaded')).filter((a) => a.resource_id === up.id).length).toBe(1);
      // Decided expenses take no more files (service and database).
      const s = (await as(manager).post(`/expenses/${e.id}/submit`, { version: e.version }).expect(200)).body;
      const a = (await as(approver).post(`/expenses/${e.id}/approve`, { version: s.version }).expect(200)).body;
      expect(a.status).toBe('APPROVED');
      expect((await as(manager).upload(`/expenses/${e.id}/attachments`, PDF, 'application/pdf')).body.code).toBe('invalid_status');
      // No UPDATE privilege at all, and an append-only trigger behind it.
      await expect(sql((c) => c.query("UPDATE expense_attachments SET file_name = 'x' WHERE id = $1", [up.id]))).rejects.toThrow(/append-only|permission denied/);
    });
  });

  describe('cash movements', () => {
    let session: { id: string; version: number };
    let product: string;

    beforeAll(async () => {
      product = (await as(org.owner).post('/products', { sku: key('SKU'), name: 'Soap', sellingPriceMinor: '500' }).expect(201)).body.id;
      await as(org.owner).post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: product, quantity: '50', reason: 'opening' }).expect(201);
      session = (await as(cashier).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '1000' }).expect(201)).body;
    });

    it('records branch-level movements idempotently, in the default currency, as recorded (not verified)', async () => {
      const k = key('cash');
      const body = { type: 'BANK_DEPOSIT', amountMinor: '20000', reason: 'Weekly takings to bank', reference: 'SLIP-001' };
      const [a, b] = await Promise.all([as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, body, k), as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, body, k)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.movement.id).toBe(b.body.movement.id);
      expect(a.body.movement).toMatchObject({ type: 'BANK_DEPOSIT', direction: 'OUT', currency: 'USD', sessionId: null, verification: 'RECORDED', number: expect.stringMatching(/^C-\d{6}$/) });
      expect((await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, { ...body, amountMinor: '1' }, k)).body.code).toBe('idempotency_key_reused');
      expect((await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, body)).body.code).toBe('idempotency_key_required');
      for (const [fields, want] of [[{ type: 'REVERSAL' }, 400], [{ amountMinor: '0' }, 'invalid_amount'], [{ reason: 'x' }, 400], [{ type: 'CASH_DROP' }, 'session_required'], [{ currency: 'EUR1' }, 400]] as const) {
        const r = await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, { ...body, ...fields }, key('bad'));
        expect({ fields, got: typeof want === 'number' ? r.status : r.body.code }).toEqual({ fields, got: want });
      }
    });

    it('cashiers, other branches and other organizations are refused', async () => {
      const body = { type: 'PAID_IN', amountMinor: '100', reason: 'float top-up' };
      await as(cashier).post(`/branches/${org.mainBranchId}/cash-movements`, body, key('c')).expect(403);
      await as(cashier).get('/cash-movements').expect(403);
      await as(manager).post(`/branches/${second}/cash-movements`, body, key('c')).expect(403);
      const listed = (await as(manager).get(`/cash-movements?branchId=${second}`).expect(200)).body.items;
      expect(listed).toEqual([]);
      await http(app).post(`/v1/orgs/${org.id}/branches/${org.mainBranchId}/cash-movements`).set(bearer(other.owner)).set('Idempotency-Key', key('o')).send(body).expect(403);
    });

    it("session-linked movements change the drawer's expected cash, never below zero; concurrent payouts serialize", async () => {
      const sale = (await as(cashier).post(`/branches/${org.mainBranchId}/sales`, { lines: [{ productId: product, quantity: '4' }] }, key('sale')).expect(201)).body.sale;
      await as(cashier).post(`/sales/${sale.id}/payments`, { method: 'CASH', amountMinor: '2000' }, key('pay')).expect(201);
      const expected = async () => (await as(cashier).get(`/cashier-sessions/${session.id}`).expect(200)).body.expectedCashSoFarMinor;
      expect(await expected()).toBe('3000');
      const post = (type: string, amountMinor: string, u: Member = manager) =>
        as(u).post(`/branches/${org.mainBranchId}/cash-movements`, { type, amountMinor, reason: `${type} test`, sessionId: session.id }, key('s'));
      expect((await post('PAID_OUT', '700')).status).toBe(201);
      expect((await post('PAID_IN', '200')).status).toBe(201);
      expect(await expected()).toBe('2500');
      expect((await post('PAID_OUT', '2501')).body.code).toBe('insufficient_drawer_cash');
      // Two payouts that each fit but together do not: the session lock lets exactly one through.
      const race = await Promise.all([post('CASH_DROP', '1500'), post('CASH_DROP', '1500')]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(race.find((r) => r.status === 409)!.body.code).toBe('insufficient_drawer_cash');
      expect(await expected()).toBe('1000');
      // The session's currency rules; a mismatch is refused.
      expect((await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, { type: 'PAID_IN', amountMinor: '1', reason: 'eur in', sessionId: session.id, currency: 'EUR' }, key('m'))).body.code)
        .toBe('currency_mismatch');
      // Sale receipts are not cash movements: nothing was double counted.
      const movements = (await as(manager).get(`/cash-movements?sessionId=${session.id}`).expect(200)).body.items as { type: string }[];
      expect(movements.map((m) => m.type).sort()).toEqual(['CASH_DROP', 'PAID_IN', 'PAID_OUT']);
    });

    it('reversals mirror the original once, need their own permission, and cannot touch a closed session', async () => {
      const m = (await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, { type: 'PAID_OUT', amountMinor: '300', reason: 'Cleaning supplies', sessionId: session.id }, key('r'))).body.movement;
      await as(manager).post(`/cash-movements/${m.id}/reverse`, { reason: 'Recorded twice' }, key('rv')).expect(403);
      const rk = key('rv');
      const [a, b, c] = await Promise.all([
        as(accountant).post(`/cash-movements/${m.id}/reverse`, { reason: 'Recorded twice' }, rk),
        as(accountant).post(`/cash-movements/${m.id}/reverse`, { reason: 'Recorded twice' }, rk),
        as(approver).post(`/cash-movements/${m.id}/reverse`, { reason: 'Also reversing' }, key('rv2')),
      ]);
      const created = [a, b, c].filter((r) => r.status === 201);
      expect(new Set(created.map((r) => r.body.movement.id)).size).toBe(1);
      expect([a, b, c].filter((r) => r.status === 409).every((r) => r.body.code === 'already_reversed')).toBe(true);
      const reversal = created[0].body.movement;
      expect(reversal).toMatchObject({ type: 'REVERSAL', direction: 'IN', amountMinor: '300', sessionId: session.id, reversesId: m.id, reference: m.number });
      expect((await as(accountant).get(`/cash-movements/${m.id}`).expect(200)).body.reversedBy).toEqual({ id: reversal.id, number: reversal.number });
      expect((await as(accountant).post(`/cash-movements/${reversal.id}/reverse`, { reason: 'undo the undo' }, key('rr'))).body.code).toBe('cannot_reverse_reversal');
      // No UPDATE or DELETE privilege, and an append-only trigger behind it.
      await expect(sql((cl) => cl.query('UPDATE cash_movements SET amount_minor = 1 WHERE id = $1', [m.id]))).rejects.toThrow(/append-only|permission denied/);
      await expect(sql((cl) => cl.query('DELETE FROM cash_movements WHERE id = $1', [m.id]))).rejects.toThrow(/append-only|permission denied/);

      // Close: expected cash = float 1000 + cash 2000 − 700 + 200 − 1500 − 300 + 300 = 1000.
      const late = (await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, { type: 'PAID_IN', amountMinor: '50', reason: 'Late float top-up', sessionId: session.id }, key('late'))).body.movement;
      const s = (await as(cashier).get(`/cashier-sessions/${session.id}`).expect(200)).body;
      const closed = (await as(cashier).post(`/cashier-sessions/${session.id}/close`, { version: s.version, declaredCashMinor: '1040' }).expect(200)).body;
      expect({ expected: closed.expectedCashMinor, variance: closed.varianceMinor }).toEqual({ expected: '1050', variance: '-10' });
      expect((await as(manager).post(`/branches/${org.mainBranchId}/cash-movements`, { type: 'PAID_IN', amountMinor: '5', reason: 'after close', sessionId: session.id }, key('ac'))).body.code)
        .toBe('session_closed');
      expect((await as(accountant).post(`/cash-movements/${late.id}/reverse`, { reason: 'after close' }, key('acr'))).body.code).toBe('session_closed');
      // The database refuses a movement into a closed session even without the service.
      await expect(sql((cl) => cl.query(
        `INSERT INTO cash_movements (organization_id, branch_id, session_id, number, type, direction, amount_minor, currency, reason, recorded_by_user_id, idempotency_key)
         VALUES ($1, $2, $3, 'C-999999', 'PAID_IN', 'IN', 1, 'USD', 'direct', $4, 'direct-insert-key')`, [org.id, org.mainBranchId, session.id, org.owner.userId])))
        .rejects.toThrow(/not open/);
    });
  });

  describe('reports', () => {
    it('the summary reconciles with the source records, per currency, with definitions', async () => {
      // An approved expense in another currency stays separate.
      await approved(accountant, { amountMinor: '7777', currency: 'EUR', description: 'EUR conference' });
      const res = (await as(auditor).get(`/finance/summary?from=${today}&to=${today}`).expect(200)).body;
      expect(res.period).toEqual({ from: today, to: today, timeZone: 'UTC' });
      expect(res.currencies.map((c: { currency: string }) => c.currency)).toEqual(['EUR', 'USD']);
      const usd = res.currencies.find((c: { currency: string }) => c.currency === 'USD');
      const eur = res.currencies.find((c: { currency: string }) => c.currency === 'EUR');
      expect(eur.expenses.approved).toEqual({ count: 1, amountMinor: '7777' });
      const truth = await sql(async (c) => ({
        approved: (await c.query("SELECT count(*)::int AS n, coalesce(sum(amount_minor), 0)::text AS s FROM expenses WHERE currency = 'USD' AND status = 'APPROVED' AND occurred_on = $1::date", [today])).rows[0],
        pending: (await c.query("SELECT count(*)::int AS n, coalesce(sum(amount_minor), 0)::text AS s FROM expenses WHERE currency = 'USD' AND status = 'SUBMITTED' AND occurred_on = $1::date", [today])).rows[0],
        voided: (await c.query("SELECT count(*)::int AS n FROM expenses WHERE currency = 'USD' AND status = 'VOIDED'")).rows[0].n,
        gross: (await c.query("SELECT coalesce(sum(total_minor), 0)::text AS s FROM sales WHERE status = 'COMPLETED'")).rows[0].s,
        paid: (await c.query("SELECT coalesce(sum(amount_minor), 0)::text AS s FROM payments WHERE status = 'CONFIRMED'")).rows[0].s,
        cashIn: (await c.query("SELECT coalesce(sum(amount_minor), 0)::text AS s FROM cash_movements WHERE direction = 'IN'")).rows[0].s,
        cashOut: (await c.query("SELECT coalesce(sum(amount_minor), 0)::text AS s FROM cash_movements WHERE direction = 'OUT'")).rows[0].s,
      }));
      expect(usd.expenses.approved).toEqual({ count: truth.approved.n, amountMinor: truth.approved.s });
      expect(usd.expenses.pending).toEqual({ count: truth.pending.n, amountMinor: truth.pending.s });
      expect(usd.expenses.byStatus.VOIDED.count).toBe(truth.voided);
      expect(usd.sales.gross.amountMinor).toBe(truth.gross);
      expect(usd.payments.confirmed.amountMinor).toBe(truth.paid);
      expect(usd.cash.in.amountMinor).toBe(truth.cashIn);
      expect(usd.cash.out.amountMinor).toBe(truth.cashOut);
      expect(usd.cash.netMinor).toBe((BigInt(truth.cashIn) - BigInt(truth.cashOut)).toString());
      expect(usd.derived.paymentsLessRefundsMinor).toBe((BigInt(truth.paid) - BigInt(usd.refunds.amountMinor)).toString());
      expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(['expenses.approved', 'sales.gross', 'refunds', 'cash.in / cash.out']));
      expect(res.limitations.join(' ')).toMatch(/exchange rates/);
    });

    it('refunds, voided sales and returns are reported by their own semantics', async () => {
      const opened = await as(cashier).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' });
      expect({ status: opened.status, body: opened.status === 201 ? 'ok' : opened.body }).toEqual({ status: 201, body: 'ok' });
      const s = opened.body;
      const product = (await as(org.owner).post('/products', { sku: key('SKU'), name: 'Towel', sellingPriceMinor: '1000' }).expect(201)).body.id;
      await as(org.owner).post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: product, quantity: '10', reason: 'opening' }).expect(201);
      const before = (await as(accountant).get(`/finance/summary?from=${today}&to=${today}`).expect(200)).body.currencies.find((c: { currency: string }) => c.currency === 'USD');
      const paidSale = (await as(cashier).post(`/branches/${org.mainBranchId}/sales`, { lines: [{ productId: product, quantity: '2' }] }, key('ps')).expect(201)).body.sale;
      const pay = (await as(cashier).post(`/sales/${paidSale.id}/payments`, { method: 'CASH', amountMinor: '2000' }, key('pp')).expect(201)).body.payment;
      // Cash refunds come out of the refunder's own open session (phase 5).
      const managerSession = (await as(manager).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '1000' }).expect(201)).body;
      await as(manager).post(`/payments/${pay.id}/refunds`, { amountMinor: '500', reason: 'damaged' }, key('rf')).expect(201);
      await as(cashier).post(`/sales/${paidSale.id}/returns`, { reason: 'damaged', lines: [{ saleLineId: paidSale.lines[0].id, quantity: '1', disposition: 'DAMAGED' }] }, key('rt')).expect(201);
      const voidSale = (await as(cashier).post(`/branches/${org.mainBranchId}/sales`, { lines: [{ productId: product, quantity: '1' }] }, key('vs')).expect(201)).body.sale;
      await as(manager).post(`/sales/${voidSale.id}/void`, { version: voidSale.version, reason: 'rung up by mistake' }).expect(200);
      const after = (await as(accountant).get(`/finance/summary?from=${today}&to=${today}`).expect(200)).body;
      const usd = after.currencies.find((c: { currency: string }) => c.currency === 'USD');
      const delta = (a: string, b: string) => (BigInt(a) - BigInt(b)).toString();
      expect(delta(usd.sales.gross.amountMinor, before.sales.gross.amountMinor)).toBe('2000'); // the voided 1000 is not gross
      expect(delta(usd.sales.voided.amountMinor, before.sales.voided.amountMinor)).toBe('1000');
      expect(delta(usd.refunds.amountMinor, before.refunds.amountMinor)).toBe('500');
      expect(delta(usd.payments.confirmed.amountMinor, before.payments.confirmed.amountMinor)).toBe('2000');
      expect(after.returns.count).toBeGreaterThanOrEqual(1);
      // Refunds out of a drawer are refunds, not cash movements.
      expect((await as(manager).get(`/cash-movements?sessionId=${managerSession.id}`).expect(200)).body.items).toEqual([]);
      expect((await as(manager).get(`/cash-movements?sessionId=${s.id}`).expect(200)).body.items).toEqual([]);
    });

    it('date boundaries are inclusive UTC days; ranges are validated', async () => {
      const yesterday = dayOffset(-1);
      const edge = await approved(accountant, { amountMinor: '1234', occurredOn: yesterday, currency: 'GBP', description: 'Yesterday' });
      const get = async (from: string, to: string) => (await as(accountant).get(`/finance/summary?from=${from}&to=${to}`).expect(200)).body.currencies
        .find((c: { currency: string }) => c.currency === 'GBP')?.expenses.approved ?? { count: 0, amountMinor: '0' };
      expect(await get(yesterday, yesterday)).toEqual({ count: 1, amountMinor: '1234' });
      expect(await get(yesterday, today)).toEqual({ count: 1, amountMinor: '1234' });
      expect(await get(today, today)).toEqual({ count: 0, amountMinor: '0' });
      expect(edge.occurredOn).toBe(yesterday);
      for (const [q, codeWanted] of [
        [`from=${today}&to=${yesterday}`, 'invalid_period'], ['from=2025-01-01&to=2026-12-31', 'period_too_long'], ['from=2026-02-30&to=2026-03-01', 'invalid_date'],
        [`from=${today}`, 400], [`from=${today}&to=${today}&branchId=nope`, 400],
      ] as const) {
        const r = await as(accountant).get(`/finance/summary?${q}`);
        expect({ q, got: typeof codeWanted === 'number' ? r.status : r.body.code }).toEqual({ q, got: codeWanted });
      }
      await as(accountant).get(`/finance/summary?from=${today}&to=${today}&branchId=00000000-0000-4000-8000-000000000000`).expect(404);
    });

    it('branch filters, grouped expense summaries and cashier-session summaries', async () => {
      await approved(clerk, { branchId: second, amountMinor: '3333', description: 'Second branch cleaning', categoryId: travel });
      const atSecond = (await as(accountant).get(`/finance/summary?from=${today}&to=${today}&branchId=${second}`).expect(200)).body;
      expect(atSecond.currencies).toEqual([expect.objectContaining({ currency: 'USD', expenses: expect.objectContaining({ approved: { count: 1, amountMinor: '3333' } }) })]);
      const byCategory = (await as(accountant).get(`/finance/expense-summary?from=${today}&to=${today}&groupBy=category&branchId=${second}`).expect(200)).body;
      expect(byCategory.groups).toContainEqual(expect.objectContaining({ key: travel, label: 'Travel and transport', currency: 'USD', approved: { count: 1, amountMinor: '3333' } }));
      // Other categories at that branch hold only unapproved expenses here: listed, but with nothing approved.
      for (const g of byCategory.groups.filter((x: { key: string }) => x.key !== travel)) expect(g.approved).toEqual({ count: 0, amountMinor: '0' });
      const byBranch = (await as(accountant).get(`/finance/expense-summary?from=${today}&to=${today}&groupBy=branch`).expect(200)).body;
      expect(byBranch.groups.some((g: { key: string | null }) => g.key === null)).toBe(true); // organization-level expenses
      const byMonth = (await as(accountant).get(`/finance/expense-summary?from=${today}&to=${today}&groupBy=month`).expect(200)).body;
      expect(byMonth.groups.every((g: { key: string }) => g.key === today.slice(0, 7))).toBe(true);
      await as(accountant).get(`/finance/expense-summary?from=${today}&to=${today}&groupBy=customer`).expect(400);
      const sessions = (await as(accountant).get(`/finance/cash-session-summary?from=${today}&to=${today}`).expect(200)).body;
      expect(sessions.closed).toEqual([expect.objectContaining({ currency: 'USD', sessions: 1, expectedCashMinor: '1050', declaredCashMinor: '1040', varianceMinor: '-10', sessionsShort: 1 })]);
      expect(sessions.stillOpen).toEqual([{ currency: 'USD', sessions: 2 }]); // the cashier's and the manager's from the refund test
    });

    it('reports and exports need their own permissions', async () => {
      await as(manager).get(`/finance/summary?from=${today}&to=${today}`).expect(403);
      await as(cashier).get(`/finance/summary?from=${today}&to=${today}`).expect(403);
      await as(clerk).get(`/finance/cash-session-summary?from=${today}&to=${today}`).expect(403);
      await as(auditor).get(`/finance/exports/expenses?from=${today}&to=${today}`).expect(403);
      await http(app).get(`/v1/orgs/${org.id}/finance/summary?from=${today}&to=${today}`).set(bearer(other.owner)).expect(403);
    });

    it('exports are bounded CSV, neutralize formulas and are audited', async () => {
      await newExpense(accountant, { description: '=HYPERLINK("http://evil.example","click")', reference: '+cmd' });
      const res = await as(accountant).get(`/finance/exports/expenses?from=${today}&to=${today}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="expenses-${today}-${today}.csv"`);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toBe('number,status,occurredOn,branchId,category,amountMinor,currency,description,reference,createdByUserId,submittedAt,decidedByUserId,decidedAt,rejectionReason,voidedAt,voidReason,correctsExpenseId');
      const count = await sql(async (c) => (await c.query('SELECT count(*)::int AS n FROM expenses WHERE occurred_on = $1::date', [today])).rows[0].n);
      expect(lines.length - 1).toBe(count);
      expect(res.headers['x-row-count']).toBe(String(count));
      expect(res.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
      expect(res.text).toContain(",'+cmd,");
      const cash = await as(accountant).get(`/finance/exports/cash-movements?from=${today}&to=${today}`).expect(200);
      expect(cash.text.split('\r\n')[0]).toMatch(/^number,createdAt,branchId,sessionId,type,direction,amountMinor/);
      const exported = await audits('finance.export.generated');
      expect(exported.map((a) => a.metadata.kind).sort()).toEqual(['cash-movements', 'expenses']);
      expect(exported.find((a) => a.metadata.kind === 'expenses').metadata).toMatchObject({ rows: count, from: today, to: today });
      await as(accountant).get('/finance/exports/expenses?from=2025-01-01&to=2026-12-31').expect(400);
    });

    it('an export larger than the limit is refused, not truncated', async () => {
      const big = await createOrg(app, await signUp(app, 'fin-big'), 'finance-big');
      const cat = (await as(big.owner, big).post('/expense-categories', { name: 'Bulk' }).expect(201)).body.id;
      await sql((c) => c.query(
        `INSERT INTO expenses (organization_id, category_id, number, amount_minor, currency, description, occurred_on, created_by_user_id, idempotency_key, updated_at)
         SELECT $1, $2, 'E-' || lpad(g::text, 6, '0'), 1, 'USD', 'bulk', $3::date, $4, 'bulk-key-' || g, now() FROM generate_series(1, 10001) g`,
        [big.id, cat, today, big.owner.userId]), big, true);
      const res = await as(big.owner, big).get(`/finance/exports/expenses?from=${today}&to=${today}`);
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 422, code: 'export_too_large' });
      expect((await sql(async (c) => (await c.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'finance.export.generated'")).rows[0].n, big))).toBe(0);
    });
  });

  describe('audit hardening (phase 6.1)', () => {
    let till: Member;
    let item: string;
    const sell = async (u: Member, minor: string) => {
      const sale = (await as(u).post(`/branches/${org.mainBranchId}/sales`, { lines: [{ productId: item, quantity: '1' }] }, key('hs')).expect(201)).body.sale;
      expect(sale.totalMinor).toBe('100');
      return { sale, pay: () => as(u).post(`/sales/${sale.id}/payments`, { method: 'CASH', amountMinor: minor }, key('hp')) };
    };
    /** Stored expected cash of every closed session equals a recomputation from its cash events (no event after close). */
    const closedSessionsReconcile = () => sql(async (c) => (await c.query(`
      SELECT s.id, s.expected_cash_minor::text AS stored,
        (s.opening_float_minor
          + coalesce((SELECT sum(amount_minor) FROM payments WHERE session_id = s.id AND method = 'CASH' AND status = 'CONFIRMED'), 0)
          - coalesce((SELECT sum(amount_minor) FROM refunds WHERE session_id = s.id AND method = 'CASH'), 0)
          + coalesce((SELECT sum(amount_minor) FROM cash_movements WHERE session_id = s.id AND direction = 'IN'), 0)
          - coalesce((SELECT sum(amount_minor) FROM cash_movements WHERE session_id = s.id AND direction = 'OUT'), 0))::text AS recomputed
      FROM cashier_sessions s WHERE s.status = 'CLOSED'`)).rows);
    const lockWaiters = () => sql(async (c) => (await c.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%cashier_sessions%'")).rows[0].n as number);

    beforeAll(async () => {
      till = await addMember(app, org, 'fin-till', 'Cashier', org.mainBranchId);
      item = (await as(org.owner).post('/products', { sku: key('SKU'), name: 'Candle', sellingPriceMinor: '100' }).expect(201)).body.id;
      await as(org.owner).post(`/branches/${org.mainBranchId}/stock/opening-balances`, { productId: item, quantity: '500', reason: 'opening' }).expect(201);
    });

    it('a cash payment takes the session lock: it waits while the session is being closed', async () => {
      const session = (await as(till).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '0' }).expect(201)).body;
      const { pay } = await sell(till, '100');
      // Hold the session row as closing does (FOR UPDATE), in a separate transaction.
      const pool = pools.app();
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [org.id, org.owner.userId]);
        await holder.query('SELECT id FROM cashier_sessions WHERE id = $1 FOR UPDATE', [session.id]);
        const pending = pay();
        const settled = pending.then((r) => r);
        await waitFor(async () => (await lockWaiters()) >= 1, 15_000);
        await holder.query('ROLLBACK');
        expect((await settled).status).toBe(201);
      } finally {
        holder.release();
        await pool.end();
      }
      const s = (await as(till).get(`/cashier-sessions/${session.id}`).expect(200)).body;
      await as(till).post(`/cashier-sessions/${session.id}/close`, { version: s.version, declaredCashMinor: '100' }).expect(200);
    });

    it('closing racing cash payments: every payment is either counted in the close or refused', async () => {
      for (let round = 0; round < 4; round++) {
        const session = (await as(till).post(`/branches/${org.mainBranchId}/cashier-sessions`, { openingFloatMinor: '500' }).expect(201)).body;
        const pays = await Promise.all([sell(till, '100'), sell(till, '100'), sell(till, '100')]);
        const [close, ...payments] = await Promise.all([
          as(manager).post(`/cashier-sessions/${session.id}/close`, { version: session.version, declaredCashMinor: '500' }),
          ...pays.map((p) => p.pay()),
        ]);
        expect(close.status).toBe(200);
        const accepted = payments.filter((r) => r.status === 201).length;
        for (const r of payments.filter((x) => x.status !== 201)) expect({ status: r.status, code: r.body.code }).toEqual({ status: 409, code: 'no_open_session' });
        expect(close.body.expectedCashMinor).toBe(String(500 + 100 * accepted));
      }
      for (const row of await closedSessionsReconcile()) expect({ id: row.id, stored: row.stored }).toEqual({ id: row.id, stored: row.recomputed });
    });

    it('the database refuses cash payments and refunds into a closed session', async () => {
      const closed = (await sql(async (c) => (await c.query("SELECT id FROM cashier_sessions WHERE status = 'CLOSED' AND cashier_user_id = $1 LIMIT 1", [till.userId])).rows[0]));
      const payment = (await sql(async (c) => (await c.query("SELECT id, sale_id FROM payments WHERE status = 'CONFIRMED' AND method = 'CASH' AND session_id = $1 LIMIT 1", [closed.id])).rows[0]));
      await expect(sql((c) => c.query(
        `INSERT INTO payments (organization_id, sale_id, branch_id, session_id, method, amount_minor, idempotency_key, recorded_by_user_id)
         VALUES ($1, $2, $3, $4, 'CASH', 1, 'late-cash-key-1', $5)`, [org.id, payment.sale_id, org.mainBranchId, closed.id, till.userId]), org, false, till.userId))
        .rejects.toThrow(/session is not open/);
      await expect(sql((c) => c.query(
        `INSERT INTO refunds (organization_id, sale_id, payment_id, session_id, method, amount_minor, reason, idempotency_key, actor_user_id)
         VALUES ($1, $2, $3, $4, 'CASH', 1, 'late refund', 'late-refund-key-1', $5)`, [org.id, payment.sale_id, payment.id, closed.id, till.userId]), org, false, till.userId))
        .rejects.toThrow(/session is not open/);
    });

    it('exports never show records the caller could not list', async () => {
      await as(org.owner).post('/roles', { name: 'Export only', permissions: ['finance.report.export'] }).expect(201);
      await as(org.owner).post('/roles', { name: 'Expense exporter', permissions: ['finance.report.export', 'finance.expense.read'] }).expect(201);
      const exportOnly = await addMember(app, org, 'fin-export-only', 'Export only');
      const expenseExporter = await addMember(app, org, 'fin-expense-exporter', 'Expense exporter');
      const branchReader = await addMember(app, org, 'fin-branch-exporter', 'Expense exporter', org.mainBranchId);
      for (const kind of ['expenses', 'cash-movements']) await as(exportOnly).get(`/finance/exports/${kind}?from=${today}&to=${today}`).expect(403);
      await as(expenseExporter).get(`/finance/exports/expenses?from=${today}&to=${today}`).expect(200);
      await as(expenseExporter).get(`/finance/exports/cash-movements?from=${today}&to=${today}`).expect(403);
      // Branch-limited read is not organization-wide: no export.
      await as(branchReader).get(`/finance/exports/expenses?from=${today}&to=${today}`).expect(403);
      const audited = await audits('finance.export.generated');
      expect(audited.filter((a) => [exportOnly.userId, branchReader.userId].includes(a.actor_user_id))).toEqual([]);
    });

    it('actor columns must name the acting user (the database checks it)', async () => {
      const draft = await newExpense(accountant);
      // Somebody else editing the creator's draft.
      await expect(sql((c) => c.query("UPDATE expenses SET description = 'tampered' WHERE id = $1", [draft.id]), org, false, approver.userId))
        .rejects.toThrow(/only the creator edits a draft/);
      // A submission recorded for someone other than the acting user, or by someone other than the creator.
      await expect(sql((c) => c.query("UPDATE expenses SET status = 'SUBMITTED', submitted_by_user_id = $2, submitted_at = now() WHERE id = $1", [draft.id, accountant.userId]), org, false, approver.userId))
        .rejects.toThrow(/acting user/);
      await expect(sql((c) => c.query("UPDATE expenses SET status = 'SUBMITTED', submitted_by_user_id = $2, submitted_at = now() WHERE id = $1", [draft.id, approver.userId]), org, false, approver.userId))
        .rejects.toThrow(/expenses_submitter_is_creator/);
      const sub = await submitted(accountant);
      // A decision attributed to the approver but written by someone else.
      await expect(sql((c) => c.query("UPDATE expenses SET status = 'APPROVED', decided_by_user_id = $2, decided_at = now() WHERE id = $1", [sub.id, approver.userId]), org, false, manager.userId))
        .rejects.toThrow(/acting user/);
      await expect(sql((c) => c.query(
        `INSERT INTO expenses (organization_id, category_id, number, amount_minor, currency, description, occurred_on, created_by_user_id, idempotency_key, updated_at)
         VALUES ($1, $2, 'E-900001', 1, 'USD', 'spoofed', $3::date, $4, 'spoofed-creator-key', now())`, [org.id, rent, today, accountant.userId]), org, false, manager.userId))
        .rejects.toThrow(/created_by_user_id must be the acting user/);
      await expect(sql((c) => c.query(
        "INSERT INTO expense_events (organization_id, expense_id, type, actor_user_id) VALUES ($1, $2, 'approved', $3)", [org.id, sub.id, approver.userId]), org, false, manager.userId))
        .rejects.toThrow(/actor_user_id must be the acting user/);
      await expect(sql((c) => c.query(
        `INSERT INTO cash_movements (organization_id, branch_id, number, type, direction, amount_minor, currency, reason, recorded_by_user_id, idempotency_key)
         VALUES ($1, $2, 'C-900001', 'PAID_IN', 'IN', 1, 'USD', 'spoofed recorder', $3, 'spoofed-recorder-key')`, [org.id, org.mainBranchId, accountant.userId]), org, false, manager.userId))
        .rejects.toThrow(/recorded_by_user_id must be the acting user/);
      // The real paths are unaffected.
      const ok = (await as(approver).post(`/expenses/${sub.id}/approve`, { version: sub.version }).expect(200)).body;
      expect(ok.decidedByUserId).toBe(approver.userId);
    });

    it('voiding moves an amount from approved to VOIDED for its own period; nothing is lost', async () => {
      const day = dayOffset(-2);
      const totals = async () => (await as(accountant).get(`/finance/summary?from=${day}&to=${day}`).expect(200)).body.currencies
        .find((c: { currency: string }) => c.currency === 'JPY')?.expenses ?? { approved: { amountMinor: '0' }, byStatus: { VOIDED: { amountMinor: '0' } } };
      const a = await approved(manager, { branchId: org.mainBranchId, amountMinor: '5000', currency: 'JPY', occurredOn: day, description: 'JPY taxi' });
      const before = await totals();
      expect(before.approved.amountMinor).toBe('5000');
      await as(approver).post(`/expenses/${a.id}/void`, { version: a.version, reason: 'Duplicate of another claim' }).expect(200);
      const after = await totals();
      expect({ approved: after.approved.amountMinor, voided: after.byStatus.VOIDED.amountMinor }).toEqual({ approved: '0', voided: '5000' });
      const definitions = (await as(accountant).get(`/finance/summary?from=${day}&to=${day}`).expect(200)).body.definitions;
      expect(definitions['current status']).toMatch(/status now/);
    });
  });

  describe('role template sync for finance (version 4)', () => {
    it('a phase 5 organization receives the finance additions; exclusions and custom roles are respected', async () => {
      const legacy = await createOrg(app, await signUp(app, 'fin-legacy'), 'finance-legacy');
      await sql(async (c) => {
        const roles = (await c.query('SELECT id, template_key FROM roles WHERE template_key IS NOT NULL AND NOT is_system')).rows;
        for (const r of roles) {
          const keep = snapshot(3, r.template_key);
          await c.query('DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_key = ANY($2::text[]))', [r.id, keep]);
          await c.query('UPDATE roles SET template_version = 3 WHERE id = $1', [r.id]);
        }
        const acc = roles.find((r) => r.template_key === 'accountant');
        // The organization had deliberately taken export away from its accountants.
        await c.query("INSERT INTO role_permission_exclusions (organization_id, role_id, permission_key) VALUES ($1, $2, 'finance.report.export')", [legacy.id, acc.id]);
      }, legacy, true);
      const custom = (await as(legacy.owner, legacy).post('/roles', { name: 'Petty cash', permissions: ['finance.cash.read'] }).expect(201)).body;
      const { seed } = await import('../prisma/seed');
      const report = await seed(process.env.TEST_MIGRATION_DATABASE_URL as string, { devEmailProvider: 'CAPTURE' });
      const forLegacy = report.changes.filter((c) => c.organizationId === legacy.id);
      expect(forLegacy.find((c) => c.templateKey === 'accountant')).toMatchObject({
        fromVersion: 3, withheld: ['finance.report.export'],
        added: ['finance.cash.read', 'finance.cash.reverse', 'finance.category.manage', 'finance.expense.read', 'finance.expense.void'],
      });
      expect(forLegacy.find((c) => c.templateKey === 'cashier')).toBeUndefined();
      const roles = (await as(legacy.owner, legacy).get('/roles').expect(200)).body as { id: string; templateKey: string; permissions: string[] }[];
      expect(roles.find((r) => r.templateKey === 'cashier')!.permissions.some((p) => p.startsWith('finance.'))).toBe(false);
      expect(roles.find((r) => r.id === custom.id)!.permissions).toEqual(['finance.cash.read']);
    });
  });
});

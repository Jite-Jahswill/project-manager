/**
 * Phase 7: private object storage and malware scanning for support and expense attachments
 * (docs/security/attachments.md). Real PostgreSQL, Redis, S3-compatible storage (SeaweedFS) and
 * ClamAV. The EICAR test file is the industry-standard, harmless string every scanner detects.
 * Failure paths use separate app instances pointed at closed ports; the background worker is
 * driven explicitly (AttachmentObjects.runOnce), so nothing depends on timing.
 */
import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PoolClient } from 'pg';
import { loadConfig } from '../src/config/env';
import { AttachmentObjects } from '../src/storage/attachment-objects.service';
import { ObjectMissing } from '../src/storage/object-store';
import { S3ObjectStore } from '../src/storage/s3-object-store';
import { bearer, createOrg, createTestApp, http, pools, resetDatabase, signUp, TestOrg, TestUser } from './support/harness';

jest.setTimeout(240_000);

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const today = new Date().toISOString().slice(0, 10);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('Attachment storage and scanning (phase 7)', () => {
  let app: INestApplication;
  let org: TestOrg;
  let other: TestOrg;
  let customer: TestUser;
  let stranger: TestUser;
  let category: string;
  let s3: S3ObjectStore;
  let n = 0;
  const key = (l: string) => `${l}-${Date.now()}-${++n}`;

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
  const worker = <T>(fn: (c: PoolClient) => Promise<T>, commit = false) => sql({ 'app.attachment_worker': 'on' }, fn, commit);
  const objectOf = async (id: string) => (await worker(async (c) => (await c.query(
    'SELECT id, domain, storage_key, backend::text, state::text, scan_attempts, next_scan_at, scanned_at, scan_engine, scan_signature, object_deleted_at FROM attachment_objects WHERE id = $1', [id])).rows[0]));

  // ---- the two domains, through the real API
  const newExpense = async (o: TestOrg = org) => (await http(app).post(`/v1/orgs/${o.id}/expenses`).set(bearer(o.owner)).set('Idempotency-Key', key('exp'))
    .send({ categoryId: o === org ? category : (await categoryIn(o)), amountMinor: '100', description: 'Receipt test', occurredOn: today }).expect(201)).body.expense as { id: string };
  const categoryIn = async (o: TestOrg) => (await http(app).post(`/v1/orgs/${o.id}/expense-categories`).set(bearer(o.owner)).send({ name: key('cat') }).expect(201)).body.id;
  const uploadExpense = (a: INestApplication, expenseId: string, data: Buffer, type: string, o: TestOrg = org) =>
    http(a).post(`/v1/orgs/${o.id}/expenses/${expenseId}/attachments`).set(bearer(o.owner)).set('Content-Type', type).set('X-File-Name', 'file').send(data);
  const downloadExpense = (attachmentId: string, o: TestOrg = org, u: TestUser = o.owner) =>
    http(app).get(`/v1/orgs/${o.id}/expense-attachments/${attachmentId}/content`).set(bearer(u));
  const newConversation = async (u: TestUser) => (await http(app).post('/v1/support/conversations').set(bearer(u))
    .send({ subject: 'Attachment test', body: 'See the attached file.', category: 'TECHNICAL' }).expect(201)).body as { id: string };
  const uploadSupport = (a: INestApplication, u: TestUser, conversationId: string, data: Buffer, type: string) =>
    http(a).post(`/v1/support/conversations/${conversationId}/attachments`).set(bearer(u)).set('Content-Type', type).set('X-File-Name', 'file').send(data);
  const downloadSupport = (u: TestUser, attachmentId: string) => http(app).get(`/v1/support/attachments/${attachmentId}/content`).set(bearer(u));

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    org = await createOrg(app, await signUp(app, 'store-owner'), 'storage');
    other = await createOrg(app, await signUp(app, 'store-other'), 'storage-other');
    customer = await signUp(app, 'store-customer');
    stranger = await signUp(app, 'store-stranger');
    category = (await http(app).post(`/v1/orgs/${org.id}/expense-categories`).set(bearer(org.owner)).send({ name: 'Receipts' }).expect(201)).body.id;
    s3 = new S3ObjectStore(loadConfig().storage.s3!);
  });

  afterAll(async () => {
    s3?.destroy();
    await app?.close();
  });

  describe('clean files', () => {
    it('finance: stored privately in S3, scanned CLEAN by ClamAV, served byte for byte', async () => {
      const e = await newExpense();
      const up = await uploadExpense(app, e.id, PDF, 'application/pdf').expect(201);
      expect(up.body.scanStatus).toBe('CLEAN');
      expect(JSON.stringify(up.body)).not.toMatch(/finance\/|S3|s3|storage|8333|http/);
      const o = await objectOf(up.body.id);
      expect(o).toMatchObject({ domain: 'finance', backend: 'S3', state: 'CLEAN', scan_signature: null, object_deleted_at: null, storage_key: `finance/${e.id}/${up.body.id}` });
      expect(o.scan_engine).toMatch(/^ClamAV \d+\.\d+\.\d+\/\d+$/);
      expect((await s3.get(o.storage_key)).equals(PDF)).toBe(true);
      const dl = await downloadExpense(up.body.id).expect(200);
      expect(Buffer.from(dl.body).equals(PDF)).toBe(true);
      expect(dl.headers['cache-control']).toBe('private, no-store');
      const detail = (await http(app).get(`/v1/orgs/${org.id}/expenses/${e.id}`).set(bearer(org.owner)).expect(200)).body;
      expect(detail.attachments).toEqual([expect.objectContaining({ id: up.body.id, scanStatus: 'CLEAN' })]);
      expect(JSON.stringify(detail)).not.toMatch(/storageKey|storage_key|backend/);
    });

    it('support: the same storage and scanning', async () => {
      const c = await newConversation(customer);
      const up = await uploadSupport(app, customer, c.id, PDF, 'application/pdf').expect(201);
      expect(up.body.scanStatus).toBe('CLEAN');
      const o = await objectOf(up.body.id);
      expect(o).toMatchObject({ domain: 'support', backend: 'S3', state: 'CLEAN', storage_key: `support/${c.id}/${up.body.id}` });
      expect(Buffer.from((await downloadSupport(customer, up.body.id).expect(200)).body).equals(PDF)).toBe(true);
      await downloadSupport(stranger, up.body.id).expect(404);
    });
  });

  describe('malware', () => {
    it('finance: EICAR is detected, its bytes deleted, and it is never served', async () => {
      const e = await newExpense();
      const up = await uploadExpense(app, e.id, EICAR, 'text/plain').expect(201);
      expect(up.body.scanStatus).toBe('INFECTED');
      const o = await objectOf(up.body.id);
      expect(o).toMatchObject({ state: 'INFECTED', scan_signature: 'Eicar-Test-Signature' });
      expect(o.object_deleted_at).not.toBeNull();
      await expect(s3.get(o.storage_key)).rejects.toBeInstanceOf(ObjectMissing);
      const dl = await downloadExpense(up.body.id);
      expect({ status: dl.status, code: dl.body.code }).toEqual({ status: 409, code: 'attachment_blocked' });
      // A platform-level security event (no organization): read in the platform audit scope.
      const audit = await sql({ 'app.platform_scope': 'on' }, async (c) => (await c.query(
        "SELECT metadata FROM audit_events WHERE action = 'storage.attachment.malware_detected' AND resource_id = $1", [up.body.id])).rows);
      expect(audit).toEqual([{ metadata: expect.objectContaining({ domain: 'finance', signature: 'Eicar-Test-Signature' }) }]);
      // A blocked file does not count towards the limit, and nothing can make it CLEAN again.
      await expect(worker((c) => c.query("UPDATE attachment_objects SET state = 'CLEAN' WHERE id = $1", [up.body.id]))).rejects.toThrow(/invalid state transition/);
    });

    it('support: EICAR is blocked and cannot be sent with a message', async () => {
      const c = await newConversation(customer);
      const up = await uploadSupport(app, customer, c.id, EICAR, 'text/plain').expect(201);
      expect(up.body.scanStatus).toBe('INFECTED');
      expect((await downloadSupport(customer, up.body.id)).body.code).toBe('attachment_blocked');
      const send = await http(app).post(`/v1/support/conversations/${c.id}/messages`).set(bearer(customer)).send({ body: 'here', attachmentIds: [up.body.id] });
      expect({ status: send.status, code: send.body.code }).toEqual({ status: 400, code: 'invalid_attachments' });
    });
  });

  describe('scanner and storage failures', () => {
    it('scanner down: the upload succeeds unscanned and is not served until a later scan says CLEAN', async () => {
      const blind = await createTestApp({ CLAMAV_PORT: '1', CLAMAV_TIMEOUT_MS: '2000' });
      try {
        const e = await newExpense();
        const up = await uploadExpense(blind, e.id, PDF, 'application/pdf').expect(201);
        expect(up.body.scanStatus).toBe('PENDING_SCAN');
        const o = await objectOf(up.body.id);
        expect({ state: o.state, attempts: o.scan_attempts, later: new Date(o.next_scan_at) > new Date() }).toEqual({ state: 'PENDING_SCAN', attempts: 1, later: true });
        expect((await downloadExpense(up.body.id)).body.code).toBe('attachment_scan_pending');
        // The retry is due: a worker with a working scanner scans it.
        await worker((c) => c.query('UPDATE attachment_objects SET next_scan_at = now() WHERE id = $1', [up.body.id]), true);
        await app.get(AttachmentObjects).runOnce();
        expect((await objectOf(up.body.id)).state).toBe('CLEAN');
        await downloadExpense(up.body.id).expect(200);
      } finally {
        await blind.close();
      }
    });

    it('a file the scanner keeps failing on becomes SCAN_FAILED and is never served', async () => {
      const blind = await createTestApp({ CLAMAV_PORT: '1', CLAMAV_TIMEOUT_MS: '2000', ATTACHMENT_SCAN_MAX_ATTEMPTS: '2' });
      try {
        const c = await newConversation(customer);
        const up = await uploadSupport(blind, customer, c.id, PDF, 'application/pdf').expect(201);
        await worker((cl) => cl.query('UPDATE attachment_objects SET next_scan_at = now() WHERE id = $1', [up.body.id]), true);
        await blind.get(AttachmentObjects).runOnce();
        expect((await objectOf(up.body.id)).state).toBe('SCAN_FAILED');
        expect((await downloadSupport(customer, up.body.id)).body.code).toBe('attachment_scan_failed');
      } finally {
        await blind.close();
      }
    });

    it('storage down: the upload is refused (503), recorded as ABANDONED, and leaves nothing to serve', async () => {
      const offline = await createTestApp({ S3_ENDPOINT: 'http://127.0.0.1:1' });
      try {
        const e = await newExpense();
        const res = await uploadExpense(offline, e.id, PDF, 'application/pdf');
        expect({ status: res.status, code: res.body.code }).toEqual({ status: 503, code: 'storage_unavailable' });
        const rows = await worker(async (c) => (await c.query("SELECT state::text, object_deleted_at FROM attachment_objects WHERE storage_key LIKE $1", [`finance/${e.id}/%`])).rows);
        expect(rows).toEqual([{ state: 'ABANDONED', object_deleted_at: expect.any(Date) }]);
        const detail = (await http(app).get(`/v1/orgs/${org.id}/expenses/${e.id}`).set(bearer(org.owner)).expect(200)).body;
        expect(detail.attachments.map((a: { scanStatus: string }) => a.scanStatus)).toEqual(['ABANDONED']);
        // Storage back: the creator simply uploads again.
        expect((await uploadExpense(app, e.id, PDF, 'application/pdf').expect(201)).body.scanStatus).toBe('CLEAN');
      } finally {
        await offline.close();
      }
    });

    it('interrupted uploads are swept: bytes deleted, record ABANDONED; recent uploads are left alone', async () => {
      const id = randomUUID();
      const old = randomUUID();
      const storageKey = `finance/${randomUUID()}/${id}`;
      const oldKey = `finance/${randomUUID()}/${old}`;
      for (const [i, k] of [[id, storageKey], [old, oldKey]]) {
        await s3.put(k, PDF, sha(PDF));
        await sql({ 'app.org_id': org.id, 'app.user_id': org.owner.userId }, (c) => c.query(
          `INSERT INTO attachment_objects (id, domain, storage_key, backend, content_type, size_bytes, sha256, created_at, updated_at)
           VALUES ($1, 'finance', $2, 'S3', 'application/pdf', $3, $4, ${i === old ? "now() - interval '1 hour'" : 'now()'}, now())`, [i, k, PDF.length, sha(PDF)]), true);
      }
      await app.get(AttachmentObjects).sweep();
      expect((await objectOf(old)).state).toBe('ABANDONED');
      await expect(s3.get(oldKey)).rejects.toBeInstanceOf(ObjectMissing);
      expect((await objectOf(id)).state).toBe('UPLOADING');
      expect((await s3.get(storageKey)).equals(PDF)).toBe(true);
    });

    it('altered bytes in storage are detected and not served', async () => {
      const e = await newExpense();
      const up = await uploadExpense(app, e.id, PDF, 'application/pdf').expect(201);
      const o = await objectOf(up.body.id);
      const tampered = Buffer.from(PDF.toString().replace('1.4', '1.7'));
      await s3.delete(o.storage_key);
      await s3.put(o.storage_key, tampered, sha(tampered));
      const dl = await downloadExpense(up.body.id);
      expect({ status: dl.status, code: dl.body.code }).toEqual({ status: 409, code: 'attachment_integrity_error' });
    });
  });

  describe('legacy local-disk attachments', () => {
    /** An attachment as it existed before phase 7: bytes on local disk, object row LOCAL and never scanned. */
    async function legacyFinance(data: Buffer, recordedSha = sha(data)) {
      const e = await newExpense();
      const id = randomUUID();
      const storageKey = `finance/${e.id}/${id}`;
      const path = join(loadConfig().storage.localDir, storageKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      await sql({ 'app.org_id': org.id, 'app.user_id': org.owner.userId }, async (c) => {
        await c.query(`INSERT INTO attachment_objects (id, domain, storage_key, backend, content_type, size_bytes, sha256, updated_at)
          VALUES ($1, 'finance', $2, 'LOCAL', 'application/pdf', $3, $4, now())`, [id, storageKey, data.length, recordedSha]);
        await c.query(`INSERT INTO expense_attachments (id, organization_id, expense_id, storage_key, file_name, content_type, size_bytes, sha256, uploaded_by_user_id)
          VALUES ($1, $2, $3, $4, 'legacy.pdf', 'application/pdf', $5, $6, $7)`, [id, org.id, e.id, storageKey, data.length, recordedSha, org.owner.userId]);
      }, true);
      await worker((c) => c.query("UPDATE attachment_objects SET state = 'PENDING_SCAN', next_scan_at = now() WHERE id = $1", [id]), true);
      return { id, storageKey, path };
    }

    it('are not served until scanned, are then served from local disk, and move to S3 verified', async () => {
      const legacy = await legacyFinance(PDF);
      expect((await downloadExpense(legacy.id)).body.code).toBe('attachment_scan_pending');
      await app.get(AttachmentObjects).runOnce();
      expect(await objectOf(legacy.id)).toMatchObject({ state: 'CLEAN', backend: 'LOCAL' });
      expect(Buffer.from((await downloadExpense(legacy.id).expect(200)).body).equals(PDF)).toBe(true);

      const objects = app.get(AttachmentObjects);
      const dry = await objects.migrateLocalToS3({ dryRun: true, keepLocal: false });
      expect(dry).toMatchObject({ candidates: 1, moved: 0, failed: [] });
      expect((await objectOf(legacy.id)).backend).toBe('LOCAL');
      const done = await objects.migrateLocalToS3({ dryRun: false, keepLocal: false });
      expect(done).toMatchObject({ candidates: 1, moved: 1, failed: [] });
      expect((await objectOf(legacy.id)).backend).toBe('S3');
      expect((await s3.get(legacy.storageKey)).equals(PDF)).toBe(true);
      await expect(readFile(legacy.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(Buffer.from((await downloadExpense(legacy.id).expect(200)).body).equals(PDF)).toBe(true);
      expect(await objects.migrateLocalToS3({ dryRun: false, keepLocal: false })).toMatchObject({ candidates: 0, moved: 0 });
    });

    it('a legacy file that no longer matches its recorded hash is neither served nor migrated', async () => {
      const legacy = await legacyFinance(PDF, sha(Buffer.from('something else')));
      const r = await app.get(AttachmentObjects).migrateLocalToS3({ dryRun: false, keepLocal: false });
      expect(r.failed).toContainEqual({ id: legacy.id, reason: 'local bytes do not match the recorded SHA-256' });
      expect((await objectOf(legacy.id)).backend).toBe('LOCAL');
      await app.get(AttachmentObjects).runOnce();
      const o = await objectOf(legacy.id);
      expect({ state: o.state, attempts: o.scan_attempts }).toEqual({ state: 'PENDING_SCAN', attempts: 1 });
      expect((await downloadExpense(legacy.id)).body.code).toBe('attachment_scan_pending');
    });
  });

  describe('database protections', () => {
    it('lifecycle changes need the worker scope; identity columns are not updatable at all', async () => {
      const e = await newExpense();
      const up = await uploadExpense(app, e.id, PDF, 'application/pdf').expect(201);
      const asOwner = { 'app.org_id': org.id, 'app.user_id': org.owner.userId };
      expect(await sql(asOwner, async (c) => (await c.query("UPDATE attachment_objects SET state = 'CLEAN' WHERE id = $1", [up.body.id])).rowCount)).toBe(0);
      await expect(worker((c) => c.query("UPDATE attachment_objects SET sha256 = repeat('0', 64) WHERE id = $1", [up.body.id]))).rejects.toThrow(/permission denied/);
      await expect(worker((c) => c.query("UPDATE attachment_objects SET backend = 'LOCAL' WHERE id = $1", [up.body.id]))).rejects.toThrow(/backend changes only/);
      await expect(worker((c) => c.query("UPDATE attachment_objects SET scan_engine = 'forged' WHERE id = $1", [up.body.id]))).rejects.toThrow(/verdict is immutable/);
      await expect(worker((c) => c.query('DELETE FROM attachment_objects WHERE id = $1', [up.body.id]))).rejects.toThrow(/permission denied/);
      await expect(sql(asOwner, (c) => c.query(
        `INSERT INTO attachment_objects (id, domain, storage_key, backend, state, content_type, size_bytes, sha256, updated_at)
         VALUES ($1, 'finance', $2, 'S3', 'CLEAN', 'application/pdf', 1, repeat('0', 64), now())`, [randomUUID(), `finance/${randomUUID()}/${randomUUID()}`])))
        .rejects.toThrow(/row-level security|start as UPLOADING/);
    });

    it("objects are visible only with their attachment: never across tenants or users, never without context", async () => {
      const mine = await uploadExpense(app, (await newExpense()).id, PDF, 'application/pdf').expect(201);
      const theirs = await uploadExpense(app, (await newExpense(other)).id, PDF, 'application/pdf', other).expect(201);
      const c = await newConversation(customer);
      const support = await uploadSupport(app, customer, c.id, PDF, 'application/pdf').expect(201);
      const visible = (settings: Record<string, string>) => sql(settings, async (cl) => (await cl.query('SELECT id FROM attachment_objects')).rows.map((r) => r.id));
      const inOrg = await visible({ 'app.org_id': org.id, 'app.user_id': org.owner.userId });
      expect(inOrg).toContain(mine.body.id);
      expect(inOrg).not.toContain(theirs.body.id);
      expect(inOrg).not.toContain(support.body.id);
      expect(await visible({ 'app.user_id': customer.userId })).toContain(support.body.id);
      expect(await visible({ 'app.user_id': stranger.userId })).toEqual([]);
      expect(await visible({})).toEqual([]);
      await downloadExpense(theirs.body.id).expect(404);
      await downloadExpense(mine.body.id, other, other.owner).expect(404);
    });
  });
});

/**
 * Stage 2C email platform (docs/architecture/08-email-platform.md, docs/security/email.md)
 * against real PostgreSQL and Redis. External providers are local stand-ins: a mock of
 * the Resend HTTP API (request formats verified) and a real SMTP server (smtp-server).
 * No real provider delivery is performed or claimed.
 */
import { INestApplication } from '@nestjs/common';
import { createServer, IncomingMessage, Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoolClient } from 'pg';
import { SMTPServer } from 'smtp-server';
import { PrismaService } from '../src/database/prisma.service';
import { TenantDb } from '../src/database/tenant-db.service';
import { EmailService } from '../src/email/email.service';
import { EmailWorker } from '../src/email/email-worker.service';
import { capturedEmails } from '../src/email/providers/dev.adapters';
import { SmtpAdapter } from '../src/email/providers/smtp.adapter';
import { ResendAdapter } from '../src/email/providers/resend.adapter';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import {
  bearer, createOrg, createTestApp, enableMfa, http, mailsTo, PASSWORD, pools, resetDatabase, resetEmailConfiguration, signUp, TestOrg,
  TestUser, uniqueEmail,
} from './support/harness';
import { redisTarget, redisUrlVia, TcpProxy, waitFor } from './support/tcp-proxy';

jest.setTimeout(120_000);

interface RecordedRequest { method: string; path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }
type Reply = { status: number; body: unknown; delayMs?: number };

/** Local stand-in for the Resend HTTP API. */
class MockResend {
  server!: Server;
  port = 0;
  requests: RecordedRequest[] = [];
  domains: { name: string; status: string }[] = [];
  queue: Reply[] = [];
  domainsReply: Reply | null = null;
  async start() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        this.requests.push({ method: req.method!, path: req.url!, headers: req.headers, body });
        const reply: Reply = req.url === '/domains'
          ? this.domainsReply ?? { status: 200, body: { data: this.domains } }
          : this.queue.shift() ?? { status: 200, body: { id: `msg_${this.requests.length}` } };
        setTimeout(() => {
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as { port: number }).port;
  }
  emails() {
    return this.requests.filter((r) => r.path === '/emails');
  }
  async stop() {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

describe('Email platform', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let ops: TestUser;
  let plain: TestUser;
  let captureProviderId: string;
  let defaultSenderId: string;
  const resend = new MockResend();
  const RESEND_KEY = 're_TestOnlyKey_9f8e7d6c5b4a';

  const api = (u: TestUser) => ({
    get: (p: string) => http(app).get(`/v1/platform/email${p}`).set(bearer(u)),
    post: (p: string, b: object = {}) => http(app).post(`/v1/platform/email${p}`).set(bearer(u)).send(b),
    patch: (p: string, b: object) => http(app).patch(`/v1/platform/email${p}`).set(bearer(u)).send(b),
    put: (p: string, b: object) => http(app).put(`/v1/platform/email${p}`).set(bearer(u)).send(b),
    del: (p: string) => http(app).delete(`/v1/platform/email${p}`).set(bearer(u)),
  });
  const fresh = (u: TestUser) => http(app).post('/v1/auth/reauthenticate').set(bearer(u)).send({ password: PASSWORD }).expect(204);

  async function platformAdmin(label: string, roles: string[]): Promise<TestUser> {
    const u = await signUp(app, label);
    await app.get(PrismaService).$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
      await tx.platformAdmin.create({ data: { userId: u.userId } });
      for (const name of roles) {
        const role = await tx.platformRole.findUniqueOrThrow({ where: { name } });
        await tx.platformAdminRole.create({ data: { adminUserId: u.userId, roleId: role.id } });
      }
    });
    await enableMfa(app, u);
    return u;
  }

  async function platformSql<T>(fn: (c: PoolClient) => Promise<T>, scope: 'platform' | 'worker' = 'platform'): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('${scope === 'platform' ? 'app.platform_scope' : 'app.email_worker'}', 'on', true)`);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await pool.end();
    }
  }

  const job = (id: string) => platformSql((c) => c.query('SELECT * FROM email_outbox WHERE id = $1', [id]).then((r) => r.rows[0]));
  const waitForJob = (id: string, status: string, timeoutMs = 10_000) => waitFor(async () => (await job(id))?.status === status, timeoutMs, 50);

  /** Puts the shared configuration back: capture provider, sending on, default retry policy. */
  async function restore() {
    await fresh(superAdmin);
    await api(superAdmin).post(`/providers/${captureProviderId}/activate`).expect(200);
    await api(superAdmin).patch('/settings', { retryMaxAttempts: 8, retryBaseDelaySeconds: 30, retryMaxDelaySeconds: 3600, defaultSenderId: defaultSenderId }).expect(200);
    await platformSql((c) => c.query('UPDATE email_settings SET sending_enabled = true'));
  }

  beforeAll(async () => {
    await resetDatabase();
    await resetEmailConfiguration();
    await resend.start();
    app = await createTestApp();
    superAdmin = await signUp(app, 'email-super');
    await bootstrapSuperAdmin(app.get(PrismaService), superAdmin.email);
    await enableMfa(app, superAdmin);
    ops = await platformAdmin('email-ops', ['Email operations']);
    plain = await signUp(app, 'email-plain');
    const cfg = await api(superAdmin).get('/config').expect(200);
    captureProviderId = cfg.body.providers.find((p: { kind: string }) => p.kind === 'CAPTURE').id;
    defaultSenderId = cfg.body.settings.defaultSenderId;
  });
  afterAll(async () => {
    await restore().catch(() => undefined);
    await app.close();
    await resend.stop();
    await resetEmailConfiguration();
  });

  describe('administration and permissions', () => {
    it('non-admins and admins without the permission are refused; email operations cannot touch secrets', async () => {
      expect((await api(plain).get('/config')).status).toBe(403);
      await fresh(ops);
      await api(ops).get('/config').expect(200);
      const created = await api(ops).post('/providers', { kind: 'RESEND', name: 'ops-resend', settings: { apiBaseUrl: `http://127.0.0.1:${resend.port}` } }).expect(201);
      const secret = await api(ops).put(`/providers/${created.body.id}/secret`, { secret: RESEND_KEY });
      expect(secret.status).toBe(403);
      // Privileged routes need a recent password re-entry.
      await app.get(PrismaService).session.update({ where: { id: ops.sessionId }, data: { reauthenticatedAt: new Date(Date.now() - 11 * 60_000) } });
      expect((await api(ops).patch('/settings', { maxSendsPerMinute: 100 })).body.code).toBe('step_up_required');
      await fresh(ops);
    });

    it('provider settings are validated per provider; unknown providers and unsafe transport are rejected', async () => {
      await fresh(superAdmin);
      expect((await api(superAdmin).post('/providers', { kind: 'SENDGRID', name: 'x-1' })).status).toBe(400);
      expect((await api(superAdmin).post('/providers', { kind: 'RESEND', name: 'x-2', settings: { apiBaseUrl: 'http://api.resend.com' } })).status).toBe(400);
      expect((await api(superAdmin).post('/providers', { kind: 'SMTP', name: 'x-3', settings: { host: 'smtp.example.net', port: 25, security: 'none' } })).status).toBe(400);
      expect((await api(superAdmin).post('/providers', { kind: 'SMTP', name: 'x-4', settings: { host: 'smtp.example.net', port: 587, password: 'nope' } })).status).toBe(400);
      expect((await api(superAdmin).post('/providers', { kind: 'RESEND', name: 'x-5', settings: { timeoutMs: 999999 } })).status).toBe(400);
    });

    it('secrets are write-only: never in responses, audit history or readable by the application role', async () => {
      await fresh(superAdmin);
      const p = await api(superAdmin).post('/providers', { kind: 'RESEND', name: 'secret-test', settings: { apiBaseUrl: `http://127.0.0.1:${resend.port}` } }).expect(201);
      const set = await api(superAdmin).put(`/providers/${p.body.id}/secret`, { secret: RESEND_KEY }).expect(200);
      expect(set.body).toMatchObject({ secretConfigured: true, secretHint: `re_…${RESEND_KEY.slice(-4)}` });
      const everything = JSON.stringify([set.body, (await api(superAdmin).get('/config')).body, (await api(superAdmin).get('/audit-events')).body]);
      expect(everything).not.toContain(RESEND_KEY);
      expect(everything).not.toContain(RESEND_KEY.slice(3, -4));
      const appPool = pools.app();
      const auth = pools.auth();
      try {
        await expect(appPool.query('SELECT * FROM email_provider_secrets')).rejects.toThrow(/permission denied/);
        const row = await auth.query('SELECT ciphertext FROM email_provider_secrets WHERE provider_id = $1', [p.body.id]);
        expect(row.rows[0].ciphertext).toMatch(/^v1:e1:/);
        expect(row.rows[0].ciphertext).not.toContain(RESEND_KEY);
      } finally {
        await appPool.end();
        await auth.end();
      }
      await api(superAdmin).del(`/providers/${p.body.id}/secret`).expect(200);
    });
  });

  describe('Resend: request format, verification gate and dynamic switch', () => {
    let providerId: string;
    beforeAll(async () => {
      await fresh(superAdmin);
      const p = await api(superAdmin).post('/providers', { kind: 'RESEND', name: 'resend-mock', settings: { apiBaseUrl: `http://127.0.0.1:${resend.port}`, timeoutMs: 1000 } }).expect(201);
      providerId = p.body.id;
      await api(superAdmin).put(`/providers/${providerId}/secret`, { secret: RESEND_KEY }).expect(200);
    });
    afterEach(() => restore());

    it('production sending cannot be enabled until the provider check passes and the sender domain is verified', async () => {
      await fresh(superAdmin);
      resend.domains = [{ name: 'mail.havehub.com.ng', status: 'pending' }];
      await api(superAdmin).post(`/providers/${providerId}/activate`).expect(200);
      expect((await api(superAdmin).post('/sending', { enabled: true })).body.code).toBe('email_not_ready');
      const check = await api(superAdmin).post(`/providers/${providerId}/check`).expect(200);
      expect(check.body.check).toMatchObject({ ok: true, domainVerified: false });
      const refused = await api(superAdmin).post('/sending', { enabled: true });
      expect(refused.body).toMatchObject({ code: 'email_not_ready' });
      expect(refused.body.message).toMatch(/not verified/);
      // With sending disabled, normal mail waits (it is not delivered anywhere).
      const target = await app.get(PrismaService).user.create({ data: { email: uniqueEmail('held-mail'), displayName: 'h' } });
      const jobId = await app.get(EmailService).enqueue({ type: 'security.notice', userId: target.id, notice: 'mfa_enabled' });
      await new Promise((r) => setTimeout(r, 400));
      expect((await job(jobId)).status).toBe('PENDING');
      expect(resend.emails()).toHaveLength(0);
    });

    it('sends through Resend with the exact API format once verified; switching providers needs no restart', async () => {
      await fresh(superAdmin);
      resend.domains = [{ name: 'mail.havehub.com.ng', status: 'verified' }];
      resend.requests = [];
      await api(superAdmin).post(`/providers/${providerId}/activate`).expect(200);
      const check = await api(superAdmin).post(`/providers/${providerId}/check`).expect(200);
      expect(check.body.check).toMatchObject({ ok: true, domainVerified: true });
      expect(resend.requests[0].headers.authorization).toBe(`Bearer ${RESEND_KEY}`);
      await api(superAdmin).post('/sending', { enabled: true }).expect(200);

      // A real flow (registration -> verification email) now goes out through Resend.
      const registered = uniqueEmail('resend-flow');
      await http(app).post('/v1/auth/register').send({ email: registered, password: PASSWORD, displayName: 'Resend Flow' }).expect(202);
      // Jobs held while sending was off (e.g. the admin's own MFA notice) are released too; pick ours.
      const ours = () => resend.emails().find((r) => (r.body.to as string[] | undefined)?.[0] === registered);
      await waitFor(() => !!ours(), 8000);
      const req = ours()!;
      expect(req.method).toBe('POST');
      expect(req.headers.authorization).toBe(`Bearer ${RESEND_KEY}`);
      expect(req.headers['idempotency-key']).toMatch(/^vd-[0-9a-f-]{36}$/);
      expect(req.headers['content-type']).toMatch(/application\/json/);
      expect(req.body).toMatchObject({ from: 'Ventidoc <no-reply@mail.havehub.com.ng>', subject: expect.any(String) });
      expect(req.body.to).toEqual([expect.stringMatching(/@example\.test$/)]);
      expect(String(req.body.text)).toContain('/verify-email#token=');
      expect(String(req.body.html)).toContain('If you did not create a Ventidoc account');
    });
  });

  describe('delivery lifecycle (Resend stand-in)', () => {
    let providerId: string;
    let invitingOrg: TestOrg;
    beforeAll(async () => {
      // Created while the capture provider is still active (signUp waits for the verification mail).
      invitingOrg = await createOrg(app, await signUp(app, 'lifecycle-owner'), 'lifecycle-org');
      await fresh(superAdmin);
      const p = await api(superAdmin).post('/providers', { kind: 'RESEND', name: 'resend-lifecycle', settings: { apiBaseUrl: `http://127.0.0.1:${resend.port}`, timeoutMs: 1000 } }).expect(201);
      providerId = p.body.id;
      await api(superAdmin).put(`/providers/${providerId}/secret`, { secret: RESEND_KEY }).expect(200);
      resend.domains = [{ name: 'mail.havehub.com.ng', status: 'verified' }];
    });
    beforeEach(async () => {
      await fresh(superAdmin);
      // Mail queued by earlier tests (e.g. admins' MFA notices held while sending was off) must not
      // reach this stand-in: it would consume scripted replies and add to request counts.
      await platformSql((c) => c.query("UPDATE email_outbox SET status = 'DISCARDED', locked_until = NULL, locked_by = NULL, updated_at = now() WHERE status IN ('PENDING', 'PROCESSING')"), 'worker');
      resend.requests = [];
      resend.queue = [];
      await api(superAdmin).post(`/providers/${providerId}/activate`).expect(200);
      await api(superAdmin).post(`/providers/${providerId}/check`).expect(200);
      await api(superAdmin).patch('/settings', { retryMaxAttempts: 3, retryBaseDelaySeconds: 1, retryMaxDelaySeconds: 1 }).expect(200);
      await api(superAdmin).post('/sending', { enabled: true }).expect(200);
    });
    afterAll(() => restore());

    // Users are created directly: with Resend active, the capture-based signUp helper would wait forever.
    const notice = async (label: string) => {
      const u = await app.get(PrismaService).user.create({ data: { email: uniqueEmail(label), displayName: label } });
      return app.get(EmailService).enqueue({ type: 'security.notice', userId: u.id, notice: 'mfa_enabled' });
    };

    it('retries retryable failures with back-off, then succeeds; attempts are recorded and content wiped', async () => {
      resend.queue = [{ status: 503, body: { name: 'unavailable', message: 'try later' } }, { status: 429, body: { name: 'rate_limit', message: 'slow' } }];
      const id = await notice('retry-ok');
      await waitForJob(id, 'SENT', 15_000);
      const attempts = await platformSql((c) => c.query('SELECT outcome::text, error_code FROM email_delivery_attempts WHERE outbox_id = $1 ORDER BY started_at', [id]).then((r) => r.rows));
      expect(attempts.map((a) => a.outcome)).toEqual(['RETRYABLE', 'RETRYABLE', 'SENT']);
      const row = await job(id);
      expect(row).toMatchObject({ attempts: 3, payload: {}, sensitive_ciphertext: null });
      expect(row.content_wiped_at).not.toBeNull();
      // Every retry reused the same idempotency key.
      expect(new Set(resend.emails().map((r) => r.headers['idempotency-key'])).size).toBe(1);
    });

    it('a retryable failure keeps the encrypted invitation token for the retry; it is wiped only after delivery', async () => {
      // Driven step by step so the intermediate state is observed deterministically.
      const worker = app.get(EmailWorker);
      await worker.stop();
      try {
        resend.queue = [{ status: 503, body: { name: 'unavailable', message: 'try later' } }];
        const to = uniqueEmail('invite-retry');
        const token = 'invitation-token-kept-across-retries';
        const id = await app.get(TenantDb).inOrgUnchecked(invitingOrg.id, invitingOrg.owner.userId, (tx) =>
          app.get(EmailService).enqueue({ type: 'org.invitation', organizationId: invitingOrg.id, email: to, orgName: 'Lifecycle', inviterName: 'Owner', sensitive: { invitationToken: token } }, tx));
        await worker.runOnce();
        const afterFailure = await job(id);
        expect(afterFailure).toMatchObject({ status: 'PENDING', attempts: 1, last_error_code: expect.any(String), content_wiped_at: null });
        expect(afterFailure.sensitive_ciphertext).toMatch(/^v1:/);
        expect(afterFailure.sensitive_ciphertext).not.toContain(token);
        expect(afterFailure.payload).toMatchObject({ orgName: 'Lifecycle' });

        await platformSql((c) => c.query('UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1', [id]), 'worker');
        await worker.runOnce();
        const delivered = await job(id);
        expect(delivered).toMatchObject({ status: 'SENT', attempts: 2, payload: {}, sensitive_ciphertext: null });
        expect(delivered.content_wiped_at).not.toBeNull();
        const sends = resend.emails().filter((r) => (r.body.to as string[])[0] === to);
        expect(sends).toHaveLength(2);
        // The retry carried the same link and the same idempotency key.
        for (const r of sends) expect(String(r.body.text)).toContain(`/accept-invitation#token=${token}`);
        expect(new Set(sends.map((r) => r.headers['idempotency-key'])).size).toBe(1);
      } finally {
        worker.start();
      }
    });

    it('permanent failures dead-letter immediately; an administrator can retry them in a controlled way', async () => {
      resend.queue = [{ status: 422, body: { name: 'validation_error', message: `Invalid from address, key ${RESEND_KEY}` } }];
      const id = await notice('perm-fail');
      await waitForJob(id, 'FAILED');
      const row = await job(id);
      expect(row.attempts).toBe(1);
      expect(row.last_error).not.toContain(RESEND_KEY); // sanitized
      expect(row.last_error).toContain('re_[redacted]');
      await fresh(superAdmin);
      const view = await api(superAdmin).get(`/deliveries/${id}`).expect(200);
      expect(view.body).not.toHaveProperty('payload');
      expect(view.body).not.toHaveProperty('sensitiveCiphertext');
      await api(superAdmin).post(`/deliveries/${id}/retry`).expect(200);
      await waitForJob(id, 'SENT');
      expect((await api(superAdmin).post(`/deliveries/${id}/retry`)).status).toBe(409); // only FAILED can be retried
    });

    it('stops after the maximum attempts (dead letter)', async () => {
      resend.queue = [503, 503, 503, 503].map((s) => ({ status: s, body: { name: 'unavailable' } }));
      const id = await notice('max-attempts');
      await waitForJob(id, 'FAILED', 15_000);
      expect((await job(id)).attempts).toBe(3);
    });

    it('a provider timeout is recorded as AMBIGUOUS and retried with the same idempotency key', async () => {
      resend.queue = [{ status: 200, body: { id: 'late' }, delayMs: 2500 }];
      const id = await notice('ambiguous');
      await waitForJob(id, 'SENT', 15_000);
      const outcomes = await platformSql((c) => c.query('SELECT outcome::text FROM email_delivery_attempts WHERE outbox_id = $1 ORDER BY started_at', [id]).then((r) => r.rows.map((x) => x.outcome)));
      expect(outcomes[0]).toBe('AMBIGUOUS');
      expect(outcomes.at(-1)).toBe('SENT');
      const keys = resend.emails().filter((r) => r.body.subject === 'Two-step verification is on').map((r) => r.headers['idempotency-key']);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(new Set(keys).size).toBe(1);
    });

    it('time-sensitive jobs expire unsent', async () => {
      // Pause delivery so the job is still pending when it becomes overdue.
      await app.get(EmailWorker).stop();
      try {
        const id = await notice('expiry');
        await platformSql((c) => c.query("UPDATE email_outbox SET expires_at = now() - interval '1 second' WHERE id = $1", [id]), 'worker');
        app.get(EmailWorker).start();
        await waitForJob(id, 'EXPIRED');
        const row = await job(id);
        expect(row).toMatchObject({ payload: {}, sensitive_ciphertext: null, sent_at: null });
        expect(resend.emails()).toHaveLength(0);
      } finally {
        app.get(EmailWorker).start();
      }
    });
  });

  describe('workers', () => {
    afterAll(async () => {
      app.get(EmailWorker).start();
    });

    it('several workers process every job exactly once', async () => {
      await app.get(EmailWorker).stop();
      const extra = [await createTestApp({ EMAIL_WORKER_MODE: 'off' }), await createTestApp({ EMAIL_WORKER_MODE: 'off' }), await createTestApp({ EMAIL_WORKER_MODE: 'off' })];
      try {
        const target = await app.get(PrismaService).user.create({ data: { email: uniqueEmail('conc'), displayName: 'c' } });
        const ids: string[] = [];
        for (let i = 0; i < 30; i++) ids.push(await app.get(EmailService).enqueue({ type: 'security.notice', userId: target.id, notice: 'mfa_disabled' }));
        const workers = extra.map((a) => a.get(EmailWorker));
        await Promise.all(workers.map(async (w) => { for (let i = 0; i < 15; i++) await w.runOnce(5); }));
        const rows = await platformSql((c) => c.query('SELECT status::text, attempts FROM email_outbox WHERE id = ANY($1::uuid[])', [ids]).then((r) => r.rows));
        expect(rows.every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
        const keys = capturedEmails.filter((m) => m.to === target.email).map((m) => m.idempotencyKey);
        expect(keys).toHaveLength(30);
        expect(new Set(keys).size).toBe(30);
      } finally {
        for (const a of extra) await a.close();
      }
    });

    it('the lease of a crashed worker is reclaimed; the interrupted attempt is recorded as AMBIGUOUS', async () => {
      await app.get(EmailWorker).stop();
      const target = await app.get(PrismaService).user.create({ data: { email: uniqueEmail('crash'), displayName: 'c' } });
      const id = await app.get(EmailService).enqueue({ type: 'security.notice', userId: target.id, notice: 'mfa_enabled' });
      // A worker claimed it and died: PROCESSING with an expired lease.
      await platformSql((c) => c.query("UPDATE email_outbox SET status = 'PROCESSING', attempts = 1, locked_by = 'dead', locked_until = now() - interval '1 second' WHERE id = $1", [id]), 'worker');
      app.get(EmailWorker).start();
      await waitForJob(id, 'SENT');
      const outcomes = await platformSql((c) => c.query('SELECT outcome::text, error_code FROM email_delivery_attempts WHERE outbox_id = $1 ORDER BY started_at', [id]).then((r) => r.rows));
      expect(outcomes[0]).toEqual({ outcome: 'AMBIGUOUS', error_code: 'worker_lost' });
      expect(outcomes.at(-1).outcome).toBe('SENT');
    });

    it('delivery does not depend on Redis', async () => {
      const t = redisTarget(process.env.REDIS_URL as string);
      const proxy = new TcpProxy(t.host, t.port);
      const port = await proxy.start();
      const noRedis = await createTestApp({ REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string) });
      try {
        await proxy.refuse();
        const target = await app.get(PrismaService).user.create({ data: { email: uniqueEmail('noredis'), displayName: 'n' } });
        await noRedis.get(EmailService).enqueue({ type: 'security.notice', userId: target.id, notice: 'mfa_enabled' });
        await waitFor(() => mailsTo(target.email).length === 1, 8000);
      } finally {
        await noRedis.close();
        await proxy.stop();
      }
    });
  });

  describe('flows, privacy and tenant safety', () => {
    let org: TestOrg;
    beforeAll(async () => {
      org = await createOrg(app, await signUp(app, 'email-owner'), 'email-org');
    });

    it('known and unknown addresses get identical responses; unknown intents are discarded, never delivered', async () => {
      const known = await signUp(app, 'generic-known');
      const unknown = uniqueEmail('generic-unknown');
      const a = await http(app).post('/v1/auth/password/forgot').send({ email: known.email });
      const b = await http(app).post('/v1/auth/password/forgot').send({ email: unknown });
      expect({ status: a.status, body: a.body }).toEqual({ status: b.status, body: b.body });
      const r1 = await http(app).post('/v1/auth/register').send({ email: known.email, password: PASSWORD, displayName: 'x' });
      const r2 = await http(app).post('/v1/auth/register').send({ email: uniqueEmail('generic-new'), password: PASSWORD, displayName: 'x' });
      expect({ status: r1.status, body: r1.body }).toEqual({ status: r2.status, body: r2.body });
      const c1 = await http(app).post('/v1/auth/verify-email/resend').send({ email: known.email });
      const c2 = await http(app).post('/v1/auth/verify-email/resend').send({ email: unknown });
      expect({ status: c1.status, body: c1.body }).toEqual({ status: c2.status, body: c2.body });
      await waitFor(() => mailsTo(known.email).some((m) => m.text.includes('/reset-password')), 8000);
      await new Promise((r) => setTimeout(r, 300));
      expect(mailsTo(unknown)).toHaveLength(0);
      const discarded = await platformSql((c) => c.query("SELECT status::text FROM email_outbox WHERE recipient_email = $1", [unknown]).then((r) => r.rows.map((x) => x.status)));
      expect(discarded.every((s) => s === 'DISCARDED')).toBe(true);
    });

    it('invitations use the transactional outbox, escape tenant data, and wipe content after delivery', async () => {
      const prisma = app.get(PrismaService);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.org_id', ${org.id}, true), set_config('app.user_id', ${org.owner.userId}, true)`;
        await tx.organization.update({ where: { id: org.id }, data: { name: '<b>Evil & Co</b>' } });
      });
      const email = uniqueEmail('invitee');
      await http(app).post(`/v1/orgs/${org.id}/invitations`).set(bearer(org.owner)).send({ email }).expect(201);
      await waitFor(() => mailsTo(email).length === 1, 8000);
      const mail = mailsTo(email)[0];
      expect(mail.html).toContain('&lt;b&gt;Evil &amp; Co&lt;/b&gt;');
      expect(mail.html).not.toContain('<b>Evil');
      expect(mail.text).toContain('This invitation is personal');
      // The capture adapter records the message before the worker marks the job SENT and wipes it.
      const outboxRow = () => platformSql((c) => c.query('SELECT * FROM email_outbox WHERE recipient_email = $1', [email]).then((r) => r.rows[0]));
      await waitFor(async () => (await outboxRow())?.status === 'SENT', 8000, 50);
      const row = await outboxRow();
      expect(row).toMatchObject({ status: 'SENT', organization_id: org.id, payload: {}, sensitive_ciphertext: null, template_version: 1 });
      // Rolled-back business transaction: no email.
      const rolledBack = uniqueEmail('rolled-back');
      await expect(app.get(TenantDb).inOrgUnchecked(org.id, org.owner.userId, async (tx) => {
        await app.get(EmailService).enqueue({ type: 'org.invitation', organizationId: org.id, email: rolledBack, orgName: 'x', inviterName: 'y', sensitive: { invitationToken: 't' } }, tx);
        throw new Error('business failure');
      })).rejects.toThrow('business failure');
      expect((await platformSql((c) => c.query('SELECT count(*)::int AS n FROM email_outbox WHERE recipient_email = $1', [rolledBack]))).rows[0].n).toBe(0);
    });

    it('organizations cannot read any outbox or attempt rows, nor enqueue for another organization', async () => {
      const other = await createOrg(app, await signUp(app, 'email-other-owner'), 'email-other');
      const pool = pools.app();
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [org.id, org.owner.userId]);
        expect((await c.query('SELECT count(*)::int AS n FROM email_outbox')).rows[0].n).toBe(0);
        expect((await c.query('SELECT count(*)::int AS n FROM email_delivery_attempts')).rows[0].n).toBe(0);
        await expect(c.query(
          `INSERT INTO email_outbox (id, event_type, template_key, organization_id, recipient_email, expires_at, idempotency_key)
           VALUES (gen_random_uuid(), 'org.invitation', 'org.invitation', $1, 'x@example.test', now() + interval '1 hour', 'smuggle-1')`, [other.id],
        )).rejects.toThrow(/row-level security/);
      } finally {
        await c.query('ROLLBACK');
        c.release();
        await pool.end();
      }
    });

    it('platform delivery views carry operational metadata only (masked recipient, no content)', async () => {
      await fresh(superAdmin);
      const list = await api(superAdmin).get('/deliveries?limit=200').expect(200);
      expect(list.body.length).toBeGreaterThan(0);
      for (const d of list.body) {
        expect(d).not.toHaveProperty('payload');
        expect(d).not.toHaveProperty('sensitiveCiphertext');
        if (d.recipientEmail) expect(d.recipientEmail).toMatch(/^.\*\*\*@/);
      }
      await api(superAdmin).get('/metrics').expect(200);
    });
  });

  describe('templates', () => {
    afterAll(async () => {
      await fresh(superAdmin);
      await api(superAdmin).post('/templates/auth.signup_attempt/versions/1/activate').expect(200);
    });

    it('rejects unsafe or incomplete versions; an activated version is used and recorded per job', async () => {
      await fresh(superAdmin);
      const bad1 = await api(superAdmin).post('/templates/auth.verify_email/versions', { subject: 'x', text: 'no link here', html: '<p>no link</p>' });
      expect(bad1.status).toBe(400);
      const bad2 = await api(superAdmin).post('/templates/auth.signup_attempt/versions', { subject: 'x', text: 'ok', html: '<p onmouseover="steal()">x</p>' });
      expect(bad2.status).toBe(400);
      const bad3 = await api(superAdmin).post('/templates/auth.signup_attempt/versions', { subject: 'x', text: '{{#each users}}x{{/each}}', html: '<p>x</p>' });
      expect(bad3.status).toBe(400);
      expect((await api(superAdmin).post('/templates/unknown.key/versions', { subject: 'x', text: 'y', html: '<p>z</p>' })).status).toBe(404);
      const v2 = await api(superAdmin).post('/templates/auth.signup_attempt/versions', { subject: 'Signup attempt (v2)', text: 'Version two body.', html: '<p>Version two body.</p>' }).expect(201);
      expect(v2.body).toMatchObject({ version: 2, status: 'DRAFT' });
      const preview = await api(superAdmin).post('/templates/auth.signup_attempt/preview', { version: 2 }).expect(200);
      expect(preview.body.text).toContain('Version two body.');
      expect(preview.body.text).toContain('Ventidoc will never ask for your password');
      await api(superAdmin).post('/templates/auth.signup_attempt/versions/2/activate').expect(200);
      const existing = await signUp(app, 'tpl-v2');
      await http(app).post('/v1/auth/register').send({ email: existing.email, password: PASSWORD, displayName: 'x' }).expect(202);
      await waitFor(() => mailsTo(existing.email).some((m) => m.subject === 'Signup attempt (v2)'), 8000);
      const row = await platformSql((c) => c.query("SELECT template_version FROM email_outbox WHERE recipient_email = $1 AND template_key = 'auth.signup_attempt'", [existing.email]).then((r) => r.rows[0]));
      expect(row.template_version).toBe(2);
    });
  });

  describe('test sends', () => {
    it('only to the requesting administrator or an allow-listed recipient, even while sending is off', async () => {
      await fresh(superAdmin);
      await api(superAdmin).post('/sending', { enabled: false }).expect(200);
      try {
        expect((await api(superAdmin).post('/test-send', { to: 'stranger@example.test' })).status).toBe(403);
        const r = await api(superAdmin).post('/test-send', { to: superAdmin.email }).expect(202);
        await waitFor(() => mailsTo(superAdmin.email).some((m) => m.subject === 'Ventidoc email test'), 8000);
        expect(r.body.jobId).toBeDefined();
        await api(superAdmin).patch('/settings', { testRecipients: ['qa-inbox@example.test'] }).expect(200);
        await api(superAdmin).post('/test-send', { to: 'QA-Inbox@example.test' }).expect(202);
      } finally {
        await restore();
      }
    });
  });

  describe('SMTP adapter against a real SMTP server', () => {
    let server: SMTPServer;
    let port: number;
    const received: { from: string; to: string[]; data: string; user?: string }[] = [];
    beforeAll(async () => {
      server = new SMTPServer({
        authOptional: false,
        disabledCommands: ['STARTTLS'],
        onAuth: (auth, _s, cb) => (auth.username === 'mailer' && auth.password === 'smtp-test-password' ? cb(null, { user: 'mailer' }) : cb(new Error('bad credentials'))),
        onData: (stream, session, cb) => {
          let data = '';
          stream.on('data', (c) => (data += c));
          stream.on('end', () => {
            received.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as { address: string }).address : '', to: session.envelope.rcptTo.map((r) => r.address), data, user: session.user as string });
            cb();
          });
        },
        logger: false,
      });
      server.on('error', () => undefined);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.server.address() as { port: number }).port;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it('delivers with authentication; sender, reply-to and Message-ID are set', async () => {
      const a = new SmtpAdapter();
      const settings = a.validateSettings({ host: 'localhost', port, security: 'none', username: 'mailer' }, false);
      const res = await a.send({
        from: { email: 'no-reply@mail.havehub.com.ng', name: 'Ventidoc' }, replyTo: 'support@mail.havehub.com.ng', to: 'person@example.test',
        subject: 'SMTP test', text: 'hello', html: '<p>hello</p>', idempotencyKey: 'vd-smtp-1',
      }, { settings, secret: 'smtp-test-password', production: false });
      expect(res.messageId).toContain('vd-smtp-1');
      const msg = received.at(-1)!;
      expect(msg).toMatchObject({ from: 'no-reply@mail.havehub.com.ng', to: ['person@example.test'], user: 'mailer' });
      expect(msg.data).toMatch(/Reply-To: support@mail\.havehub\.com\.ng/i);
      expect(msg.data).toMatch(/Message-ID: <vd-smtp-1@ventidoc\.email>/i);
      const bad = await a.check({ settings, secret: 'wrong', production: false });
      expect(bad.ok).toBe(false);
      expect(bad.summary).not.toContain('wrong');
    });

    it('never downgrades: STARTTLS required but not offered fails instead of sending in clear', async () => {
      const a = new SmtpAdapter();
      const settings = a.validateSettings({ host: 'localhost', port, security: 'starttls', username: 'mailer' }, false);
      const before = received.length;
      await expect(a.send({ from: { email: 'a@b.test', name: 'x' }, to: 'p@example.test', subject: 's', text: 't', html: '<p>h</p>', idempotencyKey: 'vd-2' },
        { settings, secret: 'smtp-test-password', production: false })).rejects.toMatchObject({ kind: expect.stringMatching(/permanent|retryable/) });
      expect(received.length).toBe(before);
    });

    it('verifies certificates by default: a self-signed TLS server is refused', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vd-smtp-'));
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
      const tls = new SMTPServer({ secure: true, key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')), authOptional: true, onData: (s, _x, cb) => { s.resume(); s.on('end', () => cb()); }, logger: false });
      // The client aborts the handshake; without a listener the server's error event would
      // tear the socket down first and the client would see a reset instead of the cert error.
      tls.on('error', () => undefined);
      // Bind and connect by IP: "localhost" may resolve to ::1 on one side and 127.0.0.1 on the
      // other, and a refused connection is (correctly) retryable, never reaching the TLS check.
      await new Promise<void>((r) => tls.listen(0, '127.0.0.1', r));
      try {
        const a = new SmtpAdapter();
        const settings = a.validateSettings({ host: '127.0.0.1', port: (tls.server.address() as { port: number }).port, security: 'tls' }, false);
        await expect(a.send({ from: { email: 'a@b.test', name: 'x' }, to: 'p@example.test', subject: 's', text: 't', html: '<p>h</p>', idempotencyKey: 'vd-3' },
          { settings, secret: null, production: false })).rejects.toMatchObject({ kind: 'permanent', summary: expect.stringMatching(/certificate/i) });
      } finally {
        await new Promise<void>((r) => tls.close(() => r()));
      }
    });
  });

  describe('Resend adapter contract', () => {
    it('classifies responses and reports restricted keys honestly', async () => {
      const a = new ResendAdapter();
      const ctx = { settings: a.validateSettings({ apiBaseUrl: `http://127.0.0.1:${resend.port}`, timeoutMs: 1000 }, false), secret: RESEND_KEY, production: false };
      const m = { from: { email: 'no-reply@mail.havehub.com.ng', name: 'V' }, to: 'p@example.test', subject: 's', text: 't', html: '<p>h</p>', idempotencyKey: 'vd-k' };
      for (const [status, kind] of [[400, 'permanent'], [401, 'permanent'], [403, 'permanent'], [422, 'permanent'], [409, 'retryable'], [429, 'retryable'], [500, 'retryable'], [503, 'retryable']] as const) {
        resend.queue = [{ status, body: { name: 'x', message: 'y' } }];
        await expect(a.send(m, ctx)).rejects.toMatchObject({ kind });
      }
      resend.domainsReply = { status: 401, body: { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' } };
      try {
        const r = await a.check(ctx, 'mail.havehub.com.ng');
        expect(r).toMatchObject({ ok: true, domainVerified: null });
      } finally {
        resend.domainsReply = null;
      }
      // A closed (allowed) port: connection refused, nothing sent, safe to retry.
      const closed = createServer();
      await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
      const closedPort = (closed.address() as { port: number }).port;
      await new Promise<void>((r) => closed.close(() => r()));
      await expect(a.send(m, { ...ctx, settings: { ...ctx.settings, apiBaseUrl: `http://127.0.0.1:${closedPort}` } })).rejects.toMatchObject({ kind: 'retryable' });
      // A port fetch refuses outright is a configuration error, not a transient one.
      await expect(a.send(m, { ...ctx, settings: { ...ctx.settings, apiBaseUrl: 'http://127.0.0.1:1' } })).rejects.toMatchObject({ kind: 'permanent' });
    });
  });
});

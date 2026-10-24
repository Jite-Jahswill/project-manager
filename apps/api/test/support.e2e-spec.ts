/**
 * Customer support: authorization (API and RLS), lifecycle, concurrency, idempotency,
 * real-time delivery and catch-up, attachments, notifications and audit.
 * Real PostgreSQL and Redis (docs/architecture/09-support.md, docs/security/support.md).
 */
import { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { PoolClient } from 'pg';
import { PrismaService } from '../src/database/prisma.service';
import { EmailWorker } from '../src/email/email-worker.service';
import { canTransition, SUPPORT_STATUSES } from '../src/support/lifecycle';
import { SupportRealtimeService } from '../src/support/support-realtime.service';
import {
  bearer, createOrg, createTestApp, enableMfa, http, login, mailsTo, PASSWORD, pools, resetDatabase, signUp, TestUser,
} from './support/harness';
import { redisTarget, redisUrlVia, TcpProxy, waitFor } from './support/tcp-proxy';

jest.setTimeout(120_000);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

interface SseEvent { type: string; data: Record<string, unknown> }

/** Minimal server-sent-events client over a raw HTTP connection. */
function openStream(app: INestApplication, path: string, user: { token: string }) {
  const { port } = app.getHttpServer().address() as { port: number };
  const events: SseEvent[] = [];
  let status = 0;
  let ended = false;
  let buffer = '';
  const req = httpRequest({ host: '127.0.0.1', port, path, headers: { authorization: `Bearer ${user.token}`, accept: 'text/event-stream' } }, (res) => {
    status = res.statusCode ?? 0;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let type = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) type = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) events.push({ type, data: JSON.parse(data) as Record<string, unknown> });
      }
    });
    res.on('end', () => { ended = true; });
    res.on('close', () => { ended = true; });
  });
  req.on('error', () => { ended = true; });
  req.end();
  return {
    events,
    get status() { return status; },
    get ended() { return ended; },
    ready: () => waitFor(() => events.some((e) => e.type === 'ready'), 5000),
    next: async (type: string, pred: (d: Record<string, unknown>) => boolean = () => true, timeoutMs = 5000) => {
      await waitFor(() => events.some((e) => e.type === type && pred(e.data)), timeoutMs);
      return events.find((e) => e.type === type && pred(e.data))!.data;
    },
    close: () => req.destroy(),
  };
}

describe('Customer support', () => {
  let app: INestApplication;
  let customerA: TestUser;
  let customerB: TestUser;
  let supportAdmin: TestUser;
  let agent: TestUser;
  let agent2: TestUser;
  let inboxOnly: TestUser;
  const streams: { close(): void }[] = [];

  const cust = (u: TestUser) => ({
    get: (p: string) => http(app).get(`/v1/support${p}`).set(bearer(u)),
    post: (p: string, body: object = {}) => http(app).post(`/v1/support${p}`).set(bearer(u)).send(body),
  });
  const staff = (u: TestUser) => ({
    get: (p: string) => http(app).get(`/v1/platform/support${p}`).set(bearer(u)),
    post: (p: string, body: object = {}) => http(app).post(`/v1/platform/support${p}`).set(bearer(u)).send(body),
    patch: (p: string, body: object) => http(app).patch(`/v1/platform/support${p}`).set(bearer(u)).send(body),
  });

  async function makeStaff(label: string, roleNames: string[]): Promise<TestUser> {
    const user = await signUp(app, label);
    await app.get(PrismaService).$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
      await tx.platformAdmin.create({ data: { userId: user.userId } });
      for (const name of roleNames) {
        const role = await tx.platformRole.findUniqueOrThrow({ where: { name } });
        await tx.platformAdminRole.create({ data: { adminUserId: user.userId, roleId: role.id } });
      }
    });
    await enableMfa(app, user);
    return user;
  }

  async function newConversation(u: TestUser, subject = 'Cannot export report', body = 'The export button does nothing.') {
    const r = await cust(u).post('/conversations', { subject, body, category: 'TECHNICAL' }).expect(201);
    return r.body as { id: string; reference: string; status: string };
  }

  function assign(conversationId: string, to: string | null, expected: string | null, by = supportAdmin, reason?: string) {
    return staff(by).post(`/conversations/${conversationId}/assignment`, { assigneeUserId: to, expectedAssigneeUserId: expected, ...(reason ? { reason } : {}) });
  }

  async function versionOf(conversationId: string): Promise<number> {
    return (await staff(supportAdmin).get(`/conversations/${conversationId}`).expect(200)).body.version;
  }

  /** Runs `fn` as the runtime role in an explicit RLS context. */
  async function asAppRole<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
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

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    customerA = await signUp(app, 'sup-customer-a');
    customerB = await signUp(app, 'sup-customer-b');
    supportAdmin = await makeStaff('sup-admin', ['Support administrator']);
    agent = await makeStaff('sup-agent', ['Support agent']);
    agent2 = await makeStaff('sup-agent-2', ['Support agent']);
    // A custom role: may read the inbox but not assign.
    await app.get(PrismaService).$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
      const role = await tx.platformRole.create({ data: { name: `Inbox reader ${Date.now()}`, description: 'test' } });
      await tx.platformRolePermission.createMany({ data: [{ roleId: role.id, permissionKey: 'platform.support.inbox.read' }] });
      inboxOnly = await signUp(app, 'sup-inbox-only');
      await tx.platformAdmin.create({ data: { userId: inboxOnly.userId } });
      await tx.platformAdminRole.create({ data: { adminUserId: inboxOnly.userId, roleId: role.id } });
    });
    await enableMfa(app, inboxOnly);
  });
  afterAll(async () => {
    for (const s of streams) s.close();
    await app.close();
  });

  describe('customer isolation', () => {
    it("customer A cannot read or change customer B's conversation, messages or attachments", async () => {
      const b = await newConversation(customerB, 'B private', 'B secret text');
      const upload = await http(app).post(`/v1/support/conversations/${b.id}/attachments`).set(bearer(customerB))
        .set('content-type', 'image/png').set('x-file-name', 'b.png').send(PNG).expect(201);
      const ca = cust(customerA);
      await ca.get(`/conversations/${b.id}`).expect(404);
      await ca.get(`/conversations/${b.id}/messages`).expect(404);
      await ca.get(`/conversations/${b.id}/messages?afterSeq=0`).expect(404);
      await ca.post(`/conversations/${b.id}/messages`, { body: 'intrusion' }).expect(404);
      await ca.post(`/conversations/${b.id}/read`, { upToSeq: 1 }).expect(404);
      await ca.post(`/conversations/${b.id}/reopen`).expect(404);
      await http(app).post(`/v1/support/conversations/${b.id}/attachments`).set(bearer(customerA)).set('content-type', 'image/png').send(PNG).expect(404);
      await ca.get(`/attachments/${upload.body.id}/content`).expect(404);
      // A's own attachment cannot be attached to B's conversation, nor B's to A's.
      const a = await newConversation(customerA);
      await ca.post(`/conversations/${a.id}/messages`, { body: 'steal', attachmentIds: [upload.body.id] }).expect(400);
      const listed = (await ca.get('/conversations').expect(200)).body.items.map((c: { id: string }) => c.id);
      expect(listed).toContain(a.id);
      expect(listed).not.toContain(b.id);
      // B's data is unchanged.
      const msgs = (await cust(customerB).get(`/conversations/${b.id}/messages`).expect(200)).body.items;
      expect(msgs.map((m: { body: string }) => m.body)).toEqual(['B secret text']);
    });

    it('customers cannot reach the platform support API', async () => {
      await staff(customerA).get('/conversations').expect(403);
      await staff(customerA).get('/metrics').expect(403);
    });
  });

  describe('tenant roles have no support access', () => {
    it("an organization owner cannot use the support inbox or see a member's conversation linked to the organization", async () => {
      const ownerUser = await signUp(app, 'sup-org-owner');
      const org = await createOrg(app, ownerUser, 'sup-org');
      const owner = org.owner;
      // The owner's own conversation linked to their organization works; context only.
      const linked = await cust(owner).post('/conversations', { subject: 'Linked', body: 'org context', organizationId: org.id }).expect(201);
      // A non-member cannot link the organization.
      await cust(customerA).post('/conversations', { subject: 'Fake link', body: 'x', organizationId: org.id }).expect(400);
      await staff(owner).get('/conversations').expect(403);
      await staff(owner).get(`/conversations/${linked.body.id}`).expect(403);
      // Database: in the organization's tenant context, nobody else's support rows are visible.
      const b = await newConversation(customerB);
      const seen = await asAppRole({ 'app.org_id': org.id, 'app.user_id': owner.userId }, async (c) =>
        (await c.query('SELECT id FROM support_conversations')).rows.map((r) => r.id));
      expect(seen).toEqual([linked.body.id]);
      expect(seen).not.toContain(b.id);
    });
  });

  describe('support administration', () => {
    it('a support administrator lists the inbox, assigns and reassigns (with a reason), and sees assignment history', async () => {
      const c = await newConversation(customerA, 'Assignment flow');
      const inbox = await staff(supportAdmin).get('/conversations?assignee=unassigned&status=NEW').expect(200);
      expect(inbox.body.items.map((x: { id: string }) => x.id)).toContain(c.id);
      const first = await assign(c.id, agent.userId, null).expect(200);
      expect(first.body.assignee.userId).toBe(agent.userId);
      // Reassignment needs a reason, and the current assignee as the expected value.
      expect((await assign(c.id, agent2.userId, agent.userId)).body.code).toBe('reason_required');
      await assign(c.id, agent2.userId, agent.userId, supportAdmin, 'Agent 1 is out today').expect(200);
      const history = await staff(supportAdmin).get(`/conversations/${c.id}/assignments`).expect(200);
      expect(history.body.items.map((h: { from: { userId: string } | null; to: { userId: string } | null; reason: string | null }) =>
        [h.from?.userId ?? null, h.to?.userId ?? null, h.reason])).toEqual([[null, agent.userId, null], [agent.userId, agent2.userId, 'Agent 1 is out today']]);
      const events = await staff(supportAdmin).get(`/conversations/${c.id}/events`).expect(200);
      expect(events.body.items.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'ASSIGNED', 'REASSIGNED']);
      // Only staff who hold platform.support.assigned.access can be assignees.
      expect((await assign(c.id, customerB.userId, agent2.userId, supportAdmin, 'not staff')).body.code).toBe('invalid_assignee');
      expect((await assign(c.id, inboxOnly.userId, agent2.userId, supportAdmin, 'no agent access')).body.code).toBe('invalid_assignee');
    });

    it('concurrent assignment: exactly one of two administrators wins; the other gets 409', async () => {
      const c = await newConversation(customerA, 'Race');
      const [r1, r2] = await Promise.all([assign(c.id, agent.userId, null), assign(c.id, agent2.userId, null)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      expect(loser.body.code).toBe('assignment_conflict');
      const rows = await asAppRole({ 'app.user_id': supportAdmin.userId }, async (q) =>
        (await q.query('SELECT count(*)::int AS n FROM support_assignments WHERE conversation_id = $1', [c.id])).rows[0].n);
      expect(rows).toBe(1);
    });

    it('an administrator without platform.support.assign can read the inbox but cannot assign', async () => {
      const c = await newConversation(customerA, 'No assign');
      await staff(inboxOnly).get(`/conversations/${c.id}`).expect(200);
      await assign(c.id, agent.userId, null, inboxOnly).expect(403);
      await staff(inboxOnly).post(`/conversations/${c.id}/messages`, { body: 'x' }).expect(403);
      await staff(inboxOnly).get(`/conversations/${c.id}/notes`).expect(403);
      // The database refuses too (trigger), even if the API check were skipped.
      await expect(asAppRole({ 'app.user_id': inboxOnly.userId }, (q) =>
        q.query('UPDATE support_conversations SET assignee_user_id = $1 WHERE id = $2', [agent.userId, c.id]))).rejects.toThrow(/platform.support.assign/);
    });
  });

  describe('assigned agents', () => {
    it('see only their assigned conversations; cannot browse the inbox, assign, or reach others', async () => {
      const mine = await newConversation(customerA, 'For agent');
      const unassigned = await newConversation(customerA, 'Unassigned');
      const others = await newConversation(customerB, 'For agent 2');
      await assign(mine.id, agent.userId, null).expect(200);
      await assign(others.id, agent2.userId, null).expect(200);
      const s = staff(agent);
      const list = (await s.get('/conversations').expect(200)).body.items.map((x: { id: string }) => x.id);
      expect(list).toContain(mine.id);
      expect(list).not.toContain(unassigned.id);
      expect(list).not.toContain(others.id);
      await s.get('/conversations?assignee=unassigned').expect(403);
      await s.get(`/conversations/${unassigned.id}`).expect(404);
      await s.get(`/conversations/${others.id}/messages`).expect(404);
      await s.post(`/conversations/${others.id}/messages`, { body: 'not mine' }).expect(404);
      await s.post(`/conversations/${unassigned.id}/notes`, { body: 'x' }).expect(404);
      await s.get('/metrics').expect(403);
      await assign(mine.id, agent.userId, null, agent).expect(403);
      // Working the assigned one is allowed.
      await s.get(`/conversations/${mine.id}`).expect(200);
      await s.post(`/conversations/${mine.id}/messages`, { body: 'Looking into it' }).expect(201);
      // Reassigned away: access ends immediately.
      await assign(mine.id, agent2.userId, agent.userId, supportAdmin, 'rebalancing').expect(200);
      await s.get(`/conversations/${mine.id}`).expect(404);
      // RLS agrees: as the agent, the database exposes no conversation they are not assigned to.
      const visible = await asAppRole({ 'app.user_id': agent.userId }, async (q) => (await q.query('SELECT id FROM support_conversations')).rows.map((r) => r.id));
      expect(visible).not.toContain(mine.id);
      expect(visible).not.toContain(unassigned.id);
    });
  });

  describe('internal notes', () => {
    it('are never returned by customer APIs or customer streams, and are invisible to customers in the database', async () => {
      const c = await newConversation(customerA, 'Notes');
      await assign(c.id, agent.userId, null).expect(200);
      const customerStream = openStream(app, '/v1/support/stream', customerA);
      const staffStream = openStream(app, '/v1/platform/support/stream', agent);
      streams.push(customerStream, staffStream);
      await customerStream.ready();
      await staffStream.ready();
      const NOTE = 'INTERNAL: customer seems to be on the legacy plan';
      const note = await staff(agent).post(`/conversations/${c.id}/notes`, { body: NOTE }).expect(201);
      await staffStream.next('note.created', (d) => d.noteId === note.body.note.id);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'Public reply' }).expect(201);
      await customerStream.next('message.created', (d) => d.conversationId === c.id);
      expect(JSON.stringify(customerStream.events)).not.toContain(note.body.note.id);
      expect(JSON.stringify(customerStream.events)).not.toContain('INTERNAL');
      expect(customerStream.events.some((e) => e.type === 'note.created')).toBe(false);
      for (const res of [
        await cust(customerA).get(`/conversations/${c.id}`).expect(200),
        await cust(customerA).get(`/conversations/${c.id}/messages`).expect(200),
        await cust(customerA).get('/conversations').expect(200),
      ]) expect(JSON.stringify(res.body)).not.toContain('INTERNAL');
      expect((await cust(customerA).get(`/conversations/${c.id}`)).body.lastMessagePreview).toBe('Public reply');
      // Staff see the note.
      expect((await staff(agent).get(`/conversations/${c.id}/notes`).expect(200)).body.items.map((n: { body: string }) => n.body)).toEqual([NOTE]);
      // Database: the customer's context sees no notes at all.
      const n = await asAppRole({ 'app.user_id': customerA.userId }, async (q) => (await q.query('SELECT count(*)::int AS n FROM support_internal_notes')).rows[0].n);
      expect(n).toBe(0);
      // The customer email for the reply does not contain the note or the reply text.
      await waitFor(() => mailsTo(customerA.email).some((m) => m.subject.includes(c.reference)), 8000);
      for (const m of mailsTo(customerA.email)) {
        expect(`${m.subject}\n${m.text}\n${m.html}`).not.toContain('INTERNAL');
        expect(`${m.subject}\n${m.text}`).not.toContain('Public reply');
      }
    });
  });

  describe('lifecycle and concurrency', () => {
    it('follows the documented status rules and validates transitions server-side', async () => {
      const c = await newConversation(customerA, 'Lifecycle');
      expect(c.status).toBe('NEW');
      await assign(c.id, agent.userId, null).expect(200);
      expect((await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'Hi' }).expect(201)).body.conversation.status).toBe('PENDING_CUSTOMER');
      expect((await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'Still broken' }).expect(201)).body.conversation.status).toBe('PENDING_SUPPORT');
      // Priority is internal triage: never shown to the customer, by API or stream.
      const custStream = openStream(app, '/v1/support/stream', customerA);
      streams.push(custStream);
      await custStream.ready();
      await staff(agent).patch(`/conversations/${c.id}`, { version: await versionOf(c.id), priority: 'LOW' }).expect(200);
      const updated = await custStream.next('conversation.updated', (d) => d.conversationId === c.id);
      expect(updated).toEqual({ conversationId: c.id, status: 'PENDING_SUPPORT', category: 'TECHNICAL' });
      const own = (await cust(customerA).get(`/conversations/${c.id}`)).body;
      expect(own).not.toHaveProperty('priority');
      expect(own).not.toHaveProperty('assignee');
      expect(own).not.toHaveProperty('version');
      // Optimistic concurrency on attribute changes.
      const v = await versionOf(c.id);
      await staff(agent).patch(`/conversations/${c.id}`, { version: v, status: 'RESOLVED' }).expect(200);
      expect((await staff(agent).patch(`/conversations/${c.id}`, { version: v, priority: 'HIGH' })).body.code).toBe('version_conflict');
      await cust(customerA).post(`/conversations/${c.id}/reopen`).expect(200);
      expect((await cust(customerA).get(`/conversations/${c.id}`)).body.status).toBe('PENDING_SUPPORT');
      // A customer reply to a resolved conversation reopens it.
      await staff(agent).patch(`/conversations/${c.id}`, { version: await versionOf(c.id), status: 'RESOLVED' }).expect(200);
      await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'It came back' }).expect(201);
      expect((await cust(customerA).get(`/conversations/${c.id}`)).body.status).toBe('PENDING_SUPPORT');
      // Closed is terminal.
      await staff(agent).patch(`/conversations/${c.id}`, { version: await versionOf(c.id), status: 'CLOSED' }).expect(200);
      expect((await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'hello?' })).body.code).toBe('conversation_closed');
      expect((await cust(customerA).post(`/conversations/${c.id}/reopen`)).body.code).toBe('conversation_closed');
      expect((await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'x' })).body.code).toBe('conversation_closed');
      expect((await staff(agent).patch(`/conversations/${c.id}`, { version: await versionOf(c.id), status: 'OPEN' })).body.code).toBe('conversation_closed');
      const events = (await staff(supportAdmin).get(`/conversations/${c.id}/events`).expect(200)).body.items.map((e: { type: string }) => e.type);
      expect(events).toEqual(expect.arrayContaining(['CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'REOPENED']));
      // Status emails name only the reference.
      await waitFor(() => mailsTo(customerA.email).some((m) => m.subject === `Your support request ${c.reference} was closed`), 8000);
    });

    it('invalid transitions are refused; the database transition rule matches the API rule for every pair', async () => {
      const c = await newConversation(customerA, 'Transitions');
      await staff(supportAdmin).patch(`/conversations/${c.id}`, { version: 1, status: 'RESOLVED' }).expect(200);
      // RESOLVED -> NEW is not a valid transition.
      expect((await staff(supportAdmin).patch(`/conversations/${c.id}`, { version: 2, status: 'NEW' })).body.code).toBe('invalid_transition');
      const pairs = await asAppRole({}, async (q) => (await q.query(
        `SELECT a AS from, b AS to, app_support_status_transition_ok(a, b) AS ok FROM unnest($1::text[]) a, unnest($1::text[]) b`, [SUPPORT_STATUSES])).rows);
      expect(pairs).toHaveLength(36);
      for (const p of pairs) expect({ ...p, api: canTransition(p.from, p.to) }).toEqual({ ...p, api: p.ok });
    });

    it('message sends are idempotent per clientMessageId, including concurrent retries', async () => {
      const c = await newConversation(customerA, 'Idempotency');
      const send = () => cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'Once only', clientMessageId: 'client-123' });
      const results = await Promise.all([send(), send(), send()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201]);
      expect(new Set(results.map((r) => r.body.message.id)).size).toBe(1);
      expect(results.filter((r) => r.body.duplicate).length).toBe(2);
      expect((await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'Different', clientMessageId: 'client-123' })).body.code).toBe('idempotency_conflict');
      const msgs = (await cust(customerA).get(`/conversations/${c.id}/messages`).expect(200)).body.items;
      expect(msgs.map((m: { seq: number; body: string }) => [m.seq, m.body])).toEqual([[1, 'The export button does nothing.'], [2, 'Once only']]);
    });

    it('concurrent messages get distinct, gap-free sequence numbers', async () => {
      const c = await newConversation(customerA, 'Sequence');
      await Promise.all(Array.from({ length: 10 }, (_, i) => cust(customerA).post(`/conversations/${c.id}/messages`, { body: `m${i}` }).expect(201)));
      const seqs = (await cust(customerA).get(`/conversations/${c.id}/messages?limit=100`).expect(200)).body.items.map((m: { seq: number }) => m.seq);
      expect(seqs).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    });

    it('message bodies are plain text: markup is stored and returned verbatim as JSON strings', async () => {
      const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
      const c = await newConversation(customerA, '<b>bold</b> subject', evil);
      const res = await cust(customerA).get(`/conversations/${c.id}/messages`).expect(200).expect('content-type', /application\/json/);
      expect(res.body.items[0].body).toBe(evil);
      expect((await cust(customerA).get(`/conversations/${c.id}`)).body.subject).toBe('<b>bold</b> subject');
    });
  });

  describe('unread state', () => {
    it('tracks unread per party, across sessions, without counting one\'s own messages', async () => {
      const c = await newConversation(customerA, 'Unread');
      await assign(c.id, agent.userId, null).expect(200);
      expect((await staff(agent).get('/unread').expect(200)).body).toMatchObject({ messages: expect.any(Number) });
      const agentBefore = (await staff(agent).get(`/conversations/${c.id}`)).body.unreadCount;
      expect(agentBefore).toBe(1);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'r1' }).expect(201);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'r2' }).expect(201);
      expect((await cust(customerA).get(`/conversations/${c.id}`)).body.unreadCount).toBe(2);
      expect((await staff(agent).get(`/conversations/${c.id}`)).body.unreadCount).toBe(0);
      // A second session of the customer gets the read position in real time.
      const second = await login(app, customerA.email);
      const stream = openStream(app, '/v1/support/stream', second);
      streams.push(stream);
      await stream.ready();
      const read = await cust(customerA).post(`/conversations/${c.id}/read`, { upToSeq: 999 }).expect(200);
      expect(read.body.lastReadSeq).toBe(3);
      await stream.next('read.updated', (d) => d.conversationId === c.id && d.lastReadSeq === 3);
      expect((await cust(second).get(`/conversations/${c.id}`)).body.unreadCount).toBe(0);
      // Read markers never move backwards.
      expect((await cust(customerA).post(`/conversations/${c.id}/read`, { upToSeq: 1 }).expect(200)).body.lastReadSeq).toBe(3);
      // The customer sees that support read up to the latest message.
      expect((await cust(customerA).get(`/conversations/${c.id}`)).body.readBySupportUpToSeq).toBe(3);
    });
  });

  describe('real-time delivery', () => {
    it('delivers to the customer and the assigned agent only, across API instances, and enforces visibility per event', async () => {
      const second = await createTestApp();
      try {
        const c = await newConversation(customerA, 'Realtime');
        await assign(c.id, agent.userId, null).expect(200);
        // Streams on another instance: Redis fans events out.
        const s = (p: string, u: TestUser) => { const x = openStream(second, p, u); streams.push(x); return x; };
        const aStream = s('/v1/support/stream', customerA);
        const bStream = s('/v1/support/stream', customerB);
        const agentStream = s('/v1/platform/support/stream', agent);
        const agent2Stream = s('/v1/platform/support/stream', agent2);
        const adminStream = s('/v1/platform/support/stream', supportAdmin);
        await Promise.all([aStream, bStream, agentStream, agent2Stream, adminStream].map((x) => x.ready()));
        await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'Realtime hello' }).expect(201);
        const toAgent = await agentStream.next('message.created', (d) => d.conversationId === c.id);
        expect((toAgent.message as { body: string }).body).toBe('Realtime hello');
        await adminStream.next('message.created', (d) => d.conversationId === c.id);
        const reply = await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'Realtime reply' }).expect(201);
        const toCustomer = await aStream.next('message.created', (d) => (d.message as { id: string }).id === reply.body.message.id);
        expect(toCustomer.message).not.toHaveProperty('author'); // no staff identity for customers
        // Reassignment: agent 2 gains access, agent 1 learns only that access ended.
        await assign(c.id, agent2.userId, agent.userId, supportAdmin, 'handover').expect(200);
        expect(await agentStream.next('conversation.assigned', (d) => d.conversationId === c.id)).toEqual({ conversationId: c.id, access: 'revoked' });
        await agent2Stream.next('conversation.assigned', (d) => d.conversationId === c.id && d.assigneeUserId === agent2.userId);
        await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'After handover' }).expect(201);
        await agent2Stream.next('message.created', (d) => (d.message as { body: string }).body === 'After handover');
        await new Promise((r) => setTimeout(r, 300));
        expect(JSON.stringify(bStream.events)).not.toContain(c.id);
        expect(agentStream.events.filter((e) => e.type === 'message.created' && JSON.stringify(e.data).includes('After handover'))).toEqual([]);
      } finally {
        await second.close();
      }
    });

    it('streams require authentication and support permissions, and end when the session is revoked', async () => {
      const anon = openStream(app, '/v1/support/stream', { token: 'invalid' });
      streams.push(anon);
      await waitFor(() => anon.status === 401, 5000);
      const notStaff = openStream(app, '/v1/platform/support/stream', customerB);
      streams.push(notStaff);
      await waitFor(() => notStaff.status === 403, 5000);
      const session = await login(app, customerB.email);
      const stream = openStream(app, '/v1/support/stream', session);
      streams.push(stream);
      await stream.ready();
      await http(app).post('/v1/auth/logout').set(bearer(session)).send({ refreshToken: session.refreshToken }).expect(204);
      expect(await stream.next('end', () => true, 5000)).toEqual({ reason: 'session_ended' });
      await waitFor(() => stream.ended, 5000);
    });

    it('a staff stream ends when the support role is removed', async () => {
      const temp = await makeStaff('sup-temp-agent', ['Support agent']);
      const stream = openStream(app, '/v1/platform/support/stream', temp);
      streams.push(stream);
      await stream.ready();
      await app.get(PrismaService).$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
        await tx.platformAdminRole.deleteMany({ where: { adminUserId: temp.userId } });
      });
      expect(await stream.next('end', () => true, 5000)).toEqual({ reason: 'access_revoked' });
    });

    it('shutting down while the event subscriber reconnects leaves no unhandled rejection', async () => {
      // Regression (phase 4 gate): ioredis' automatic re-subscription after a reconnect issued
      // SELECT/SUBSCRIBE without handlers; closing the connection at that moment rejected them with
      // "Connection is closed." and nothing caught it (an unhandled rejection can stop Node).
      // ioredis emits 'ready' just before re-subscribing, so closing from a 'ready' listener hits
      // exactly that window, deterministically.
      const rejections: unknown[] = [];
      const onRejection = (e: unknown) => rejections.push(e);
      process.on('unhandledRejection', onRejection);
      const t = redisTarget(process.env.REDIS_URL as string);
      const proxy = new TcpProxy(t.host, t.port);
      const port = await proxy.start();
      const flaky = await createTestApp({ REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string), REDIS_COMMAND_TIMEOUT_MS: '200' });
      try {
        const rt = flaky.get(SupportRealtimeService);
        await waitFor(() => rt.realtimeAvailable, 5000);
        const sub = (rt as unknown as { subscriber: { once(e: string, f: () => void): void; disconnect(): void } }).subscriber;
        await proxy.refuse();
        await waitFor(() => !rt.realtimeAvailable, 5000);
        sub.once('ready', () => sub.disconnect()); // shutdown lands mid-resubscribe
        await proxy.resume();
        await new Promise((r) => setTimeout(r, 3000));
      } finally {
        await flaky.close();
        await proxy.stop();
        await new Promise((r) => setTimeout(r, 100));
        process.off('unhandledRejection', onRejection);
      }
      expect(rejections.map(String)).toEqual([]);
    });

    it('after a Redis outage the subscriber re-subscribes by itself and events flow again', async () => {
      const t = redisTarget(process.env.REDIS_URL as string);
      const proxy = new TcpProxy(t.host, t.port);
      const port = await proxy.start();
      const flaky = await createTestApp({ REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string), REDIS_COMMAND_TIMEOUT_MS: '200' });
      try {
        const rt = flaky.get(SupportRealtimeService);
        await waitFor(() => rt.realtimeAvailable, 5000);
        await proxy.refuse();
        await waitFor(() => !rt.realtimeAvailable, 5000);
        await proxy.resume();
        await waitFor(() => rt.realtimeAvailable, 10_000);
        const c = await newConversation(customerA, 'After outage');
        const stream = openStream(flaky, '/v1/support/stream', customerA);
        streams.push(stream);
        expect(await stream.next('ready')).toMatchObject({ realtime: true });
        // Published by the main instance, received by the recovered one.
        await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'delivered after recovery' }).expect(201);
        await stream.next('message.created', (d) => (d.message as { body: string }).body === 'delivered after recovery');
      } finally {
        await flaky.close();
        await proxy.stop();
      }
    });

    it('fallback: without Redis, messages are persisted first and a reconnecting client catches up with afterSeq', async () => {
      const c = await newConversation(customerA, 'Fallback');
      // An API instance whose Redis is unreachable: real-time is unavailable, writes still work.
      const noRedis = await createTestApp({ REDIS_URL: 'redis://:x@127.0.0.1:1/1', REDIS_CONNECT_TIMEOUT_MS: '200' });
      try {
        const stream = openStream(noRedis, '/v1/support/stream', customerA);
        streams.push(stream);
        expect(await stream.next('ready')).toMatchObject({ realtime: false });
        const before = (await cust(customerA).get(`/conversations/${c.id}`)).body.latestSeq;
        for (const body of ['offline 1', 'offline 2']) {
          await http(noRedis).post(`/v1/support/conversations/${c.id}/messages`).set(bearer(customerA)).send({ body }).expect(201);
        }
        expect(noRedis.get(SupportRealtimeService).counters.publishFailed).toBeGreaterThanOrEqual(2);
        // Creating conversations and uploading fail closed without the shared limiter.
        await http(noRedis).post('/v1/support/conversations').set(bearer(customerA)).send({ subject: 's', body: 'b' }).expect(503);
        await http(noRedis).post(`/v1/support/conversations/${c.id}/attachments`).set(bearer(customerA)).set('content-type', 'image/png').send(PNG).expect(503);
        // Catch-up through the API (the documented reconnect strategy).
        const missed = await cust(customerA).get(`/conversations/${c.id}/messages?afterSeq=${before}`).expect(200);
        expect(missed.body.items.map((m: { body: string }) => m.body)).toEqual(['offline 1', 'offline 2']);
        expect(missed.body.latestSeq).toBe(before + 2);
      } finally {
        await noRedis.close();
      }
    });
  });

  describe('attachments', () => {
    it('validates type by content, stores privately under server keys, and serves only to authorized readers with inert headers', async () => {
      const c = await newConversation(customerA, 'Attachments');
      await assign(c.id, agent.userId, null).expect(200);
      const up = (u: TestUser, body: Buffer, type: string, name = 'file') =>
        http(app).post(`/v1/support/conversations/${c.id}/attachments`).set(bearer(u)).set('content-type', type).set('x-file-name', name).send(body);
      expect((await up(customerA, Buffer.from('MZ\x90\x00 not really a pdf'), 'application/pdf')).body.code).toBe('attachment_type_mismatch');
      expect((await up(customerA, Buffer.from('<html></html>'), 'text/html')).status).toBe(415);
      expect((await up(customerA, Buffer.alloc(10 * 1024 * 1024 + 1, 0x41), 'text/plain')).status).toBe(413);
      const ok = await up(customerA, PNG, 'image/png', encodeURIComponent('../../screenshot é.png')).expect(201);
      expect(ok.body).toEqual({ id: expect.any(String), fileName: 'screenshot é.png', contentType: 'image/png', sizeBytes: PNG.length, createdAt: expect.any(String) });
      expect(JSON.stringify(ok.body)).not.toContain('support/');
      // On disk under the configured root, at a server-generated key.
      const dir = join(process.env.SUPPORT_STORAGE_DIR!, 'support', c.id);
      expect(existsSync(dir) && readdirSync(dir)).toEqual([ok.body.id]);
      // Unsent: the uploader can fetch it; nobody else on the customer side.
      const dl = await cust(customerA).get(`/attachments/${ok.body.id}/content`).expect(200);
      expect(dl.headers['content-type']).toBe('image/png');
      expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="screenshot _.png"; filename\*=UTF-8''screenshot%20%C3%A9.png$/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-security-policy']).toContain('sandbox');
      expect(dl.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
      await cust(customerB).get(`/attachments/${ok.body.id}/content`).expect(404);
      // Sent with a message: listed on the message; the assigned agent (attachments.read) can download it.
      const sent = await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'see screenshot', attachmentIds: [ok.body.id] }).expect(201);
      expect(sent.body.message.attachments.map((x: { id: string }) => x.id)).toEqual([ok.body.id]);
      await http(app).get(`/v1/platform/support/attachments/${ok.body.id}/content`).set(bearer(agent)).expect(200);
      // Unrelated staff cannot; an inbox reader without attachments.read is refused by the guard.
      await http(app).get(`/v1/platform/support/attachments/${ok.body.id}/content`).set(bearer(agent2)).expect(404);
      await http(app).get(`/v1/platform/support/attachments/${ok.body.id}/content`).set(bearer(inboxOnly)).expect(403);
      // Already sent: cannot be attached again.
      await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'again', attachmentIds: [ok.body.id] }).expect(400);
      // Staff replies can carry attachments too.
      const staffUp = await http(app).post(`/v1/platform/support/conversations/${c.id}/attachments`).set(bearer(agent))
        .set('content-type', 'text/plain').set('x-file-name', 'steps.txt').send(Buffer.from('1. Open settings')).expect(201);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'steps attached', attachmentIds: [staffUp.body.id] }).expect(201);
      await cust(customerA).get(`/attachments/${staffUp.body.id}/content`).expect(200);
      // The database cannot be pointed at a client-chosen path.
      await expect(asAppRole({ 'app.user_id': customerA.userId }, (q) => q.query(
        `INSERT INTO support_attachments (id, conversation_id, uploader_user_id, uploader_kind, storage_key, file_name, content_type, size_bytes, sha256)
         VALUES (gen_random_uuid(), $1, $2, 'CUSTOMER', '../../etc/passwd', 'x', 'text/plain', 1, repeat('a', 64))`, [c.id, customerA.userId]))).rejects.toThrow(/support_attachments_storage_key/);
    });
  });

  describe('database-side protections', () => {
    it('customers cannot assign, change status or priority, post as staff, or edit history, even with direct SQL', async () => {
      const c = await newConversation(customerA, 'DB guard');
      const asA = (sql: string, params: unknown[] = []) => asAppRole({ 'app.user_id': customerA.userId }, (q) => q.query(sql, params));
      await expect(asA('UPDATE support_conversations SET assignee_user_id = $1 WHERE id = $2', [agent.userId, c.id])).rejects.toThrow(/platform.support.assign/);
      await expect(asA("UPDATE support_conversations SET status = 'RESOLVED' WHERE id = $1", [c.id])).rejects.toThrow(/not permitted/);
      await expect(asA("UPDATE support_conversations SET priority = 'URGENT' WHERE id = $1", [c.id])).rejects.toThrow(/status.manage/);
      await expect(asA("UPDATE support_conversations SET support_read_seq = 1 WHERE id = $1", [c.id])).rejects.toThrow(/support staff/);
      await expect(asA("UPDATE support_conversations SET subject = 'changed' WHERE id = $1", [c.id])).rejects.toThrow(/immutable/);
      // Even with a correctly allocated seq, posting as STAFF is refused by RLS.
      await expect(asAppRole({ 'app.user_id': customerA.userId }, async (q) => {
        await q.query('UPDATE support_conversations SET message_seq = message_seq + 1 WHERE id = $1', [c.id]);
        await q.query("INSERT INTO support_messages (conversation_id, seq, author_user_id, author_kind, body) VALUES ($1, 2, $2, 'STAFF', 'fake staff')", [c.id, customerA.userId]);
      })).rejects.toThrow(/row-level security/);
      await expect(asA('UPDATE support_conversations SET message_seq = message_seq + 5 WHERE id = $1', [c.id])).rejects.toThrow(/one at a time/);
      await expect(asA(
        "INSERT INTO support_messages (conversation_id, seq, author_user_id, author_kind, body) VALUES ($1, 7, $2, 'CUSTOMER', 'bad seq')",
        [c.id, customerA.userId])).rejects.toThrow(/seq must be allocated/);
      await expect(asA("UPDATE support_messages SET body = 'edited' WHERE conversation_id = $1", [c.id])).rejects.toThrow(/permission denied|append-only/);
      await expect(asA('DELETE FROM support_messages WHERE conversation_id = $1', [c.id])).rejects.toThrow(/permission denied/);
      // Customers cannot create a pre-assigned or pre-resolved conversation.
      await expect(asA(
        "INSERT INTO support_conversations (id, reference, customer_user_id, subject, status) VALUES (gen_random_uuid(), 'SUP-ABCDEFGH', $1, 's', 'RESOLVED')",
        [customerA.userId])).rejects.toThrow(/row-level security/);
      // A user context with no support rights sees only its own conversations.
      const plain = await asAppRole({ 'app.user_id': customerB.userId }, async (q) =>
        (await q.query('SELECT customer_user_id FROM support_conversations')).rows.map((r) => r.customer_user_id));
      expect(new Set(plain)).toEqual(new Set([customerB.userId]));
      // No context: nothing at all.
      const none = await asAppRole({}, async (q) => (await q.query('SELECT count(*)::int AS n FROM support_conversations')).rows[0].n);
      expect(none).toBe(0);
    });

    it('history tables are append-only: no UPDATE/DELETE privilege, mutation triggers for every role, owner bound by RLS', async () => {
      const c = await newConversation(customerA, 'Append only');
      await assign(c.id, agent.userId, null).expect(200);
      const asAdmin = (sql: string) => asAppRole({ 'app.user_id': supportAdmin.userId }, (q) => q.query(sql, [c.id]));
      for (const t of ['support_conversation_events', 'support_assignments', 'support_messages', 'support_internal_notes']) {
        await expect(asAdmin(`UPDATE ${t} SET created_at = now() WHERE conversation_id = $1`)).rejects.toThrow(/permission denied/);
        await expect(asAdmin(`DELETE FROM ${t} WHERE conversation_id = $1`)).rejects.toThrow(/permission denied/);
      }
      const pool = pools.migrator();
      try {
        const triggers = (await pool.query(
          "SELECT tgrelid::regclass::text AS t FROM pg_trigger WHERE tgname LIKE '%append_only' AND tgrelid::regclass::text LIKE 'support_%' ORDER BY 1")).rows.map((r) => r.t);
        expect(triggers).toEqual(['support_assignments', 'support_conversation_events', 'support_internal_notes', 'support_messages']);
        // FORCEd RLS: the owner sees no rows (no policy applies to it), so it cannot change history through DML either.
        expect((await pool.query('SELECT count(*)::int AS n FROM support_conversation_events')).rows[0].n).toBe(0);
        const forced = (await pool.query("SELECT relname FROM pg_class WHERE relname LIKE 'support_%' AND relkind = 'r' AND relforcerowsecurity ORDER BY 1")).rows.map((r) => r.relname);
        expect(forced).toHaveLength(7);
      } finally {
        await pool.end();
      }
    });
  });

  describe('notifications', () => {
    it('are queued through the outbox, coalesced until read, and name only the reference', async () => {
      const c = await newConversation(customerA, 'Notify');
      await assign(c.id, agent.userId, null).expect(200);
      await waitFor(() => mailsTo(agent.email).some((m) => m.subject === `Support conversation ${c.reference} was assigned to you`), 8000);
      const replies = () => mailsTo(customerA.email).filter((m) => m.subject === `New reply to your support request ${c.reference}`).length;
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'SECRET-DETAIL first reply' }).expect(201);
      await waitFor(() => replies() === 1, 8000);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'second reply' }).expect(201);
      await new Promise((r) => setTimeout(r, 500));
      expect(replies()).toBe(1); // coalesced: the customer has not read the first one yet
      await cust(customerA).post(`/conversations/${c.id}/read`, { upToSeq: 99 }).expect(200);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'third reply' }).expect(201);
      await waitFor(() => replies() === 2, 8000);
      // The assignee hears about customer messages.
      await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'customer update' }).expect(201);
      await waitFor(() => mailsTo(agent.email).some((m) => m.subject === `New customer message on ${c.reference}`), 8000);
      for (const m of [...mailsTo(customerA.email), ...mailsTo(agent.email)]) {
        expect(`${m.subject}\n${m.text}\n${m.html}`).not.toMatch(/SECRET-DETAIL|customer update|Notify/);
      }
      const link = mailsTo(customerA.email).find((m) => m.subject.includes(c.reference))!.text;
      expect(link).toContain(`/support/conversations/${c.id}`);
    });

    it('a message is kept even when email cannot be sent (the outbox holds the notification)', async () => {
      const c = await newConversation(customerA, 'No email');
      await app.get(EmailWorker).stop();
      try {
        const reply = await staff(supportAdmin).post(`/conversations/${c.id}/messages`, { body: 'saved regardless' }).expect(201);
        const persisted = (await cust(customerA).get(`/conversations/${c.id}/messages`)).body.items.map((m: { id: string }) => m.id);
        expect(persisted).toContain(reply.body.message.id);
        const pending = await asAppRole({ 'app.email_worker': 'on' }, async (q) => (await q.query(
          "SELECT count(*)::int AS n FROM email_outbox WHERE event_type = 'support.reply' AND status = 'PENDING' AND payload->>'conversationId' = $1", [c.id])).rows[0].n);
        expect(pending).toBe(1);
      } finally {
        app.get(EmailWorker).start();
      }
    });
  });

  describe('inbox queries, metrics and audit', () => {
    it('filters, searches safely, sorts and paginates with stable cursors', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await newConversation(customerB, `Paginate ${i} 100%_match`)).id);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: { body: { items: { id: string }[]; nextCursor: string | null } } =
          await staff(supportAdmin).get(`/conversations?q=Paginate&limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
        seen.push(...res.body.items.map((x) => x.id));
        cursor = res.body.nextCursor;
      } while (cursor);
      expect(new Set(seen)).toEqual(new Set(ids));
      expect(seen).toHaveLength(5);
      // LIKE wildcards in the search are literal.
      const wild = await staff(supportAdmin).get('/conversations?q=%25').expect(200);
      for (const x of wild.body.items) expect(x.subject).toContain('%');
      const ref = (await staff(supportAdmin).get(`/conversations/${ids[0]}`)).body.reference;
      expect((await staff(supportAdmin).get(`/conversations?q=${ref.toLowerCase()}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([ids[0]]);
      const asc = (await staff(supportAdmin).get('/conversations?q=Paginate&sort=created&order=asc').expect(200)).body.items.map((x: { id: string }) => x.id);
      expect(asc).toEqual(ids);
      await staff(supportAdmin).get('/conversations?cursor=garbage').expect(400);
      await staff(supportAdmin).get('/conversations?status=NOT_A_STATUS').expect(400);
    });

    it('reports queue metrics and assignable staff to inbox administrators only', async () => {
      const m = await staff(supportAdmin).get('/metrics').expect(200);
      expect(m.body).toMatchObject({ byStatus: expect.any(Object), unassignedActive: expect.any(Number), urgentActive: expect.any(Number) });
      const assignees = (await staff(supportAdmin).get('/assignees').expect(200)).body.items.map((x: { userId: string }) => x.userId);
      expect(assignees).toEqual(expect.arrayContaining([agent.userId, agent2.userId, supportAdmin.userId]));
      expect(assignees).not.toContain(inboxOnly.userId);
      await staff(agent).get('/assignees').expect(403);
    });

    it('audits administrative views and changes without message content', async () => {
      const c = await newConversation(customerA, 'Audit', 'AUDIT-SECRET body');
      await staff(supportAdmin).get(`/conversations/${c.id}`).expect(200);
      await assign(c.id, agent.userId, null).expect(200);
      await staff(agent).post(`/conversations/${c.id}/notes`, { body: 'AUDIT-SECRET note' }).expect(201);
      await staff(agent).post(`/conversations/${c.id}/messages`, { body: 'AUDIT-SECRET reply' }).expect(201);
      const rows = await asAppRole({ 'app.platform_scope': 'on' }, async (q) => (await q.query(
        'SELECT action, organization_id, metadata::text AS m, before::text AS b, after::text AS a FROM audit_events WHERE resource_id = $1 ORDER BY occurred_at', [c.id])).rows);
      expect(rows.map((r) => r.action)).toEqual([
        'support.conversation.created', 'platform.support.conversation.viewed', 'platform.support.assigned', 'platform.support.note_added', 'platform.support.replied',
      ]);
      for (const r of rows) {
        expect(r.organization_id).toBeNull();
        expect(`${r.m} ${r.b} ${r.a}`).not.toContain('AUDIT-SECRET');
      }
    });
  });

  it('creating conversations is rate limited per user', async () => {
    const strict = await createTestApp({ RATE_LIMIT_OVERRIDES: 'support.conversation.user=2/1h' });
    try {
      const u = await login(strict, customerB.email);
      for (let i = 0; i < 2; i++) await http(strict).post('/v1/support/conversations').set(bearer(u)).send({ subject: `rl ${i}`, body: 'x' }).expect(201);
      const limited = await http(strict).post('/v1/support/conversations').set(bearer(u)).send({ subject: 'rl 3', body: 'x' });
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    } finally {
      await strict.close();
    }
  });

  it('validation rejects unknown fields and oversized bodies', async () => {
    const c = await newConversation(customerA, 'Validation');
    await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'x', authorKind: 'STAFF' }).expect(400);
    await cust(customerA).post('/conversations', { subject: 'x', body: 'y', assigneeUserId: agent.userId }).expect(400);
    await cust(customerA).post(`/conversations/${c.id}/messages`, { body: 'x'.repeat(10_001) }).expect(400);
    await cust(customerA).post(`/conversations/${c.id}/messages`, { body: '   ' }).expect(400);
    expect(PASSWORD).toBeDefined();
  });
});

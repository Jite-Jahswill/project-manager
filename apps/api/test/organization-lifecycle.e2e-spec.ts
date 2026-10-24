/**
 * Phase 3: organization onboarding, branch lifecycle, invitations and memberships.
 * Complements rbac.e2e-spec.ts (delegation and owner rules), tenant-isolation.e2e-spec.ts,
 * review-regressions.e2e-spec.ts and the route-generated authorization sweeps.
 * Real PostgreSQL and Redis.
 */
import { INestApplication } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PoolClient } from 'pg';
import { platformPermissionsOf } from '../src/authz/platform-access.guard';
import {
  addMember, bearer, createOrg, createTestApp, enableMfa, http, mailsTo, pools, resetDatabase, roleId, setPlan, signUp, TestOrg, TestUser, tokenFromMail,
  uniqueEmail,
} from './support/harness';
import { discoverRoutes, fillPath } from './support/routes';

jest.setTimeout(120_000);

describe('Organization lifecycle (phase 3)', () => {
  let app: INestApplication;
  let a: TestOrg;
  let b: TestOrg;

  const inOrg = (orgId: string, userId: string) => ({ 'app.org_id': orgId, 'app.user_id': userId });
  const as = (u: { token: string }) => ({
    get: (p: string) => http(app).get(p).set(bearer(u)),
    post: (p: string, body: object = {}) => http(app).post(p).set(bearer(u)).send(body),
    patch: (p: string, body: object) => http(app).patch(p).set(bearer(u)).send(body),
    put: (p: string, body: object) => http(app).put(p).set(bearer(u)).send(body),
  });

  /**
   * Direct SQL as the runtime role in an explicit RLS context. (The schema owner is bound by the
   * FORCEd tenant policies too, so it cannot be used to peek at or patch tenant rows.)
   */
  async function sql<T>(settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(settings)) await c.query('SELECT set_config($1, $2, true)', [k, v]);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
      await pool.end();
    }
  }

  /** A user who will become an owner sets up MFA first (owners must use it). */
  async function futureOwner(label: string): Promise<TestUser> {
    const u = await signUp(app, label);
    await enableMfa(app, u);
    return u;
  }

  async function branchOf(org: TestOrg, code: string, name = code) {
    return (await as(org.owner).post(`/v1/orgs/${org.id}/branches`, { name, code }).expect(201)).body as { id: string; version: number };
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp({}, [DiscoveryModule]);
    a = await createOrg(app, await signUp(app, 'p3-owner-a'), 'p3-a');
    b = await createOrg(app, await signUp(app, 'p3-owner-b'), 'p3-b');
    // Growth plan: room for several branches and members.
    await setPlan(a.id, 'growth');
    await setPlan(b.id, 'growth');
  });
  afterAll(() => app.close());

  describe('onboarding', () => {
    it('creates the organization with the caller as its only owner; client-supplied ownership fields are refused', async () => {
      const u = await futureOwner('p3-creator');
      const slug = `p3-new-${Date.now().toString(36)}`;
      await as(u).post('/v1/organizations', { name: 'New Co', slug, ownerUserId: a.owner.userId }).expect(400);
      await as(u).post('/v1/organizations', { name: 'New Co', slug, roles: ['Owner'] }).expect(400);
      const res = await as(u).post('/v1/organizations', { name: '  New Co  ', slug, defaultCurrency: 'NGN' }).expect(201);
      expect(res.body).toMatchObject({ name: 'New Co', slug, defaultCurrency: 'NGN', status: 'ACTIVE', version: 1, created: true, membershipId: expect.any(String) });
      const org = await as(u).get(`/v1/orgs/${res.body.id}`).expect(200);
      expect(org.body).toMatchObject({ isOwner: true, membershipId: res.body.membershipId });
      const members = (await as(u).get(`/v1/orgs/${res.body.id}/members`).expect(200)).body;
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ user: { id: u.userId }, roles: [expect.objectContaining({ roleName: 'Owner', branchId: null })] });
      const mine = (await as(u).get('/v1/me/organizations').expect(200)).body.map((o: { id: string }) => o.id);
      expect(mine).toEqual([res.body.id]);
      const branches = (await as(u).get(`/v1/orgs/${res.body.id}/branches`).expect(200)).body;
      expect(branches.map((x: { code: string; status: string }) => [x.code, x.status])).toEqual([['MAIN', 'ACTIVE']]);
    });

    it('a retried request returns the same organization; a different request for the same slug is a conflict', async () => {
      const u = await futureOwner('p3-retry');
      const slug = `p3-retry-${Date.now().toString(36)}`;
      const first = await as(u).post('/v1/organizations', { name: 'Retry Co', slug }).expect(201);
      const again = await as(u).post('/v1/organizations', { name: 'Retry Co', slug }).expect(200);
      expect(again.body).toMatchObject({ id: first.body.id, created: false, membershipId: first.body.membershipId });
      expect((await as(u).post('/v1/organizations', { name: 'Other name', slug })).body.code).toBe('slug_taken');
      const other = await futureOwner('p3-slug-thief');
      const stolen = await as(other).post('/v1/organizations', { name: 'Retry Co', slug });
      expect(stolen.status).toBe(409);
      expect(stolen.body).toEqual({ statusCode: 409, code: 'slug_taken', message: expect.any(String) });
      const created = await sql(inOrg(first.body.id, u.userId), async (c) => (await c.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'organization.created' AND resource_id = $1", [first.body.id])).rows[0].n);
      expect(created).toBe(1);
    });

    it('concurrent creation of one slug yields exactly one organization (same user: replays; different users: one conflict)', async () => {
      const u = await futureOwner('p3-burst');
      const slug = `p3-burst-${Date.now().toString(36)}`;
      const burst = await Promise.all([1, 2, 3].map(() => as(u).post('/v1/organizations', { name: 'Burst', slug })));
      expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(burst.map((r) => r.body.id)).size).toBe(1);
      const [x, y] = [await futureOwner('p3-race-x'), await futureOwner('p3-race-y')];
      const race = `p3-race-${Date.now().toString(36)}`;
      const results = await Promise.all([as(x).post('/v1/organizations', { name: 'Race', slug: race }), as(y).post('/v1/organizations', { name: 'Race', slug: race })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const rows = await sql({ 'app.platform_scope': 'on' }, async (c) => (await c.query('SELECT count(*)::int AS n FROM organizations WHERE slug = $1', [race])).rows[0].n);
      expect(rows).toBe(1);
    });

    it('organization creation is rate limited per user (each one starts a trial)', async () => {
      const strict = await createTestApp({ RATE_LIMIT_OVERRIDES: 'organization.create.user=1/1h' });
      try {
        const u = await signUp(strict, 'p3-farm');
        await http(strict).post('/v1/organizations').set(bearer(u)).send({ name: 'Farm 1', slug: `p3-farm1-${Date.now().toString(36)}` }).expect(201);
        await enableMfa(strict, u);
        const second = await http(strict).post('/v1/organizations').set(bearer(u)).send({ name: 'Farm 2', slug: `p3-farm2-${Date.now().toString(36)}` });
        expect(second.status).toBe(429);
      } finally {
        await strict.close();
      }
    });

    it('profile updates need organization.settings.manage and the current version; the slug never changes', async () => {
      const org = await as(a.owner).get(`/v1/orgs/${a.id}`).expect(200);
      const v = org.body.version;
      const updated = await as(a.owner).patch(`/v1/orgs/${a.id}`, { version: v, name: 'P3 A renamed', defaultCurrency: 'NGN' }).expect(200);
      expect(updated.body).toMatchObject({ name: 'P3 A renamed', defaultCurrency: 'NGN', version: v + 1, slug: org.body.slug });
      expect((await as(a.owner).patch(`/v1/orgs/${a.id}`, { version: v, name: 'stale' })).body.code).toBe('version_conflict');
      await as(a.owner).patch(`/v1/orgs/${a.id}`, { version: v + 1, slug: 'new-slug' }).expect(400);
      const cashier = await addMember(app, a, 'p3-cashier-profile', 'Cashier', a.mainBranchId);
      await as(cashier).patch(`/v1/orgs/${a.id}`, { version: v + 1, name: 'hijack' }).expect(403);
      await as(b.owner).patch(`/v1/orgs/${a.id}`, { version: v + 1, name: 'cross' }).expect(403);
      const audit = await as(a.owner).get(`/v1/orgs/${a.id}/audit-events`).expect(200);
      expect(audit.body.find((e: { action: string }) => e.action === 'organization.updated')).toMatchObject({
        before: { name: expect.any(String) }, after: { name: 'P3 A renamed', defaultCurrency: 'NGN' },
      });
    });
  });

  describe('branches', () => {
    it('creates, reads and edits branches with code uniqueness and optimistic concurrency', async () => {
      const br = await branchOf(a, 'P3-EDIT', 'Edit me');
      const got = await as(a.owner).get(`/v1/orgs/${a.id}/branches/${br.id}`).expect(200);
      expect(got.body).toMatchObject({ code: 'P3-EDIT', status: 'ACTIVE', version: 1, archivedAt: null });
      const edited = await as(a.owner).patch(`/v1/orgs/${a.id}/branches/${br.id}`, { version: 1, name: 'Edited', code: 'P3-EDITED' }).expect(200);
      expect(edited.body).toMatchObject({ name: 'Edited', code: 'P3-EDITED', version: 2 });
      expect((await as(a.owner).patch(`/v1/orgs/${a.id}/branches/${br.id}`, { version: 1, name: 'stale' })).body.code).toBe('version_conflict');
      expect((await as(a.owner).patch(`/v1/orgs/${a.id}/branches/${br.id}`, { version: 2, code: 'MAIN' })).body.code).toBe('branch_code_taken');
      expect((await as(a.owner).post(`/v1/orgs/${a.id}/branches`, { name: 'dup', code: 'P3-EDITED' })).body.code).toBe('branch_code_taken');
      // Another organization's branch is invisible under this organization's URL, and vice versa.
      await as(a.owner).get(`/v1/orgs/${a.id}/branches/${b.mainBranchId}`).expect(404);
      await as(a.owner).patch(`/v1/orgs/${a.id}/branches/${b.mainBranchId}`, { version: 1, name: 'x' }).expect(404);
      await as(b.owner).get(`/v1/orgs/${a.id}/branches/${br.id}`).expect(403);
      const manager = await addMember(app, a, 'p3-branch-manager', 'Branch manager', a.mainBranchId);
      await as(manager).patch(`/v1/orgs/${a.id}/branches/${br.id}`, { version: 2, name: 'no' }).expect(403);
    });

    it('archiving keeps history, blocks new transactions and branch-limited access, and revokes branch invitations; reactivation restores', async () => {
      const br = await branchOf(a, 'P3-ARCH');
      const product = await as(a.owner).post(`/v1/orgs/${a.id}/products`, { sku: `P3-${Date.now()}`, name: 'Widget' }).expect(201);
      const adjust = (key: string) => http(app).post(`/v1/orgs/${a.id}/branches/${br.id}/stock/adjustments`).set(bearer(a.owner))
        .set('Idempotency-Key', key).send({ productId: product.body.id, quantityDelta: '3', reason: 'opening stock' });
      await adjust(`p3-arch-${Date.now()}-1`).expect(201);
      const keeper = await addMember(app, a, 'p3-keeper', 'Storekeeper', br.id);
      await as(keeper).get(`/v1/orgs/${a.id}/branches/${br.id}/stock`).expect(200);
      const invitee = uniqueEmail('p3-branch-invitee');
      await as(a.owner).post(`/v1/orgs/${a.id}/invitations`, { email: invitee, roleId: await roleId(app, a, 'Cashier'), branchId: br.id }).expect(201);

      const archived = await as(a.owner).post(`/v1/orgs/${a.id}/branches/${br.id}/archive`, { version: 1 }).expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', version: 2, archivedAt: expect.any(String), revokedInvitations: 1 });
      // History is still there and readable by the organization.
      const movements = await as(a.owner).get(`/v1/orgs/${a.id}/branches/${br.id}/stock/movements`).expect(200);
      expect(movements.body.items).toHaveLength(1);
      // No new business writes at an archived branch.
      expect((await adjust(`p3-arch-${Date.now()}-2`)).body.code).toBe('branch_archived');
      // Branch-limited roles there confer nothing; new assignments there are refused.
      await as(keeper).get(`/v1/orgs/${a.id}/branches/${br.id}/stock`).expect(403);
      expect((await as(a.owner).put(`/v1/orgs/${a.id}/members/${keeper.membershipId}/roles`, {
        assignments: [{ roleId: await roleId(app, a, 'Storekeeper'), branchId: br.id }, { roleId: await roleId(app, a, 'Cashier'), branchId: br.id }],
      })).status).toBe(404);
      expect((await as(a.owner).get(`/v1/orgs/${a.id}/invitations`)).body.map((i: { email: string }) => i.email)).not.toContain(invitee);
      expect((await as(a.owner).patch(`/v1/orgs/${a.id}/branches/${br.id}`, { version: 2, name: 'x' })).body.code).toBe('branch_archived');
      expect((await as(a.owner).get(`/v1/orgs/${a.id}/branches?status=ARCHIVED`)).body.map((x: { id: string }) => x.id)).toContain(br.id);

      await as(a.owner).post(`/v1/orgs/${a.id}/branches/${br.id}/reactivate`, { version: 2 }).expect(200);
      await as(keeper).get(`/v1/orgs/${a.id}/branches/${br.id}/stock`).expect(200);
      await adjust(`p3-arch-${Date.now()}-3`).expect(201);
      const actions = (await as(a.owner).get(`/v1/orgs/${a.id}/audit-events?limit=100`)).body.filter((e: { resourceId: string }) => e.resourceId === br.id).map((e: { action: string }) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['organization.branch.created', 'organization.branch.archived', 'organization.branch.reactivated']));
    });

    it('the last active branch cannot be archived, even by concurrent requests', async () => {
      const owner = await futureOwner('p3-two-branches');
      const created = await as(owner).post('/v1/organizations', { name: 'Two branches', slug: `p3-two-${Date.now().toString(36)}` }).expect(201);
      const orgId = created.body.id;
      const main = (await as(owner).get(`/v1/orgs/${orgId}/branches`)).body[0];
      expect((await as(owner).post(`/v1/orgs/${orgId}/branches/${main.id}/archive`, { version: main.version })).body.code).toBe('last_active_branch');
      await setPlan(orgId, 'growth'); // the trial plan allows one branch
      const second = (await as(owner).post(`/v1/orgs/${orgId}/branches`, { name: 'Second', code: 'SECOND' }).expect(201)).body;
      const results = await Promise.all([
        as(owner).post(`/v1/orgs/${orgId}/branches/${main.id}/archive`, { version: main.version }),
        as(owner).post(`/v1/orgs/${orgId}/branches/${second.id}/archive`, { version: second.version }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('last_active_branch');
      const active = (await as(owner).get(`/v1/orgs/${orgId}/branches?status=ACTIVE`)).body;
      expect(active).toHaveLength(1);
    });

    it('the database refuses deleting organizations or branches and cross-organization branch references', async () => {
      const ctx = inOrg(a.id, a.owner.userId);
      await expect(sql(ctx, (c) => c.query('DELETE FROM branches WHERE id = $1', [a.mainBranchId]))).rejects.toThrow(/permission denied/);
      await expect(sql(ctx, (c) => c.query('DELETE FROM organizations WHERE id = $1', [a.id]))).rejects.toThrow(/permission denied/);
      // In A's own context (passes RLS), a branch of B is still refused by the composite foreign key.
      await expect(sql(ctx, (c) => c.query(
        `INSERT INTO organization_invitations (organization_id, email, branch_id, token_hash, invited_by_user_id, expires_at)
         VALUES ($1, 'fk@example.test', $2, md5(random()::text), $3, now() + interval '1 day')`, [a.id, b.mainBranchId, a.owner.userId]))).rejects.toThrow(/foreign key/);
      await expect(sql(ctx, (c) => c.query("UPDATE branches SET status = 'ARCHIVED' WHERE id = $1", [a.mainBranchId]))).rejects.toThrow(/branches_archived_at/);
    });
  });

  describe('invitations', () => {
    const inviteUrl = () => `/v1/orgs/${a.id}/invitations`;

    it('one open invitation per address, also under concurrency; members (active or suspended) are not re-invited', async () => {
      const email = uniqueEmail('p3-dup');
      const results = await Promise.all([as(a.owner).post(inviteUrl(), { email }), as(a.owner).post(inviteUrl(), { email })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('invitation_pending');
      // Case and whitespace do not create a second invitation.
      expect((await as(a.owner).post(inviteUrl(), { email: `  ${email.toUpperCase()} ` })).status).toBe(400);
      expect((await as(a.owner).post(inviteUrl(), { email: email.toUpperCase() })).body.code).toBe('invitation_pending');
      const member = await addMember(app, a, 'p3-existing-member', 'Cashier', a.mainBranchId);
      expect((await as(a.owner).post(inviteUrl(), { email: member.email })).body.code).toBe('already_member');
      await as(a.owner).patch(`/v1/orgs/${a.id}/members/${member.membershipId}`, { status: 'SUSPENDED' }).expect(200);
      expect((await as(a.owner).post(inviteUrl(), { email: member.email })).body.code).toBe('already_member');
    });

    it('responses do not reveal whether the address has a Ventidoc account', async () => {
      const registered = await signUp(app, 'p3-has-account');
      const r1 = await as(a.owner).post(inviteUrl(), { email: registered.email }).expect(201);
      const r2 = await as(a.owner).post(inviteUrl(), { email: uniqueEmail('p3-no-account') }).expect(201);
      expect(Object.keys(r1.body).sort()).toEqual(Object.keys(r2.body).sort());
      expect(JSON.stringify(r1.body)).not.toMatch(/"userId"|displayName|registered|accountExists/i);
    });

    it('resend rotates the token (old link dies), is bounded, and the existing account accepts with the new link', async () => {
      const user = await signUp(app, 'p3-resend');
      const inv = (await as(a.owner).post(inviteUrl(), { email: user.email, roleId: await roleId(app, a, 'Cashier'), branchId: a.mainBranchId }).expect(201)).body;
      const oldToken = await tokenFromMail(app, user.email, '/accept-invitation');
      expect((await as(a.owner).post(`${inviteUrl()}/${inv.id}/resend`)).body.code).toBe('resend_too_soon');
      await sql(inOrg(a.id, a.owner.userId), (c) => c.query("UPDATE organization_invitations SET last_sent_at = now() - interval '2 minutes' WHERE id = $1", [inv.id]));
      const resent = await as(a.owner).post(`${inviteUrl()}/${inv.id}/resend`).expect(200);
      expect(resent.body).toMatchObject({ id: inv.id, resendCount: 1 });
      expect(resent.body).not.toHaveProperty('tokenHash');
      const newToken = await tokenFromMail(app, user.email, '/accept-invitation');
      expect(newToken).not.toBe(oldToken);
      expect((await as(user).post('/v1/invitations/accept', { token: oldToken })).body.code).toBe('invalid_token');
      const accepted = await as(user).post('/v1/invitations/accept', { token: newToken }).expect(200);
      expect(accepted.body.organizationId).toBe(a.id);
      await as(a.owner).post(`${inviteUrl()}/${inv.id}/resend`).expect(404); // accepted: no longer open
      // The bound on resends.
      const capped = (await as(a.owner).post(inviteUrl(), { email: uniqueEmail('p3-capped') }).expect(201)).body;
      await sql(inOrg(a.id, a.owner.userId), (c) => c.query("UPDATE organization_invitations SET resend_count = 5, last_sent_at = now() - interval '1 hour' WHERE id = $1", [capped.id]));
      expect((await as(a.owner).post(`${inviteUrl()}/${capped.id}/resend`)).body.code).toBe('resend_limit');
    });

    it('expired invitations cannot be accepted, are listed as expired, and can be replaced or resent', async () => {
      const user = await signUp(app, 'p3-expired');
      const inv = (await as(a.owner).post(inviteUrl(), { email: user.email }).expect(201)).body;
      const token = await tokenFromMail(app, user.email, '/accept-invitation');
      await sql(inOrg(a.id, a.owner.userId), (c) => c.query("UPDATE organization_invitations SET expires_at = now() - interval '1 second' WHERE id = $1", [inv.id]));
      expect((await as(user).post('/v1/invitations/accept', { token })).body.code).toBe('invalid_token');
      expect((await as(a.owner).get(`${inviteUrl()}?status=expired`)).body.map((i: { id: string }) => i.id)).toContain(inv.id);
      expect((await as(a.owner).get(inviteUrl())).body.map((i: { id: string }) => i.id)).not.toContain(inv.id);
      // A new invitation replaces the expired one (which is closed, so its link stays dead).
      const fresh = await as(a.owner).post(inviteUrl(), { email: user.email }).expect(201);
      expect(fresh.body.id).not.toBe(inv.id);
      expect((await as(user).post('/v1/invitations/accept', { token })).body.code).toBe('invalid_token');
      await as(user).post('/v1/invitations/accept', { token: await tokenFromMail(app, user.email, '/accept-invitation') }).expect(200);
    });

    it('revoked invitations cannot be accepted; concurrent acceptance creates one membership', async () => {
      const user = await signUp(app, 'p3-revoked');
      const inv = (await as(a.owner).post(inviteUrl(), { email: user.email }).expect(201)).body;
      const token = await tokenFromMail(app, user.email, '/accept-invitation');
      await http(app).delete(`${inviteUrl()}/${inv.id}`).set(bearer(a.owner)).expect(204);
      expect((await as(user).post('/v1/invitations/accept', { token })).body.code).toBe('invalid_token');
      const user2 = await signUp(app, 'p3-double-accept');
      await as(a.owner).post(inviteUrl(), { email: user2.email }).expect(201);
      const token2 = await tokenFromMail(app, user2.email, '/accept-invitation');
      const results = await Promise.all([1, 2, 3].map(() => as(user2).post('/v1/invitations/accept', { token: token2 })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const n = await sql(inOrg(a.id, a.owner.userId), async (c) => (await c.query('SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = $1 AND user_id = $2', [a.id, user2.userId])).rows[0].n);
      expect(n).toBe(1);
    });

    it('raw invitation tokens never appear in audit events or readable outbox payloads', async () => {
      const email = uniqueEmail('p3-token-audit');
      const inv = (await as(a.owner).post(inviteUrl(), { email }).expect(201)).body;
      const token = await tokenFromMail(app, email, '/accept-invitation');
      const secret = token.split('.')[1];
      await sql(inOrg(a.id, a.owner.userId), (c) => c.query("UPDATE organization_invitations SET last_sent_at = now() - interval '2 minutes' WHERE id = $1", [inv.id]));
      await as(a.owner).post(`${inviteUrl()}/${inv.id}/resend`).expect(200);
      const resentSecret = (await tokenFromMail(app, email, '/accept-invitation')).split('.')[1];
      const leaks = await sql(inOrg(a.id, a.owner.userId), async (c) => (await c.query(
        `SELECT (SELECT count(*) FROM audit_events x WHERE x::text LIKE '%' || $1 || '%' OR x::text LIKE '%' || $2 || '%')::int AS audit,
                (SELECT count(*) FROM audit_events x WHERE x::text LIKE '%tokenHash%' OR x::text LIKE '%token_hash%')::int AS hashes`,
        [secret, resentSecret])).rows[0]);
      expect(leaks).toEqual({ audit: 0, hashes: 0 });
      const outbox = await sql({ 'app.email_worker': 'on' }, async (c) => (await c.query(
        "SELECT payload::text AS p, coalesce(sensitive_ciphertext, '') AS s FROM email_outbox WHERE recipient_email = $1", [email])).rows);
      expect(outbox.length).toBeGreaterThanOrEqual(2);
      for (const row of outbox) expect(`${row.p}${row.s}`).not.toContain(secret);
      const actions = (await as(a.owner).get(`/v1/orgs/${a.id}/audit-events?limit=100`)).body.filter((e: { resourceId: string }) => e.resourceId === inv.id).map((e: { action: string }) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['organization.member.invited', 'organization.invitation.resent']));
    });
  });

  describe('memberships and owners', () => {
    it('members can be viewed only within their organization; a member can leave, losing access at once', async () => {
      const m = await addMember(app, a, 'p3-leaver', 'Cashier', a.mainBranchId);
      const view = await as(a.owner).get(`/v1/orgs/${a.id}/members/${m.membershipId}`).expect(200);
      expect(view.body).toMatchObject({ membershipId: m.membershipId, status: 'ACTIVE', user: { id: m.userId }, overrides: [] });
      await as(b.owner).get(`/v1/orgs/${b.id}/members/${m.membershipId}`).expect(404);
      await as(m).post(`/v1/orgs/${a.id}/leave`).expect(200);
      await as(m).get(`/v1/orgs/${a.id}`).expect(403);
      expect((await as(a.owner).get(`/v1/orgs/${a.id}/members/${m.membershipId}`)).body).toMatchObject({ status: 'REVOKED', roles: [] });
    });

    it('the last active owner cannot leave; with a second owner, one may leave', async () => {
      expect((await as(a.owner).post(`/v1/orgs/${a.id}/leave`)).body.code).toBe('last_owner');
      const owner = await futureOwner('p3-solo-owner');
      const org = (await as(owner).post('/v1/organizations', { name: 'Co-owned', slug: `p3-co-${Date.now().toString(36)}` }).expect(201)).body;
      const coOwner = await addMember(app, { id: org.id, mainBranchId: '', owner }, 'p3-co-owner', 'Owner');
      await enableMfa(app, coOwner);
      await as(owner).post(`/v1/orgs/${org.id}/leave`).expect(200);
      expect((await as(coOwner).post(`/v1/orgs/${org.id}/leave`)).body.code).toBe('last_owner');
    });

    it('two owners removing each other concurrently cannot leave the organization ownerless', async () => {
      const owner = await futureOwner('p3-duel-1');
      const org = (await as(owner).post('/v1/organizations', { name: 'Duel', slug: `p3-duel-${Date.now().toString(36)}` }).expect(201)).body;
      const other = await addMember(app, { id: org.id, mainBranchId: '', owner }, 'p3-duel-2', 'Owner');
      await enableMfa(app, other);
      const results = await Promise.all([
        as(owner).patch(`/v1/orgs/${org.id}/members/${other.membershipId}`, { status: 'REVOKED' }),
        as(other).patch(`/v1/orgs/${org.id}/members/${org.membershipId}`, { status: 'REVOKED' }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      // Read as the survivor (the loser is no longer a member and would see nothing).
      const survivor = results[0].status === 200 ? owner : other;
      const owners = await sql(inOrg(org.id, survivor.userId), async (c) => (await c.query(
        `SELECT count(*)::int AS n FROM membership_roles mr JOIN roles r ON r.id = mr.role_id JOIN organization_memberships m ON m.id = mr.membership_id
         WHERE mr.organization_id = $1 AND r.template_key = 'owner' AND r.is_system AND mr.branch_id IS NULL AND m.status = 'ACTIVE'`, [org.id])).rows[0].n);
      expect(owners).toBe(1);
    });

    it('concurrent role replacements serialize: the final assignments equal one of the requests, never a mix', async () => {
      const m = await addMember(app, a, 'p3-concurrent-roles', 'Cashier', a.mainBranchId);
      const cashier = await roleId(app, a, 'Cashier');
      const keeper = await roleId(app, a, 'Storekeeper');
      const setA = [{ roleId: cashier, branchId: a.mainBranchId }];
      const setB = [{ roleId: keeper, branchId: a.mainBranchId }];
      const results = await Promise.all([setA, setB, setA, setB].map((assignments) => as(a.owner).put(`/v1/orgs/${a.id}/members/${m.membershipId}/roles`, { assignments })));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const final = (await as(a.owner).get(`/v1/orgs/${a.id}/members/${m.membershipId}`)).body.roles.map((r: { roleId: string }) => r.roleId);
      expect([[cashier], [keeper]]).toContainEqual(final);
    });
  });

  describe('separation of organization and platform authority', () => {
    it('no organization role (even Owner) grants any platform route, including support', async () => {
      const failures: string[] = [];
      const random = '7c0d3a1e-1111-4222-8333-444455556666';
      for (const r of discoverRoutes(app).filter((x) => platformPermissionsOf(x.handler).length)) {
        const path = fillPath(r.path, {
          organizationId: a.id, userId: random, requestId: random, providerId: random, identityId: random, deliveryId: random, suppressionId: random,
          key: 'platform.test', version: '1', conversationId: random, attachmentId: random,
        });
        if (r.path.endsWith('/stream')) continue; // covered by support.e2e-spec.ts (403 for non-staff)
        const verb = r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        const res = await http(app)[verb](path).set(bearer(a.owner)).send({});
        if (res.status !== 403) failures.push(`${r.method} ${r.path} -> ${res.status}`);
      }
      expect(failures).toEqual([]);
      await as(a.owner).get('/v1/platform/me').expect(403);
    });

    it('platform permissions cannot be placed in organization roles or overrides, and the catalog lists organization permissions only', async () => {
      expect((await as(a.owner).post(`/v1/orgs/${a.id}/roles`, { name: 'Sneaky', permissions: ['platform.support.inbox.read'] })).body.code).toBe('unknown_permission');
      const m = await addMember(app, a, 'p3-override-target', 'Cashier', a.mainBranchId);
      expect((await as(a.owner).post(`/v1/orgs/${a.id}/members/${m.membershipId}/overrides`, {
        permissionKey: 'platform.admin.manage', effect: 'GRANT', reason: 'escalation attempt',
      })).body.code).toBe('unknown_permission');
      const catalog = await as(a.owner).get('/v1/permissions').expect(200);
      expect(catalog.body.permissions.length).toBeGreaterThan(30);
      expect(catalog.body.permissions.some((p: { key: string }) => p.key.startsWith('platform.'))).toBe(false);
    });

    it('an organization administrator cannot escalate through a custom role, an override or the Owner role', async () => {
      const admin = await addMember(app, a, 'p3-org-admin', 'Organization administrator');
      await enableMfa(app, admin);
      // The administrator lacks hr.payroll.approve (excluded from the template).
      expect((await as(admin).post(`/v1/orgs/${a.id}/roles`, { name: 'Payroll grab', permissions: ['hr.payroll.approve'] })).status).toBe(403);
      const target = await addMember(app, a, 'p3-escalation-target', 'Cashier', a.mainBranchId);
      expect((await as(admin).post(`/v1/orgs/${a.id}/members/${target.membershipId}/overrides`, {
        permissionKey: 'hr.payroll.approve', effect: 'GRANT', reason: 'try',
      })).status).toBe(403);
      expect((await as(admin).put(`/v1/orgs/${a.id}/members/${admin.membershipId}/roles`, {
        assignments: [{ roleId: await roleId(app, a, 'Owner') }],
      })).status).toBe(403);
      expect((await as(admin).post(`/v1/orgs/${a.id}/members/${admin.membershipId}/overrides`, {
        permissionKey: 'inventory.product.read', effect: 'GRANT', reason: 'self',
      })).status).toBe(403);
      // And cannot invite with a role they could not grant.
      expect((await as(admin).post(inviteUrlFor(a), { email: uniqueEmail('p3-owner-invite'), roleId: await roleId(app, a, 'Owner') })).status).toBe(403);
      const hr = await as(a.owner).post(`/v1/orgs/${a.id}/roles`, { name: `Payroll ${Date.now()}`, permissions: ['hr.payroll.approve'] }).expect(201);
      expect((await as(admin).post(inviteUrlFor(a), { email: uniqueEmail('p3-payroll-invite'), roleId: hr.body.id })).status).toBe(403);
      expect(mailsTo('p3-owner-invite').length).toBe(0);
    });
  });
});

function inviteUrlFor(org: TestOrg) {
  return `/v1/orgs/${org.id}/invitations`;
}

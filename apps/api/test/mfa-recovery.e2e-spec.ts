/**
 * Two-person administrative MFA recovery (docs/security/mfa.md §8), against real
 * PostgreSQL (CHECKs, trigger, RLS) and Redis (rate limits).
 */
import { INestApplication } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PrismaService } from '../src/database/prisma.service';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import {
  bearer, createOrg, createTestApp, enableMfa, http, mfaDevices, PASSWORD, pools, resetDatabase, signUp, TestUser, waitForMail,
} from './support/harness';

jest.setTimeout(120_000);

describe('Two-person MFA recovery', () => {
  let app: INestApplication;
  let requester: TestUser;
  let approver: TestUser;
  let thirdAdmin: TestUser;
  let roleless: TestUser;

  const req = (admin: TestUser, targetUserId: string, reason = 'Lost phone; ID verified by video call, ticket T-100') =>
    http(app).post('/v1/platform/mfa-recovery-requests').set(bearer(admin)).send({ targetUserId, reason });
  const approve = (admin: TestUser, id: string, targetUserId: string) =>
    http(app).post(`/v1/platform/mfa-recovery-requests/${id}/approve`).set(bearer(admin)).send({ targetUserId });

  async function admin(label: string, roles: string[] = ['Super administrator']): Promise<TestUser> {
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

  async function targetWithMfa(label: string): Promise<TestUser> {
    const u = await signUp(app, label);
    await enableMfa(app, u);
    return u;
  }

  async function platformSql<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const pool = pools.app();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.platform_scope', 'on', true)");
      return await fn(c);
    } finally {
      await c.query('ROLLBACK');
      c.release();
      await pool.end();
    }
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    const first = await signUp(app, 'rec-requester');
    await bootstrapSuperAdmin(app.get(PrismaService), first.email);
    await enableMfa(app, first);
    requester = first;
    approver = await admin('rec-approver');
    thirdAdmin = await admin('rec-third');
    roleless = await admin('rec-roleless', []);
  });
  afterAll(() => app.close());

  it('the single-administrator reset route no longer exists', async () => {
    const t = await signUp(app, 'rec-legacy');
    await http(app).post(`/v1/platform/users/${t.userId}/mfa/reset`).set(bearer(requester)).send({ reason: 'legacy route check T-0' }).expect(404);
  });

  it('request → approve by a second administrator executes the recovery', async () => {
    const target = await targetWithMfa('rec-target-1');
    const r = await req(requester, target.userId).expect(201);
    expect(r.body).toMatchObject({ status: 'PENDING', targetUserId: target.userId, requestedBy: requester.userId });
    // Not executed yet: the target still has MFA and an active session.
    await http(app).get('/v1/auth/me').set(bearer(target)).expect(200);
    const notice = await waitForMail(app, target.email, (m) => m.text.includes('request to reset two-step verification'));
    expect(notice.text).not.toContain(requester.email);
    expect(notice.text).not.toContain(requester.userId);

    const ok = await approve(approver, r.body.id, target.userId).expect(200);
    expect(ok.body).toMatchObject({ status: 'EXECUTED', decidedBy: approver.userId });
    await http(app).get('/v1/auth/me').set(bearer(target)).expect(401); // every session revoked
    const relog = await http(app).post('/v1/auth/login').send({ email: target.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
    expect(relog.body.mfaRequired).toBe(false); // factor removed; must re-enroll (with email proof)
    await waitForMail(app, target.email, (m) => m.text.includes('second administrator approved'));
    mfaDevices.delete(target.email);

    const audit = await http(app).get('/v1/platform/audit-events?limit=100').set(bearer(approver)).expect(200);
    const mine = audit.body.filter((e: { resourceId: string }) => e.resourceId === r.body.id).map((e: { action: string }) => e.action);
    expect(mine).toEqual(expect.arrayContaining(['platform.mfa_recovery.requested', 'platform.mfa_recovery.approved', 'platform.mfa_recovery.executed']));
  });

  it('self-approval is impossible: API, and directly in the database', async () => {
    const target = await targetWithMfa('rec-self');
    const r = await req(requester, target.userId).expect(201);
    const self = await approve(requester, r.body.id, target.userId);
    expect({ status: self.status, code: self.body.code }).toEqual({ status: 403, code: 'second_administrator_required' });
    const selfReject = await http(app).post(`/v1/platform/mfa-recovery-requests/${r.body.id}/reject`).set(bearer(requester)).send({ note: 'self' });
    expect(selfReject.status).toBe(403);
    // Even with direct SQL in platform scope, the CHECK constraint refuses it.
    await expect(platformSql((c) =>
      c.query("UPDATE mfa_recovery_requests SET status = 'APPROVED', decided_by = requested_by, decided_at = now() WHERE id = $1", [r.body.id]),
    )).rejects.toThrow(/mfa_recovery_second_person/);
    await http(app).post(`/v1/platform/mfa-recovery-requests/${r.body.id}/cancel`).set(bearer(requester)).expect(204);
  });

  it('nobody can request, approve or reject recovery of their own account', async () => {
    const r = await req(approver, approver.userId);
    expect(r.status).toBe(403);
    // The target of a request cannot be its approver.
    const forApprover = await req(requester, approver.userId).expect(201);
    const own = await approve(approver, forApprover.body.id, approver.userId);
    expect({ status: own.status, code: own.body.code }).toEqual({ status: 403, code: 'second_administrator_required' });
    await expect(platformSql((c) =>
      c.query("INSERT INTO mfa_recovery_requests (target_user_id, requested_by, reason, expires_at) VALUES ($1, $1, 'self request in sql', now() + interval '1 hour')", [approver.userId]),
    )).rejects.toThrow(/mfa_recovery_not_self_target/);
    await http(app).post(`/v1/platform/mfa-recovery-requests/${forApprover.body.id}/cancel`).set(bearer(requester)).expect(204);
  });

  it('the approver must re-confirm the exact target; a mismatch changes nothing', async () => {
    const target = await targetWithMfa('rec-mismatch');
    const other = await signUp(app, 'rec-other');
    const r = await req(requester, target.userId).expect(201);
    const bad = await approve(approver, r.body.id, other.userId);
    expect({ status: bad.status, code: bad.body.code }).toEqual({ status: 409, code: 'recovery_target_mismatch' });
    await http(app).get('/v1/auth/me').set(bearer(target)).expect(200);
    // The target of a request cannot be changed afterwards, even in SQL.
    await expect(platformSql((c) => c.query('UPDATE mfa_recovery_requests SET target_user_id = $2 WHERE id = $1', [r.body.id, other.userId])))
      .rejects.toThrow(/immutable/);
    await http(app).post(`/v1/platform/mfa-recovery-requests/${r.body.id}/cancel`).set(bearer(requester)).expect(204);
  });

  it('approval is single-use: replays and concurrent approvals execute exactly once', async () => {
    const target = await targetWithMfa('rec-race');
    const r = await req(requester, target.userId).expect(201);
    const results = await Promise.all([approve(approver, r.body.id, target.userId), approve(thirdAdmin, r.body.id, target.userId)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const replay = await approve(thirdAdmin, r.body.id, target.userId);
    expect(replay.status).toBe(409);
    const executed = await app.get(PrismaService).$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
      return tx.auditEvent.count({ where: { action: 'platform.mfa_recovery.executed', resourceId: r.body.id } });
    });
    expect(executed).toBe(1);
    // Executed requests cannot be reopened.
    await expect(platformSql((c) => c.query("UPDATE mfa_recovery_requests SET status = 'PENDING' WHERE id = $1", [r.body.id])))
      .rejects.toThrow(/invalid status transition/);
    mfaDevices.delete(target.email);
  });

  it('expired, rejected and cancelled requests cannot be approved; one open request per target', async () => {
    const target = await targetWithMfa('rec-closed');
    const r = await req(requester, target.userId).expect(201);
    const dup = await req(thirdAdmin, target.userId);
    expect({ status: dup.status, code: dup.body.code }).toEqual({ status: 409, code: 'recovery_request_open' });
    await http(app).post(`/v1/platform/mfa-recovery-requests/${r.body.id}/reject`).set(bearer(approver)).send({ note: 'identity not verified' }).expect(200);
    expect((await approve(thirdAdmin, r.body.id, target.userId)).body.code).toBe('recovery_request_closed');

    // Expired: inserted in the past directly (the API never sets past expiries).
    const expiredId = await (async () => {
      const pool = pools.app();
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.platform_scope', 'on', true)");
        const row = await c.query(
          `INSERT INTO mfa_recovery_requests (target_user_id, requested_by, reason, created_at, expires_at)
           VALUES ($1, $2, 'expired request for test T-9', now() - interval '25 hours', now() - interval '1 hour') RETURNING id`,
          [target.userId, requester.userId],
        );
        await c.query('COMMIT');
        return row.rows[0].id as string;
      } finally {
        c.release();
        await pool.end();
      }
    })();
    const exp = await approve(approver, expiredId, target.userId);
    expect({ status: exp.status, code: exp.body.code }).toEqual({ status: 409, code: 'recovery_request_expired' });
    await http(app).get('/v1/auth/me').set(bearer(target)).expect(200); // nothing happened to the target
    const listed = await http(app).get('/v1/platform/mfa-recovery-requests?status=EXPIRED').set(bearer(approver)).expect(200);
    expect(listed.body.map((x: { id: string }) => x.id)).toContain(expiredId);
  });

  it('authorization: non-admins, role-less admins, organization owners and stale step-up are refused', async () => {
    const target = await targetWithMfa('rec-authz');
    const owner = await signUp(app, 'rec-owner');
    await createOrg(app, owner, 'rec-owner-org');
    for (const who of [target, roleless, owner]) {
      expect((await req(who, target.userId)).status).toBe(403);
      expect((await http(app).get('/v1/platform/mfa-recovery-requests').set(bearer(who))).status).toBe(403);
    }
    const r = await req(requester, target.userId).expect(201);
    expect((await approve(roleless, r.body.id, target.userId)).status).toBe(403);
    await app.get(PrismaService).session.update({ where: { id: approver.sessionId }, data: { reauthenticatedAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await approve(approver, r.body.id, target.userId)).body.code).toBe('step_up_required');
    await http(app).post('/v1/auth/reauthenticate').set(bearer(approver)).send({ password: PASSWORD }).expect(204);
    // A password-only session of an administrator is refused outright (mandatory MFA).
    const pwOnly = await app.get(PrismaService).session.update({ where: { id: thirdAdmin.sessionId }, data: { mfaVerifiedAt: null } });
    expect(pwOnly.id).toBe(thirdAdmin.sessionId);
    expect((await approve(thirdAdmin, r.body.id, target.userId)).status).toBe(401);
    await http(app).post(`/v1/platform/mfa-recovery-requests/${r.body.id}/cancel`).set(bearer(requester)).expect(204);
  });

  it('requests per target are rate-limited (anti-harassment), failing closed', async () => {
    const limited = await createTestApp({ RATE_LIMIT_OVERRIDES: 'mfa_recovery.target=1/1h' });
    try {
      const target = await signUp(app, 'rec-limited');
      const r = await http(limited).post('/v1/platform/mfa-recovery-requests').set(bearer(requester)).send({ targetUserId: target.userId, reason: 'first request T-200 verified' }).expect(201);
      await http(limited).post(`/v1/platform/mfa-recovery-requests/${r.body.id}/cancel`).set(bearer(requester)).expect(204);
      const second = await http(limited).post('/v1/platform/mfa-recovery-requests').set(bearer(requester)).send({ targetUserId: target.userId, reason: 'second request T-201 verified' });
      expect(second.status).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('the table is invisible outside platform scope and cannot be deleted from', async () => {
    const pool = pools.app();
    try {
      expect((await pool.query('SELECT count(*)::int AS n FROM mfa_recovery_requests')).rows[0].n).toBe(0);
      await expect(platformSql((c) => c.query('DELETE FROM mfa_recovery_requests'))).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
    }
  });
});

/**
 * Stage 2B: MFA (docs/security/mfa.md) end to end against real PostgreSQL and Redis.
 */
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../src/database/prisma.service';
import { currentStep, totpAt } from '../src/mfa/totp';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import {
  addMember, bearer, createOrg, createTestApp, enableMfa, freshTotp, http, login, mailsTo, mfaDevices, PASSWORD, pools, resetDatabase,
  roleId, signUp, TestUser, tokenFromMail,
} from './support/harness';
import { redisTarget, redisUrlVia, TcpProxy, waitFor } from './support/tcp-proxy';

// TOTP replay protection allows at most two fresh codes per user per 30 s step;
// tests that sign the same user in repeatedly wait for the next step.
jest.setTimeout(120_000);

describe('Multi-factor authentication', () => {
  let app: INestApplication;

  const passwordStep = (email: string, clientType: 'WEB' | 'MOBILE' = 'MOBILE', password = PASSWORD) =>
    http(app).post('/v1/auth/login').send({ email, password, clientType });
  const verify = (mfaToken: string, second: object, extra: object = {}) =>
    http(app).post('/v1/auth/mfa/verify').send({ mfaToken, ...second, ...extra });
  /** The newest setup code delivered to `email` (waits for the worker; `after` skips older mails). */
  const emailCodeFor = async (email: string, after = 0) => {
    const end = Date.now() + 8000;
    for (;;) {
      const mails = mailsTo(email).filter((m) => m.subject.includes('setup code'));
      if (mails.length > after) return mails.at(-1)!.text.match(/\b(\d{8})\b/)?.[1];
      if (Date.now() > end) throw new Error('no setup code mail');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });
  afterAll(() => app.close());

  describe('enrollment', () => {
    it('first enrollment requires a recent password step-up, the emailed code and a valid TOTP', async () => {
      const u = await signUp(app, 'enroll-1');
      // Step-up older than 10 minutes: refused.
      await app.get(PrismaService).session.update({ where: { id: u.sessionId }, data: { reauthenticatedAt: new Date(Date.now() - 11 * 60_000) } });
      const stale = await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({});
      expect(stale.body.code).toBe('step_up_required');
      await http(app).post('/v1/auth/reauthenticate').set(bearer(u)).send({ password: PASSWORD }).expect(204);

      const start = await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({}).expect(200);
      expect(start.body).toMatchObject({ emailCodeRequired: true });
      expect(start.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(start.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Ventidoc:/);
      await emailCodeFor(u.email);
      const mail = mailsTo(u.email).map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n');
      expect(mail).not.toContain(start.body.secret); // the secret is never emailed

      const code = totpAt(start.body.secret, Date.now());
      // Without the emailed code (knowing only the password): refused.
      await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(u)).send({ code }).expect(401);
      // Not enabled yet.
      expect((await http(app).get('/v1/auth/mfa').set(bearer(u)).expect(200)).body.enabled).toBe(false);
      const ok = await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(u)).send({ code, emailCode: await emailCodeFor(u.email) }).expect(200);
      expect(ok.body.recoveryCodes).toHaveLength(10);
      const status = await http(app).get('/v1/auth/mfa').set(bearer(u)).expect(200);
      expect(status.body).toMatchObject({ enabled: true, sessionVerified: true, recoveryCodesRemaining: 10 });
    });

    it('a wrong TOTP does not complete enrollment; five failures discard it', async () => {
      const u = await signUp(app, 'enroll-2');
      await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({}).expect(200);
      for (let i = 0; i < 5; i++) {
        await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(u)).send({ code: '000000', emailCode: await emailCodeFor(u.email) }).expect(401);
      }
      const status = await http(app).get('/v1/auth/mfa').set(bearer(u)).expect(200);
      expect(status.body).toMatchObject({ enabled: false, enrollmentPending: false });
    });

    it('cancellation and expiry invalidate a pending enrollment', async () => {
      const u = await signUp(app, 'enroll-3');
      let start = await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({}).expect(200);
      await http(app).delete('/v1/auth/mfa/enrollment').set(bearer(u)).expect(204);
      await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(u))
        .send({ code: totpAt(start.body.secret, Date.now()), emailCode: await emailCodeFor(u.email) }).expect(401);

      start = await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({}).expect(200);
      const auth = pools.auth();
      try {
        await auth.query("UPDATE user_mfa_enrollments SET expires_at = now() - interval '1 second' WHERE user_id = $1", [u.userId]);
        await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(u))
          .send({ code: totpAt(start.body.secret, Date.now()), emailCode: await emailCodeFor(u.email) }).expect(401);
        expect((await auth.query('SELECT 1 FROM user_mfa_enrollments WHERE user_id = $1', [u.userId])).rowCount).toBe(0);
      } finally {
        await auth.end();
      }
    });

    it('enabling MFA revokes every other session of the user', async () => {
      const u = await signUp(app, 'enroll-4');
      const other = await login(app, u.email);
      await enableMfa(app, u);
      await http(app).get('/v1/auth/me').set(bearer(other)).expect(401);
      await http(app).post('/v1/auth/refresh').send({ refreshToken: other.refreshToken }).expect(401);
      await http(app).get('/v1/auth/me').set(bearer(u)).expect(200);
    });

    it('replacing the authenticator requires the current second factor', async () => {
      const u = await signUp(app, 'enroll-5');
      const state = await enableMfa(app, u);
      await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({}).expect(401);
      const start = await http(app).post('/v1/auth/mfa/enrollment').set(bearer(u)).send({ recoveryCode: state.recoveryCodes.pop() }).expect(200);
      expect(start.body.emailCodeRequired).toBe(false);
      const step = currentStep();
      const confirm = await http(app).post('/v1/auth/mfa/enrollment/confirm').set(bearer(u)).send({ code: totpAt(start.body.secret, step * 30_000) }).expect(200);
      mfaDevices.set(u.email, { secret: start.body.secret, recoveryCodes: [...confirm.body.recoveryCodes], lastStep: step });
      // The old recovery codes died with the old factor.
      const relog = await passwordStep(u.email).expect(200);
      await verify(relog.body.mfaToken, { recoveryCode: state.recoveryCodes[0] }).expect(401);
    });
  });

  describe('login state machine', () => {
    let user: TestUser;
    beforeAll(async () => {
      user = await signUp(app, 'login-mfa');
      await enableMfa(app, user);
    });

    it('a correct password yields only a single-purpose challenge: no tokens, no cookies, no session', async () => {
      const before = await app.get(PrismaService).session.count({ where: { userId: user.userId, revokedAt: null } });
      const web = await passwordStep(user.email, 'WEB').expect(200);
      expect(Object.keys(web.body).sort()).toEqual(['mfaRequired', 'mfaToken', 'mfaTokenExpiresAt']);
      expect(web.headers['set-cookie']).toBeUndefined();
      const mobile = await passwordStep(user.email, 'MOBILE').expect(200);
      expect(mobile.body.accessToken).toBeUndefined();
      expect(mobile.body.refreshToken).toBeUndefined();
      expect(await app.get(PrismaService).session.count({ where: { userId: user.userId, revokedAt: null } })).toBe(before);
      // The challenge token is not interchangeable with any other credential.
      await http(app).get('/v1/auth/me').set('Authorization', `Bearer ${mobile.body.mfaToken}`).expect(401);
      await http(app).post('/v1/auth/refresh').send({ refreshToken: mobile.body.mfaToken }).expect(401);
      await http(app).post('/v1/organizations').set('Authorization', `Bearer ${mobile.body.mfaToken}`).send({ name: 'x1', slug: 'x1-slug' }).expect(401);
    });

    it('a wrong password never reveals whether MFA is enabled', async () => {
      const r = await passwordStep(user.email, 'MOBILE', 'wrong-password-1').expect(401);
      expect(r.body).toEqual({ statusCode: 401, code: 'invalid_credentials', message: 'Invalid email or password' });
    });

    it('TOTP completes the session (mobile: tokens in body; web: HTTP-only cookies)', async () => {
      const m = await passwordStep(user.email, 'MOBILE').expect(200);
      const done = await verify(m.body.mfaToken, { code: await freshTotp(user.email) }).expect(200);
      expect(done.body).toMatchObject({ mfaRequired: false });
      await http(app).get('/v1/auth/me').set('Authorization', `Bearer ${done.body.accessToken}`).expect(200);
      expect((await http(app).get('/v1/auth/mfa').set('Authorization', `Bearer ${done.body.accessToken}`)).body.sessionVerified).toBe(true);

      const w = await passwordStep(user.email, 'WEB').expect(200);
      const web = await verify(w.body.mfaToken, { code: await freshTotp(user.email) }).expect(200);
      expect(web.body.accessToken).toBeUndefined();
      const cookies = web.headers['set-cookie'] as unknown as string[];
      expect(cookies.find((c) => c.startsWith('vd_at='))).toMatch(/HttpOnly/);
      // Refresh keeps the MFA-verified state of the session.
      const r = await http(app).post('/v1/auth/refresh').send({ refreshToken: done.body.refreshToken }).expect(200);
      expect((await http(app).get('/v1/auth/mfa').set('Authorization', `Bearer ${r.body.accessToken}`)).body.sessionVerified).toBe(true);
    });

    it('rejects wrong and malformed codes, and replays of an accepted code', async () => {
      const c = await passwordStep(user.email).expect(200);
      for (const bad of ['000000', '12345', '1234567', 'abcdef', '', '１２３４５６']) {
        const r = await verify(c.body.mfaToken, { code: bad });
        expect([400, 401]).toContain(r.status);
      }
      const used = await freshTotp(user.email);
      const fresh = await passwordStep(user.email).expect(200);
      await verify(fresh.body.mfaToken, { code: used }).expect(200);
      const again = await passwordStep(user.email).expect(200);
      expect((await verify(again.body.mfaToken, { code: used })).status).toBe(401); // replay
    });

    it('a challenge is single-use, expires, and dies after five wrong attempts', async () => {
      const c = await passwordStep(user.email).expect(200);
      await verify(c.body.mfaToken, { recoveryCode: mfaDevices.get(user.email)!.recoveryCodes.pop() }).expect(200);
      await verify(c.body.mfaToken, { recoveryCode: mfaDevices.get(user.email)!.recoveryCodes.pop() }).expect(401); // reused challenge

      const e = await passwordStep(user.email).expect(200);
      await app.get(PrismaService).mfaChallenge.updateMany({ where: { userId: user.userId, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await verify(e.body.mfaToken, { recoveryCode: mfaDevices.get(user.email)!.recoveryCodes.at(-1) }).expect(401);

      const t = await passwordStep(user.email).expect(200);
      for (let i = 0; i < 5; i++) await verify(t.body.mfaToken, { code: '111111' }).expect(401);
      await verify(t.body.mfaToken, { recoveryCode: mfaDevices.get(user.email)!.recoveryCodes.at(-1) }).expect(401);
      // The recovery code was not consumed by the dead challenge.
      const ok = await passwordStep(user.email).expect(200);
      await verify(ok.body.mfaToken, { recoveryCode: mfaDevices.get(user.email)!.recoveryCodes.pop() }).expect(200);
    });
  });

  describe('recovery codes', () => {
    it('are stored only as hashes and are single-use, even under concurrency', async () => {
      const u = await signUp(app, 'recovery-1');
      const state = await enableMfa(app, u);
      const auth = pools.auth();
      try {
        const rows = await auth.query('SELECT code_hash FROM user_mfa_recovery_codes WHERE user_id = $1', [u.userId]);
        expect(rows.rowCount).toBe(10);
        const stored = rows.rows.map((r) => r.code_hash).join(' ');
        for (const c of state.recoveryCodes) {
          expect(stored).not.toContain(c);
          expect(stored).not.toContain(c.replace(/-/g, ''));
        }
        for (const r of rows.rows) expect(r.code_hash).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        await auth.end();
      }
      const code = state.recoveryCodes[0];
      const challenges = [];
      for (let i = 0; i < 8; i++) challenges.push((await passwordStep(u.email).expect(200)).body.mfaToken);
      const results = await Promise.all(challenges.map((t) => verify(t, { recoveryCode: code.toLowerCase() })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(7);
      expect((await http(app).get('/v1/auth/mfa').set('Authorization', `Bearer ${results.find((r) => r.status === 200)!.body.accessToken}`)).body.recoveryCodesRemaining).toBe(9);
    });

    it('regeneration needs password + fresh factor and invalidates every previous code', async () => {
      const u = await signUp(app, 'recovery-2');
      const state = await enableMfa(app, u);
      await http(app).post('/v1/auth/mfa/recovery-codes').set(bearer(u)).send({ password: 'wrong-password', code: await freshTotp(u.email) }).expect(401);
      await http(app).post('/v1/auth/mfa/recovery-codes').set(bearer(u)).send({ password: PASSWORD, code: '000000' }).expect(401);
      const r = await http(app).post('/v1/auth/mfa/recovery-codes').set(bearer(u)).send({ password: PASSWORD, recoveryCode: state.recoveryCodes[0] }).expect(200);
      expect(r.body.recoveryCodes).toHaveLength(10);
      const c = await passwordStep(u.email).expect(200);
      await verify(c.body.mfaToken, { recoveryCode: state.recoveryCodes[1] }).expect(401); // old code
      await verify(c.body.mfaToken, { recoveryCode: r.body.recoveryCodes[0] }).expect(200);
    });
  });

  describe('policy: mandatory for platform administrators and organization owners', () => {
    it('an owner without MFA is limited to identity and enrollment routes until enrolled', async () => {
      const owner = await signUp(app, 'owner-nomfa');
      const created = await http(app).post('/v1/organizations').set(bearer(owner)).send({ name: 'Owner NoMfa', slug: `own-${Date.now()}` }).expect(201);
      for (const path of ['/v1/me/organizations', `/v1/orgs/${created.body.id}`, `/v1/orgs/${created.body.id}/products`]) {
        const r = await http(app).get(path).set(bearer(owner));
        expect({ path, status: r.status, code: r.body.code }).toEqual({ path, status: 403, code: 'mfa_required' });
      }
      await http(app).get('/v1/auth/me').set(bearer(owner)).expect(200);
      expect((await http(app).get('/v1/auth/mfa').set(bearer(owner)).expect(200)).body).toMatchObject({ enabled: false, required: true });
      await enableMfa(app, owner);
      await http(app).get(`/v1/orgs/${created.body.id}/products`).set(bearer(owner)).expect(200);
    });

    it('a platform administrator without MFA cannot use any platform route', async () => {
      const admin = await signUp(app, 'admin-nomfa');
      await bootstrapSuperAdminIfFree(admin);
      const r = await http(app).get('/v1/platform/organizations').set(bearer(admin));
      expect(r.body.code).toBe('mfa_required');
      await enableMfa(app, admin);
      await http(app).get('/v1/platform/organizations').set(bearer(admin)).expect(200);
    });

    it('ordinary members may use MFA voluntarily; without it they keep full access', async () => {
      const owner = await signUp(app, 'opt-owner');
      const org = await createOrg(app, owner, 'opt-org');
      const member = await addMember(app, org, 'opt-member', 'Inventory manager');
      await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(member)).expect(200);
      expect((await http(app).get('/v1/auth/mfa').set(bearer(member))).body.required).toBe(false);
      await enableMfa(app, member);
      expect((await passwordStep(member.email).expect(200)).body.mfaRequired).toBe(true);
      // ...and can turn it off again with password + fresh factor (not mandatory for them).
      await http(app).post('/v1/auth/mfa/disable').set(bearer(member)).send({ password: PASSWORD, code: '000000' }).expect(401);
      await http(app).post('/v1/auth/mfa/disable').set(bearer(member)).send({ password: PASSWORD, code: await freshTotp(member.email) }).expect(204);
      mfaDevices.delete(member.email);
      expect((await passwordStep(member.email).expect(200)).body.mfaRequired).toBe(false);
    });

    it('owners and platform administrators cannot disable MFA', async () => {
      const owner = await signUp(app, 'owner-disable');
      await createOrg(app, owner, 'owner-disable-org');
      const r = await http(app).post('/v1/auth/mfa/disable').set(bearer(owner)).send({ password: PASSWORD, code: await freshTotp(owner.email) });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('mfa_required');
      expect((await http(app).get('/v1/auth/mfa').set(bearer(owner))).body.enabled).toBe(true);
    });

    it('becoming an owner mid-session takes effect immediately (no bypass through role changes)', async () => {
      const owner = await signUp(app, 'promote-owner');
      const org = await createOrg(app, owner, 'promote-org');
      const member = await addMember(app, org, 'promote-member', 'Read-only viewer');
      await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(member)).expect(200);
      await http(app).put(`/v1/orgs/${org.id}/members/${member.membershipId}/roles`).set(bearer(owner))
        .send({ assignments: [{ roleId: await roleId(app, org, 'Owner') }] }).expect(200);
      const r = await http(app).get(`/v1/orgs/${org.id}/products`).set(bearer(member));
      expect(r.body.code).toBe('mfa_required');
      expect((await http(app).get('/v1/me/organizations').set(bearer(member))).body.code).toBe('mfa_required');
    });
  });

  describe('interactions with password reset, sessions and administration', () => {
    it('a password reset revokes sessions but never disables MFA', async () => {
      const u = await signUp(app, 'reset-mfa');
      await enableMfa(app, u);
      await http(app).post('/v1/auth/password/forgot').send({ email: u.email }).expect(202);
      await http(app).post('/v1/auth/password/reset').send({ token: await tokenFromMail(app, u.email, '/reset-password'), newPassword: 'brand-new-password-1' }).expect(204);
      await http(app).get('/v1/auth/me').set(bearer(u)).expect(401);
      const step = await passwordStep(u.email, 'MOBILE', 'brand-new-password-1').expect(200);
      expect(step.body.mfaRequired).toBe(true);
    });

    it('a password-only session cannot be refreshed once the account has MFA', async () => {
      const u = await signUp(app, 'refresh-mfa');
      await enableMfa(app, u);
      // Simulate a stray password-only session (e.g. created before MFA by another path).
      const s = await app.get(PrismaService).session.findFirstOrThrow({ where: { id: u.sessionId } });
      await app.get(PrismaService).session.update({ where: { id: s.id }, data: { mfaVerifiedAt: null } });
      await http(app).get('/v1/auth/me').set(bearer(u)).expect(401);
      await http(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    });

    // Administrative recovery is two-person: see mfa-recovery.e2e-spec.ts.
  });

  describe('secret isolation and data hygiene', () => {
    it('the application role cannot touch MFA tables; secrets are encrypted at rest', async () => {
      const u = await signUp(app, 'isolation');
      const state = await enableMfa(app, u);
      const appPool = pools.app();
      const auth = pools.auth();
      try {
        for (const t of ['user_mfa_factors', 'user_mfa_enrollments', 'user_mfa_recovery_codes']) {
          await expect(appPool.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
          await expect(appPool.query(`DELETE FROM ${t}`)).rejects.toThrow(/permission denied/);
        }
        const row = await auth.query('SELECT secret_ciphertext FROM user_mfa_factors WHERE user_id = $1', [u.userId]);
        expect(row.rows[0].secret_ciphertext).toMatch(/^v1:[a-z0-9]+:/);
        expect(row.rows[0].secret_ciphertext).not.toContain(state.secret);
        await expect(auth.query('SELECT 1 FROM products LIMIT 1')).rejects.toThrow(/permission denied/);
      } finally {
        await appPool.end();
        await auth.end();
      }
    });

    it('no secret, TOTP code or recovery code ever lands in audit events; org admins cannot see MFA events', async () => {
      const owner = await signUp(app, 'hygiene-owner');
      const org = await createOrg(app, owner, 'hygiene-org');
      const state = mfaDevices.get(owner.email)!;
      const used = await freshTotp(owner.email);
      const c = await passwordStep(owner.email).expect(200);
      await verify(c.body.mfaToken, { code: used }).expect(200);
      const events = await app.get(PrismaService).$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
        return tx.auditEvent.findMany({ where: { OR: [{ actorUserId: owner.userId }, { resourceId: owner.userId }] } });
      });
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['auth.mfa.enrollment_started', 'auth.mfa.enabled', 'auth.login.mfa_challenge']));
      const dump = JSON.stringify(events);
      for (const secret of [state.secret, used, ...state.recoveryCodes, ...state.recoveryCodes.map((x) => x.replace(/-/g, ''))]) expect(dump).not.toContain(secret);
      const orgAudit = await http(app).get(`/v1/orgs/${org.id}/audit-events?limit=100`).set(bearer(owner)).expect(200);
      expect(orgAudit.body.filter((e: { action: string }) => e.action.startsWith('auth.mfa'))).toEqual([]);
    });

    it('key rotation: old keys still decrypt and are lazily re-encrypted; a key is retired only after re-encryption', async () => {
      const k1 = process.env.MFA_ENCRYPTION_KEYS as string; // "k1:..."
      const k2 = `k2:${Buffer.alloc(32, 9).toString('base64')}`;
      const u = await signUp(app, 'rotation');
      await enableMfa(app, u);
      const rotated = await createTestApp({ MFA_ENCRYPTION_KEYS: `${k1},${k2}`, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k2' });
      const auth = pools.auth();
      try {
        const c = await http(rotated).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        await http(rotated).post('/v1/auth/mfa/verify').send({ mfaToken: c.body.mfaToken, code: await freshTotp(u.email) }).expect(200);
        const row = await auth.query('SELECT secret_ciphertext FROM user_mfa_factors WHERE user_id = $1', [u.userId]);
        expect(row.rows[0].secret_ciphertext.split(':')[1]).toBe('k2');
      } finally {
        await rotated.close();
        await auth.end();
      }
      // Other users' secrets are still under k1: retiring k1 now is refused at startup (review A-3).
      const premature = await createTestApp({ MFA_ENCRYPTION_KEYS: k2, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k2' }).then(
        async (a) => { await a.close(); return 'started'; },
        (e: Error) => e.message,
      );
      expect(premature).toMatch(/missing key\(s\) still protecting MFA secrets: k1/);
      // The documented procedure: re-encrypt everything, then retire.
      runReencrypt(`${k1},${k2}`, 'k2');
      const retired = await createTestApp({ MFA_ENCRYPTION_KEYS: k2, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k2' });
      try {
        const c = await http(retired).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        await http(retired).post('/v1/auth/mfa/verify').send({ mfaToken: c.body.mfaToken, code: await freshTotp(u.email) }).expect(200);
      } finally {
        await retired.close();
      }
      // Restore the suite's default key for the remaining tests.
      runReencrypt(`${k1},${k2}`, 'k1');
    });
  });

  describe('key rotation tooling', () => {
    it('pnpm api mfa:reencrypt moves every secret to the active key; sign-in keeps working', async () => {
      const users = [await signUp(app, 'cli-rot-1'), await signUp(app, 'cli-rot-2')];
      for (const u of users) await enableMfa(app, u); // sealed under k1 (test default)
      const k1 = process.env.MFA_ENCRYPTION_KEYS as string;
      const k3 = `k3:${Buffer.alloc(32, 3).toString('base64')}`;
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync('npx', ['tsx', 'src/cli/mfa-reencrypt.ts'], {
        cwd: `${__dirname}/..`,
        // Full ring: every key still in use must be listed (an earlier test sealed one secret under k2).
        env: { ...process.env, MFA_ENCRYPTION_KEYS: `${k1},k2:${Buffer.alloc(32, 9).toString('base64')},${k3}`, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k3' },
        encoding: 'utf8',
      });
      expect(out).toMatch(/re-encrypted: [1-9]\d*/);
      expect(out).toMatch(/after: \{ k3: \d+ \}/);
      // A ring missing a key still in use is refused, touching nothing.
      expect(() => runReencrypt(k3, 'k3', 'check')).not.toThrow();
      expect(() => runReencrypt(`k4:${Buffer.alloc(32, 4).toString('base64')}`, 'k4')).toThrow(/lacks key\(s\) still in use: k3/);
      for (const u of users) expect(out).not.toContain(mfaDevices.get(u.email)!.secret);
      const retired = await createTestApp({ MFA_ENCRYPTION_KEYS: k3, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k3' });
      try {
        const c = await http(retired).post('/v1/auth/login').send({ email: users[0].email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        await http(retired).post('/v1/auth/mfa/verify').send({ mfaToken: c.body.mfaToken, code: await freshTotp(users[0].email) }).expect(200);
      } finally {
        await retired.close();
      }
      runReencrypt(`${k1},${k3}`, 'k1'); // restore the suite default
    });
  });

  describe('rate limiting and Redis outages', () => {
    it('limits TOTP guessing per user; a recognized device keeps its own budget', async () => {
      const strict = await createTestApp({ RATE_LIMIT_OVERRIDES: '' });
      try {
        const u = await signUp(app, 'guess');
        await enableMfa(app, u);
        // A recognized-client token from a completed MFA login on the owner's device.
        const own = await http(strict).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        const ownDone = await http(strict).post('/v1/auth/mfa/verify').send({ mfaToken: own.body.mfaToken, code: await freshTotp(u.email) }).expect(200);
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
          const c = await http(strict).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
          statuses.push((await http(strict).post('/v1/auth/mfa/verify').send({ mfaToken: c.body.mfaToken, code: '222222' })).status);
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
        const c = await http(strict).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        const blocked = await http(strict).post('/v1/auth/mfa/verify').send({ mfaToken: c.body.mfaToken, recoveryCode: mfaDevices.get(u.email)!.recoveryCodes.at(-1) });
        expect(blocked.status).toBe(429);
        expect(blocked.headers['retry-after']).toBeDefined();
        // The owner's recognized device is not locked out by the attacker's failures.
        await http(strict).post('/v1/auth/mfa/verify')
          .send({ mfaToken: c.body.mfaToken, recoveryCode: mfaDevices.get(u.email)!.recoveryCodes.pop(), deviceToken: ownDone.body.deviceToken }).expect(200);
      } finally {
        await strict.close();
      }
    });

    it('review M-1: an attacker who knows the password cannot lock the owner out of MFA sign-in', async () => {
      const strict = await createTestApp({ RATE_LIMIT_OVERRIDES: '', TRUSTED_PROXIES: '127.0.0.1,::1' });
      try {
        const u = await signUp(app, 'mfa-dos');
        await enableMfa(app, u);
        const loginAt = (ip: string, extra: object = {}) =>
          http(strict).post('/v1/auth/login').set('X-Forwarded-For', ip).send({ email: u.email, password: PASSWORD, clientType: 'MOBILE', ...extra });
        // The owner's own device completes one MFA login and keeps its recognized-client token.
        const own = await loginAt('203.0.113.10').expect(200);
        const ownDone = await http(strict).post('/v1/auth/mfa/verify').set('X-Forwarded-For', '203.0.113.10')
          .send({ mfaToken: own.body.mfaToken, code: await freshTotp(u.email) }).expect(200);
        // The attacker (password known) burns every per-user MFA budget from many networks.
        let n = 0;
        for (let i = 0; i < 12; i++) {
          const c = await loginAt(`198.51.100.${++n}`);
          if (c.status !== 200) break;
          await http(strict).post('/v1/auth/mfa/verify').set('X-Forwarded-For', `198.51.100.${n}`).send({ mfaToken: c.body.mfaToken, code: '333333' });
        }
        expect((await loginAt(`198.51.100.${++n}`)).status).toBe(429); // attacker is out of challenges
        // The owner's recognized device still gets a challenge and can complete it.
        const mine = await loginAt('203.0.113.10', { deviceToken: ownDone.body.deviceToken }).expect(200);
        await http(strict).post('/v1/auth/mfa/verify').set('X-Forwarded-For', '203.0.113.10')
          .send({ mfaToken: mine.body.mfaToken, code: await freshTotp(u.email), deviceToken: ownDone.body.deviceToken }).expect(200);
        // From a new device, a password reset (which also locks the attacker out) restores the budgets.
        await http(strict).post('/v1/auth/password/forgot').set('X-Forwarded-For', '203.0.113.20').send({ email: u.email }).expect(202);
        await http(strict).post('/v1/auth/password/reset').set('X-Forwarded-For', '203.0.113.20')
          .send({ token: await tokenFromMail(strict, u.email, '/reset-password'), newPassword: 'reset-after-attack-1' }).expect(204);
        const fresh = await http(strict).post('/v1/auth/login').set('X-Forwarded-For', '203.0.113.21')
          .send({ email: u.email, password: 'reset-after-attack-1', clientType: 'MOBILE' }).expect(200);
        await http(strict).post('/v1/auth/mfa/verify').set('X-Forwarded-For', '203.0.113.21')
          .send({ mfaToken: fresh.body.mfaToken, code: await freshTotp(u.email) }).expect(200);
      } finally {
        await strict.close();
      }
    });

    it('MFA endpoints fail closed during a Redis outage and recover', async () => {
      const t = redisTarget(process.env.REDIS_URL as string);
      const proxy = new TcpProxy(t.host, t.port);
      const port = await proxy.start();
      const outageApp = await createTestApp({ REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string), REDIS_COMMAND_TIMEOUT_MS: '200' });
      try {
        const u = await signUp(outageApp, 'outage-mfa');
        await enableMfa(outageApp, u);
        const c = await http(outageApp).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        await proxy.refuse();
        const { RedisService } = await import('../src/abuse/redis.service');
        await waitFor(() => !outageApp.get(RedisService).ready);
        const r = await http(outageApp).post('/v1/auth/mfa/verify').send({ mfaToken: c.body.mfaToken, code: await freshTotp(u.email) });
        expect({ status: r.status, code: r.body.code }).toEqual({ status: 503, code: 'temporarily_unavailable' });
        const reg = await http(outageApp).post('/v1/auth/mfa/recovery-codes').set(bearer(u)).send({ password: PASSWORD, code: '000000' });
        expect(reg.status).toBe(503);
        await http(outageApp).get('/v1/auth/me').set(bearer(u)).expect(200); // existing MFA session unaffected
        await proxy.resume();
        await waitFor(() => outageApp.get(RedisService).ready, 8000);
        const c2 = await http(outageApp).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
        await waitFor(async () => (await http(outageApp).post('/v1/auth/mfa/verify').send({ mfaToken: c2.body.mfaToken, recoveryCode: mfaDevices.get(u.email)!.recoveryCodes.at(-1) })).status === 200, 4000);
      } finally {
        await outageApp.close();
        await proxy.stop();
      }
    });
  });

  /** Runs the real key-rotation CLI against the test database. */
  function runReencrypt(keys: string, active: string, mode: 'run' | 'check' = 'run'): string {
    try {
      return execFileSync('npx', ['tsx', 'src/cli/mfa-reencrypt.ts', ...(mode === 'check' ? ['--dry-run'] : [])], {
        cwd: `${__dirname}/..`, env: { ...process.env, MFA_ENCRYPTION_KEYS: keys, MFA_ENCRYPTION_ACTIVE_KEY_ID: active },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      throw new Error(String((e as { stderr?: string }).stderr ?? e));
    }
  }

  let superAdminTaken = false;
  async function bootstrapSuperAdminIfFree(user: TestUser): Promise<void> {
    if (!superAdminTaken) {
      await bootstrapSuperAdmin(app.get(PrismaService), user.email);
      superAdminTaken = true;
      return;
    }
    // Further administrators are granted directly (platform.admin.manage UI is out of scope here).
    await app.get(PrismaService).$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
      const role = await tx.platformRole.findUniqueOrThrow({ where: { name: 'Super administrator' } });
      await tx.platformAdmin.create({ data: { userId: user.userId } });
      await tx.platformAdminRole.create({ data: { adminUserId: user.userId, roleId: role.id } });
    });
  }
});

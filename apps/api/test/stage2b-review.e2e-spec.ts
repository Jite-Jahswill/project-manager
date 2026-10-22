/**
 * Stage 2B final review regressions (docs/security/mfa.md §12). Each test names its finding.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service';
import {
  bearer, createOrg, createTestApp, enableMfa, freshTotp, http, mfaDevices, PASSWORD, resetDatabase, roleId, signUp, tokenFromMail, addMember,
} from './support/harness';

jest.setTimeout(120_000);

describe('Stage 2B review regressions', () => {
  let app: INestApplication;
  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('A-2: a password reset voids MFA challenges obtained with the old password', async () => {
    const u = await signUp(app, 'a2-victim');
    await enableMfa(app, u);
    // Attacker knows the old password and holds the second factor (e.g. a stolen phone).
    const stale = await http(app).post('/v1/auth/login').send({ email: u.email, password: PASSWORD, clientType: 'MOBILE' }).expect(200);
    expect(stale.body.mfaRequired).toBe(true);
    // The owner notices and resets the password.
    await http(app).post('/v1/auth/password/forgot').send({ email: u.email }).expect(202);
    await http(app).post('/v1/auth/password/reset').send({ token: tokenFromMail(app, u.email, '/reset-password'), newPassword: 'owner-new-password-1' }).expect(204);
    // The pre-reset challenge must be dead even with a valid second factor.
    await http(app).post('/v1/auth/mfa/verify').send({ mfaToken: stale.body.mfaToken, code: await freshTotp(u.email) }).expect(401);
  });

  it('A-3: the API refuses to start when a key still protecting MFA secrets is missing from the ring', async () => {
    const u = await signUp(app, 'a3-user');
    await enableMfa(app, u); // sealed under the test key
    const other = `k9:${Buffer.alloc(32, 99).toString('base64')}`;
    const outcome = await createTestApp({ MFA_ENCRYPTION_KEYS: other, MFA_ENCRYPTION_ACTIVE_KEY_ID: 'k9' }).then(
      async (started) => { await started.close(); return 'started'; },
      (e: Error) => e.message,
    );
    expect(outcome).toMatch(/MFA_ENCRYPTION_KEYS.*k1/);
  });

  it('A-4: demotion relaxes the policy only until the next promotion', async () => {
    const owner = await signUp(app, 'a4-owner');
    const org = await createOrg(app, owner, 'a4-org');
    const second = await addMember(app, org, 'a4-second', 'Read-only viewer');
    const ownerRole = await roleId(app, org, 'Owner');
    const viewer = await roleId(app, org, 'Read-only viewer');
    await http(app).put(`/v1/orgs/${org.id}/members/${second.membershipId}/roles`).set(bearer(owner)).send({ assignments: [{ roleId: ownerRole }] }).expect(200);
    expect((await http(app).get(`/v1/orgs/${org.id}`).set(bearer(second))).body.code).toBe('mfa_required');
    await enableMfa(app, second);
    await http(app).get(`/v1/orgs/${org.id}`).set(bearer(second)).expect(200);
    // Demoted: MFA becomes optional, so it can be turned off...
    await http(app).put(`/v1/orgs/${org.id}/members/${second.membershipId}/roles`).set(bearer(owner)).send({ assignments: [{ roleId: viewer }] }).expect(200);
    await http(app).post('/v1/auth/mfa/disable').set(bearer(second)).send({ password: PASSWORD, code: await freshTotp(second.email) }).expect(204);
    mfaDevices.delete(second.email);
    await http(app).get(`/v1/orgs/${org.id}`).set(bearer(second)).expect(200);
    // ...and re-promotion immediately restricts the same session again.
    await http(app).put(`/v1/orgs/${org.id}/members/${second.membershipId}/roles`).set(bearer(owner)).send({ assignments: [{ roleId: ownerRole }] }).expect(200);
    expect((await http(app).get(`/v1/orgs/${org.id}`).set(bearer(second))).body.code).toBe('mfa_required');
    expect((await http(app).get('/v1/me/organizations').set(bearer(second))).body.code).toBe('mfa_required');
    void app.get(PrismaService);
  });
});

/**
 * Stage 2A review regressions (docs/security/rate-limiting-and-abuse-protection.md §7).
 * Each test names its finding.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, http, PASSWORD, resetDatabase, signUp, tokenFromMail, uniqueEmail, bearer, createOrg } from './support/harness';
import { redisTarget, redisUrlVia, TcpProxy, waitFor } from './support/tcp-proxy';

const STRICT = { RATE_LIMIT_OVERRIDES: '', TRUSTED_PROXIES: '127.0.0.1,::1' };

describe('Stage 2A review regressions', () => {
  let setup: INestApplication;
  let strict: INestApplication;
  let n = 0;
  const newIp = () => `198.19.${Math.floor(++n / 250)}.${(n % 250) + 1}`;
  const loginFrom = (app: INestApplication, ip: string, email: string, password: string, extra: object = {}) =>
    http(app).post('/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password, clientType: 'MOBILE', ...extra });

  beforeAll(async () => {
    await resetDatabase();
    setup = await createTestApp();
    strict = await createTestApp(STRICT);
  });
  afterAll(async () => {
    await strict.close();
    await setup.close();
  });

  it('F-A: many legitimate users behind one shared address (office/CGNAT) can all sign in', async () => {
    const office = newIp();
    const users = [];
    for (let i = 0; i < 40; i++) users.push(await signUp(setup, `office${i}`));
    const statuses = [];
    for (const u of users) statuses.push((await loginFrom(strict, office, u.email, PASSWORD)).status);
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  });

  it('F-A: an insider exhausting the shared address cannot lock out returning users (recognized devices)', async () => {
    const office = newIp();
    const colleague = await signUp(setup, 'colleague');
    const first = await loginFrom(strict, office, colleague.email, PASSWORD).expect(200);
    for (let i = 0; i < 40; i++) await loginFrom(strict, office, uniqueEmail('spray'), 'wrong-password');
    expect((await loginFrom(strict, office, uniqueEmail('spray'), 'wrong-password')).status).toBe(429);
    expect((await loginFrom(strict, office, colleague.email, PASSWORD, { deviceToken: first.body.deviceToken })).status).toBe(200);
  });

  it("F-A: the owner's success does not wipe an attacker's failures from a shared address", async () => {
    const shared = newIp();
    const victim = await signUp(setup, 'shared-victim');
    for (let i = 0; i < 4; i++) await loginFrom(strict, shared, victim.email, 'attacker-guess').expect(401);
    await loginFrom(strict, shared, victim.email, PASSWORD).expect(200);
    // With a reset-on-success, the attacker would get 5 fresh guesses here; with refunds, only 1 remains.
    expect((await loginFrom(strict, shared, victim.email, 'attacker-guess')).status).toBe(401);
    expect((await loginFrom(strict, shared, victim.email, 'attacker-guess')).status).toBe(429);
  });

  it('F-B: a password reset revokes every previously issued recognized-device token', async () => {
    const victim = await signUp(setup, 'revoke-victim');
    // The "intruder" once signed in (e.g. with a phished password) and kept the token.
    const intruder = await loginFrom(strict, newIp(), victim.email, PASSWORD).expect(200);
    await http(strict).post('/v1/auth/password/forgot').set('X-Forwarded-For', newIp()).send({ email: victim.email }).expect(202);
    await http(strict).post('/v1/auth/password/reset').set('X-Forwarded-For', newIp())
      .send({ token: await tokenFromMail(strict, victim.email, '/reset-password'), newPassword: 'owner-recovered-pw1' }).expect(204);
    // Exhaust the per-account bucket for unrecognized clients...
    for (let i = 0; i < 20; i++) await loginFrom(strict, newIp(), victim.email, 'guess');
    // ...the intruder's old token must no longer select the recognized-device bucket.
    expect((await loginFrom(strict, newIp(), victim.email, 'guess', { deviceToken: intruder.body.deviceToken })).status).toBe(429);
  });

  describe('fail-open endpoints during a Redis outage keep their independent protections', () => {
    let proxy: TcpProxy;
    let app: INestApplication;

    beforeAll(async () => {
      const t = redisTarget(process.env.REDIS_URL as string);
      proxy = new TcpProxy(t.host, t.port);
      const port = await proxy.start();
      app = await createTestApp({ REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string), REDIS_COMMAND_TIMEOUT_MS: '200' });
    });
    afterAll(async () => {
      await app.close();
      await proxy.stop();
    });

    const outage = async () => {
      await proxy.refuse();
      const { RedisService } = await import('../src/abuse/redis.service');
      await waitFor(() => !app.get(RedisService).ready);
    };
    const recover = async () => {
      await proxy.resume();
      const { RedisService } = await import('../src/abuse/redis.service');
      await waitFor(() => app.get(RedisService).ready, 8000);
    };

    it('email verification: still single-use and token-validated', async () => {
      const email = uniqueEmail('verify-outage');
      await http(app).post('/v1/auth/register').send({ email, password: PASSWORD, displayName: 'v' }).expect(202);
      const token = await tokenFromMail(app, email, '/verify-email');
      await outage();
      try {
        await http(app).post('/v1/auth/verify-email').send({ token: 'z'.repeat(43) }).expect(400);
        await http(app).post('/v1/auth/verify-email').send({ token }).expect(200);
        await http(app).post('/v1/auth/verify-email').send({ token }).expect(400); // replay rejected
      } finally {
        await recover();
      }
    });

    it('invitation acceptance: still bound to the invitee, single-use and member-limited', async () => {
      const owner = await signUp(app, 'inv-out-owner');
      const org = await createOrg(app, owner, 'inv-out');
      const invitee = await signUp(app, 'inv-out-invitee');
      const stranger = await signUp(app, 'inv-out-stranger');
      await http(app).post(`/v1/orgs/${org.id}/invitations`).set(bearer(owner)).send({ email: invitee.email }).expect(201);
      const token = await tokenFromMail(app, invitee.email, '/accept-invitation');
      await outage();
      try {
        await http(app).post('/v1/invitations/accept').set(bearer(stranger)).send({ token }).expect(400);
        await http(app).post('/v1/invitations/accept').set(bearer(invitee)).send({ token: `${org.id}.${'q'.repeat(43)}` }).expect(400);
        await http(app).post('/v1/invitations/accept').set(bearer(invitee)).send({ token }).expect(200);
        await http(app).post('/v1/invitations/accept').set(bearer(invitee)).send({ token }).expect(400); // replay rejected
        // Inviting more (mail-sending) fails closed during the outage.
        const r = await http(app).post(`/v1/orgs/${org.id}/invitations`).set(bearer(owner)).send({ email: uniqueEmail('more') });
        expect(r.status).toBe(503);
        expect(JSON.stringify(r.body)).not.toMatch(/redis|ECONNREFUSED|ioredis|stack/i);
      } finally {
        await recover();
      }
    });
  });
});

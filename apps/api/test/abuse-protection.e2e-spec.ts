/**
 * Authentication-abuse protection end to end (HTTP + real PostgreSQL + real Redis).
 * docs/security/rate-limiting-and-abuse-protection.md
 *
 * `strict` runs the production default policies and trusts the loopback test client as a
 * proxy, so each request can present a different client IP via X-Forwarded-For.
 * Users are created through `setup` (high limits, separate Redis key prefix).
 */
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/abuse/redis.service';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap';
import {
  bearer, createOrg, createTestApp, enableMfa, http, login, mailsTo, PASSWORD, resetDatabase, signUp, TestUser, tokenFromMail, uniqueEmail,
} from './support/harness';
import { redisTarget, redisUrlVia, TcpProxy, waitFor } from './support/tcp-proxy';

const STRICT = { RATE_LIMIT_OVERRIDES: '', TRUSTED_PROXIES: '127.0.0.1,::1' };

describe('Authentication abuse protection', () => {
  let setup: INestApplication;
  let strict: INestApplication;
  let ipCounter = 0;
  /** A fresh, unique client IP for each call. */
  const newIp = () => `198.18.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`;

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

  describe('login: no trivial victim lockout', () => {
    it('one attacker network is throttled on the victim account; the victim elsewhere is not', async () => {
      const victim = await signUp(setup, 'victim-1');
      const attacker = newIp();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push((await loginFrom(strict, attacker, victim.email, 'wrong-password-x')).status);
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
      // Even the right password is refused from the attacker's network (no oracle)...
      expect((await loginFrom(strict, attacker, victim.email, PASSWORD)).status).toBe(429);
      // ...while the real owner, from their own network, signs in normally.
      expect((await loginFrom(strict, newIp(), victim.email, PASSWORD)).status).toBe(200);
    });

    it("a distributed attack throttles unrecognized clients, never the owner's recognized device", async () => {
      const victim = await signUp(setup, 'victim-2');
      const first = await loginFrom(strict, newIp(), victim.email, PASSWORD).expect(200);
      const deviceToken = first.body.deviceToken as string;
      expect(deviceToken).toMatch(/^vdd1\./);

      let attempts = 0;
      let status = 401;
      while (status !== 429 && attempts < 40) {
        status = (await loginFrom(strict, newIp(), victim.email, 'distributed-guess')).status;
        attempts++;
      }
      expect(status).toBe(429);
      // Exactly 20 failures per hour per account for unrecognized clients; the owner's own
      // successful login was refunded and did not use one of them.
      expect(attempts).toBe(21);

      // A new, unrecognized device of the owner is throttled too (documented trade-off)...
      expect((await loginFrom(strict, newIp(), victim.email, PASSWORD)).status).toBe(429);
      // ...but the owner's recognized device is not.
      const ok = await loginFrom(strict, newIp(), victim.email, PASSWORD, { deviceToken }).expect(200);
      expect(ok.body.deviceToken).toMatch(/^vdd1\./);

      // Recovery from a new device: a password reset (inbox control) clears the account bucket.
      await http(strict).post('/v1/auth/password/forgot').set('X-Forwarded-For', newIp()).send({ email: victim.email }).expect(202);
      await http(strict).post('/v1/auth/password/reset').set('X-Forwarded-For', newIp())
        .send({ token: await tokenFromMail(strict, victim.email, '/reset-password'), newPassword: 'recovered-password-1' }).expect(204);
      expect((await loginFrom(strict, newIp(), victim.email, 'recovered-password-1')).status).toBe(200);
    });

    it("an attacker's own device token does not unlock someone else's account", async () => {
      const victim = await signUp(setup, 'victim-3');
      const attackerUser = await signUp(setup, 'attacker-3');
      const own = await loginFrom(strict, newIp(), attackerUser.email, PASSWORD).expect(200);
      for (let i = 0; i < 20; i++) await loginFrom(strict, newIp(), victim.email, 'guess', { deviceToken: own.body.deviceToken });
      expect((await loginFrom(strict, newIp(), victim.email, 'guess', { deviceToken: own.body.deviceToken })).status).toBe(429);
      // A forged or tampered token is simply unrecognized.
      const tampered = `${own.body.deviceToken}x`;
      expect((await loginFrom(strict, newIp(), victim.email, 'guess', { deviceToken: tampered })).status).toBe(429);
    });

    it('limits and responses are identical for registered and unknown emails (no enumeration)', async () => {
      const victim = await signUp(setup, 'victim-4');
      const ipA = newIp();
      const ipB = newIp();
      const run = async (ip: string, email: string) => {
        const out: { status: number; body: unknown; retryAfter: boolean }[] = [];
        for (let i = 0; i < 6; i++) {
          const r = await loginFrom(strict, ip, email, 'wrong-password-x');
          out.push({ status: r.status, body: r.body, retryAfter: r.headers['retry-after'] !== undefined });
        }
        return out;
      };
      const real = await run(ipA, victim.email);
      const unknown = await run(ipB, uniqueEmail('nobody'));
      expect(unknown).toEqual(real);
      expect(real[5]).toEqual({ status: 429, body: { statusCode: 429, code: 'rate_limited', message: 'Too many requests. Try again later.' }, retryAfter: true });
    });

    it('429 carries an integer Retry-After matching the policy', async () => {
      const victim = await signUp(setup, 'victim-5');
      const ip = newIp();
      for (let i = 0; i < 5; i++) await loginFrom(strict, ip, victim.email, 'wrong');
      const r = await loginFrom(strict, ip, victim.email, 'wrong').expect(429);
      const retry = Number(r.headers['retry-after']);
      expect(Number.isInteger(retry)).toBe(true);
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(retry).toBeLessThanOrEqual(180); // login.ip_account 5/15min -> one attempt per 3 min
    });

    it('one network spraying many accounts is throttled (login.ip)', async () => {
      const ip = newIp();
      const statuses: number[] = [];
      for (let i = 0; i < 32; i++) statuses.push((await loginFrom(strict, ip, uniqueEmail('spray'), 'x-password')).status);
      expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(30)).toEqual([429, 429]);
    });

    it('the old database lockout is gone: failures no longer lock the account', async () => {
      const victim = await signUp(setup, 'victim-6');
      for (let i = 0; i < 12; i++) await loginFrom(strict, newIp(), victim.email, 'wrong');
      const row = await strict.get(PrismaService).user.findUniqueOrThrow({ where: { id: victim.userId } });
      expect(row.lockedUntil).toBeNull();
      expect(row.failedLoginCount).toBe(0);
    });
  });

  describe('mail-sending endpoints', () => {
    it('password-reset requests are limited per email across networks, identically for unknown emails', async () => {
      const victim = await signUp(setup, 'reset-victim');
      const seq = async (email: string) => {
        const s: number[] = [];
        for (let i = 0; i < 5; i++) s.push((await http(strict).post('/v1/auth/password/forgot').set('X-Forwarded-For', newIp()).send({ email })).status);
        return s;
      };
      expect(await seq(victim.email)).toEqual([202, 202, 202, 429, 429]);
      expect(await seq(uniqueEmail('ghost'))).toEqual([202, 202, 202, 429, 429]);
      // Only 3 reset mails reached the victim.
      // Delivery is asynchronous: wait for the worker, then make sure no 4th mail follows.
      await waitFor(() => mailsTo(victim.email).filter((m) => m.text.includes('/reset-password')).length >= 3);
      await new Promise((r) => setTimeout(r, 300));
      expect(mailsTo(victim.email).filter((m) => m.text.includes('/reset-password'))).toHaveLength(3);
    });

    it('one network cannot request resets for many emails (forgot.ip)', async () => {
      const ip = newIp();
      const s: number[] = [];
      for (let i = 0; i < 12; i++) s.push((await http(strict).post('/v1/auth/password/forgot').set('X-Forwarded-For', ip).send({ email: uniqueEmail('many') })).status);
      expect(s.slice(0, 10).every((x) => x === 202)).toBe(true);
      expect(s.slice(10)).toEqual([429, 429]);
    });

    it('registration is limited per network and per email, identically for existing emails', async () => {
      const ip = newIp();
      const s: number[] = [];
      for (let i = 0; i < 11; i++) {
        s.push((await http(strict).post('/v1/auth/register').set('X-Forwarded-For', ip).send({ email: uniqueEmail('bulk'), password: PASSWORD, displayName: 'b' })).status);
      }
      expect(s.slice(0, 10).every((x) => x === 202)).toBe(true);
      expect(s[10]).toBe(429);
      const existing = await signUp(setup, 'existing');
      const fresh = uniqueEmail('fresh-reg');
      const seq = async (email: string) => {
        const out: number[] = [];
        for (let i = 0; i < 4; i++) out.push((await http(strict).post('/v1/auth/register').set('X-Forwarded-For', newIp()).send({ email, password: PASSWORD, displayName: 'x' })).status);
        return out;
      };
      expect(await seq(existing.email)).toEqual([202, 202, 202, 429]);
      expect(await seq(fresh)).toEqual([202, 202, 202, 429]);
    });

    it('verification resends are limited per email', async () => {
      const email = uniqueEmail('resend');
      const s: number[] = [];
      for (let i = 0; i < 4; i++) s.push((await http(strict).post('/v1/auth/verify-email/resend').set('X-Forwarded-For', newIp()).send({ email })).status);
      expect(s).toEqual([202, 202, 202, 429]);
    });
  });

  describe('client IP trust', () => {
    it('without trusted proxies, rotating X-Forwarded-For does not bypass the limit', async () => {
      const direct = await createTestApp({ RATE_LIMIT_OVERRIDES: '', TRUSTED_PROXIES: '' });
      try {
        const victim = await signUp(setup, 'spoof-victim');
        const s: number[] = [];
        for (let i = 0; i < 7; i++) s.push((await loginFrom(direct, newIp(), victim.email, 'wrong')).status);
        expect(s).toEqual([401, 401, 401, 401, 401, 429, 429]);
        // Other spoofing headers are never read either.
        const r = await http(direct).post('/v1/auth/login').set('Forwarded', `for=${newIp()}`).set('X-Real-IP', newIp())
          .send({ email: victim.email, password: 'wrong', clientType: 'MOBILE' });
        expect(r.status).toBe(429);
      } finally {
        await direct.close();
      }
    });

    it('audit events record the resolved client IP, not the proxy', async () => {
      const u = await signUp(setup, 'audit-ip');
      await loginFrom(strict, '203.0.113.77', u.email, PASSWORD).expect(200);
      const events = await strict.get(PrismaService).$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
        return tx.auditEvent.findMany({ where: { action: 'auth.login.succeeded', actorUserId: u.userId } });
      });
      expect(events.map((e) => e.ipAddress)).toContain('203.0.113.77');
    });
  });

  describe('authenticated sensitive actions', () => {
    it('re-authentication is limited per session, without locking the account', async () => {
      const u = await signUp(setup, 'reauth');
      const session = await login(strict, u.email); // from the loopback client
      const s: number[] = [];
      for (let i = 0; i < 6; i++) s.push((await http(strict).post('/v1/auth/reauthenticate').set(bearer(session)).send({ password: 'wrong-guess' })).status);
      expect(s).toEqual([401, 401, 401, 401, 401, 429]);
      expect((await loginFrom(strict, newIp(), u.email, PASSWORD)).status).toBe(200); // account still usable
    });

    it("invitation limits apply per organization after authorization: outsiders cannot burn an org's allowance", async () => {
      const app = await createTestApp({ RATE_LIMIT_OVERRIDES: 'invite.org=3/1h,invite.user=100/1h' });
      try {
        const ownerB = await signUp(app, 'inv-owner');
        const orgB = await createOrg(app, ownerB, 'inv-org');
        const outsider = await signUp(app, 'inv-outsider');
        for (let i = 0; i < 10; i++) {
          await http(app).post(`/v1/orgs/${orgB.id}/invitations`).set(bearer(outsider)).send({ email: uniqueEmail('x') }).expect(403);
        }
        const s: number[] = [];
        for (let i = 0; i < 4; i++) s.push((await http(app).post(`/v1/orgs/${orgB.id}/invitations`).set(bearer(ownerB)).send({ email: uniqueEmail('y') })).status);
        expect(s).toEqual([201, 201, 201, 429]);
      } finally {
        await app.close();
      }
    });

    it('privileged platform operations are limited per administrator', async () => {
      const app = await createTestApp({ RATE_LIMIT_OVERRIDES: 'platform.privileged.user=2/1h' });
      try {
        const owner = await signUp(app, 'plat-target');
        const org = await createOrg(app, owner, 'plat-target-org');
        const admin = await signUp(app, 'plat-limited');
        await bootstrapSuperAdmin(app.get(PrismaService), admin.email);
        await enableMfa(app, admin);
        const s: number[] = [];
        for (let i = 0; i < 3; i++) s.push((await http(app).patch(`/v1/platform/organizations/${org.id}/status`).set(bearer(admin)).send({ status: 'ACTIVE' })).status);
        expect(s).toEqual([200, 200, 429]);
      } finally {
        await app.close();
      }
    });

    it('the global limit runs before authentication (floods never reach the session lookup)', async () => {
      const app = await createTestApp({ RATE_LIMIT_OVERRIDES: 'default.ip=3/1m' });
      try {
        const s: number[] = [];
        for (let i = 0; i < 5; i++) s.push((await http(app).get('/v1/auth/me').set('Authorization', 'Bearer not-a-token')).status);
        expect(s).toEqual([401, 401, 401, 429, 429]);
      } finally {
        await app.close();
      }
    });
  });

  describe('startup readiness', () => {
    it('a freshly started instance is connected to Redis before it serves its first request', async () => {
      // Regression (phase 4 gate): requests arriving while the connection was still being set up
      // were refused with 503 by fail-closed routes such as registration.
      for (let i = 0; i < 3; i++) {
        const fresh = await createTestApp();
        try {
          expect(fresh.get(RedisService).ready).toBe(true);
          await http(fresh).post('/v1/auth/register').send({ email: `ready-${Date.now()}-${i}@example.test`, password: 'correct-horse-battery-staple', displayName: 'Ready' }).expect(202);
        } finally {
          await fresh.close();
        }
      }
    });

    it('an unreachable Redis does not block startup beyond the connect timeout (the instance starts degraded)', async () => {
      const started = Date.now();
      const degraded = await createTestApp({ REDIS_URL: 'redis://:x@127.0.0.1:1/1', REDIS_CONNECT_TIMEOUT_MS: '300' });
      try {
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(degraded.get(RedisService).ready).toBe(false);
        await http(degraded).post('/v1/auth/register').send({ email: `degraded-${Date.now()}@example.test`, password: 'correct-horse-battery-staple', displayName: 'D' }).expect(503);
      } finally {
        await degraded.close();
      }
    });
  });

  describe('Redis outage over HTTP', () => {
    let proxy: TcpProxy;
    let app: INestApplication;
    let user: TestUser;

    beforeAll(async () => {
      const t = redisTarget(process.env.REDIS_URL as string);
      proxy = new TcpProxy(t.host, t.port);
      const port = await proxy.start();
      app = await createTestApp({ REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string), REDIS_COMMAND_TIMEOUT_MS: '200' });
      user = await signUp(app, 'outage');
      await proxy.refuse();
      const { RedisService } = await import('../src/abuse/redis.service');
      await waitFor(() => !app.get(RedisService).ready);
    });
    afterAll(async () => {
      await app.close();
      await proxy.stop();
    });

    it('fail-closed endpoints answer 503 with Retry-After; nothing is silently unlimited', async () => {
      for (const [path, body] of [
        ['/v1/auth/login', { email: user.email, password: PASSWORD, clientType: 'MOBILE' }],
        ['/v1/auth/password/forgot', { email: user.email }],
        ['/v1/auth/register', { email: uniqueEmail('o'), password: PASSWORD, displayName: 'o' }],
        ['/v1/auth/verify-email/resend', { email: user.email }],
        ['/v1/auth/password/reset', { token: 'x'.repeat(20), newPassword: 'whatever-password' }],
      ] as const) {
        const r = await http(app).post(path).send(body);
        expect({ path, status: r.status, code: r.body.code, retryAfter: r.headers['retry-after'] }).toEqual({ path, status: 503, code: 'temporarily_unavailable', retryAfter: '5' });
      }
    });

    it('fail-open paths keep working: existing sessions, refresh, token-gated verification', async () => {
      await http(app).get('/v1/auth/me').set(bearer(user)).expect(200);
      const r = await http(app).post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(200);
      expect(r.body.accessToken).toBeDefined();
      await http(app).post('/v1/auth/verify-email').send({ token: 'y'.repeat(30) }).expect(400); // reached the handler
    });

    it('health reports degraded, not down', async () => {
      const r = await http(app).get('/health').expect(200);
      expect(r.body).toMatchObject({ status: 'degraded', database: 'up', redis: 'down' });
    });

    it('recovers when Redis returns', async () => {
      await proxy.resume();
      const { RedisService } = await import('../src/abuse/redis.service');
      await waitFor(() => app.get(RedisService).ready, 8000);
      await waitFor(async () => (await http(app).post('/v1/auth/login').send({ email: user.email, password: PASSWORD, clientType: 'MOBILE' })).status === 200, 4000);
      expect((await http(app).get('/health')).body.status).toBe('ok');
    });
  });
});

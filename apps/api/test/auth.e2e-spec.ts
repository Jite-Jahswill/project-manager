import { INestApplication } from '@nestjs/common';
import { bearer, createTestApp, http, login, PASSWORD, resetDatabase, signUp, tokenFromMail, uniqueEmail } from './support/harness';

describe('Authentication and sessions', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('register does not reveal whether an email is already registered', async () => {
    const user = await signUp(app, 'enum');
    const first = await http(app).post('/v1/auth/register').send({ email: uniqueEmail('fresh'), password: PASSWORD, displayName: 'x' });
    const dup = await http(app).post('/v1/auth/register').send({ email: user.email, password: PASSWORD, displayName: 'x' });
    expect(first.status).toBe(202);
    expect(dup.status).toBe(202);
    expect(dup.body).toEqual(first.body);
  });

  it('requires email verification before login', async () => {
    const email = uniqueEmail('unverified');
    await http(app).post('/v1/auth/register').send({ email, password: PASSWORD, displayName: 'u' }).expect(202);
    const res = await http(app).post('/v1/auth/login').send({ email, password: PASSWORD, clientType: 'MOBILE' });
    expect(res.status).toBe(403);
  });

  it('rejects wrong passwords and unknown emails with the same response', async () => {
    const user = await signUp(app, 'wrongpw');
    const bad = await http(app).post('/v1/auth/login').send({ email: user.email, password: 'not-the-password!!', clientType: 'MOBILE' });
    const unknown = await http(app).post('/v1/auth/login').send({ email: uniqueEmail('nobody'), password: 'not-the-password!!', clientType: 'MOBILE' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body).toEqual(unknown.body);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    const user = await signUp(app, 'lockout');
    for (let i = 0; i < 5; i++) {
      await http(app).post('/v1/auth/login').send({ email: user.email, password: 'wrong-password-123', clientType: 'MOBILE' }).expect(401);
    }
    await http(app).post('/v1/auth/login').send({ email: user.email, password: PASSWORD, clientType: 'MOBILE' }).expect(401);
  });

  it('rotates refresh tokens and revokes the session when an old token is reused', async () => {
    const user = await signUp(app, 'rotate');
    const r1 = await http(app).post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(user.refreshToken);
    // Replaying the first (now used) token = theft signal.
    await http(app).post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
    // The legitimate newest token is dead too, and so is the access token.
    await http(app).post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await http(app).get('/v1/auth/me').set({ Authorization: `Bearer ${r1.body.accessToken}` }).expect(401);
  });

  it('logout invalidates the access token immediately', async () => {
    const user = await signUp(app, 'logout');
    await http(app).get('/v1/auth/me').set(bearer(user)).expect(200);
    await http(app).post('/v1/auth/logout').set(bearer(user)).expect(204);
    await http(app).get('/v1/auth/me').set(bearer(user)).expect(401);
  });

  it('password reset revokes every existing session', async () => {
    const user = await signUp(app, 'reset');
    const second = await login(app, user.email);
    await http(app).post('/v1/auth/password/forgot').send({ email: user.email }).expect(202);
    const token = tokenFromMail(app, user.email, '/reset-password');
    await http(app).post('/v1/auth/password/reset').send({ token, newPassword: 'a-brand-new-password' }).expect(204);
    await http(app).get('/v1/auth/me').set(bearer(user)).expect(401);
    await http(app).get('/v1/auth/me').set(bearer(second)).expect(401);
    // Reset links are single-use.
    await http(app).post('/v1/auth/password/reset').send({ token, newPassword: 'another-new-password' }).expect(400);
  });

  it('web login uses HTTP-only cookies and enforces CSRF on unsafe requests', async () => {
    const user = await signUp(app, 'web');
    const res = await http(app).post('/v1/auth/login').send({ email: user.email, password: PASSWORD, clientType: 'WEB' }).expect(200);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = res.get('set-cookie') as unknown as string[];
    expect(cookies.find((c) => c.startsWith('vd_at='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('vd_rt='))).toMatch(/HttpOnly/);
    const jar = cookies.map((c) => c.split(';')[0]).join('; ');
    const csrf = cookies.find((c) => c.startsWith('vd_csrf='))!.split(';')[0].split('=')[1];

    await http(app).get('/v1/auth/me').set('Cookie', jar).expect(200);
    await http(app).post('/v1/organizations').set('Cookie', jar).send({ name: 'Web org', slug: 'csrf-test-org' }).expect(403);
    await http(app).post('/v1/organizations').set('Cookie', jar).set('x-csrf-token', csrf).send({ name: 'Web org', slug: 'csrf-test-org' }).expect(201);
  });

  it('access tokens carry identity only, never roles or permissions', async () => {
    const user = await signUp(app, 'claims');
    const payload = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'typ']);
  });

  it('rate-limits credential endpoints per client', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await http(limited).post('/v1/auth/password/forgot').send({ email: uniqueEmail('rl') });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 3)).toEqual([202, 202, 202]);
      expect(statuses.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

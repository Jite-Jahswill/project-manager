/**
 * Structural guarantee: every route under /v1/orgs/:orgId declares an
 * organization access requirement, and every /v1/platform route except /me
 * declares a platform permission. A new unguarded endpoint fails the build.
 */
import { INestApplication } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ORG_ACCESS } from '../src/authz/org-access.guard';
import { PLATFORM_PERMISSION } from '../src/authz/platform-access.guard';
import { createTestApp } from './support/harness';
import { discoverRoutes } from './support/routes';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { rateLimitRules, RouteRateLimitGuard } from '../src/abuse/rate-limit.guard';

describe('Route guard coverage', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({}, [DiscoveryModule]);
  });
  afterAll(() => app.close());

  const routes = () => discoverRoutes(app);

  it('discovers the application routes', () => {
    expect(routes().length).toBeGreaterThan(30);
  });

  it('every organization-scoped route declares @RequirePermission or @RequireMembership', () => {
    const missing = routes().filter((r) => r.path.includes(':orgId') && !Reflect.getMetadata(ORG_ACCESS, r.handler));
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('every platform route except /v1/platform/me declares @RequirePlatformPermission', () => {
    const missing = routes().filter(
      (r) => r.path.startsWith('/v1/platform') && r.path !== '/v1/platform/me' && !Reflect.getMetadata(PLATFORM_PERMISSION, r.handler),
    );
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('only the expected routes are public', () => {
    const publicRoutes = routes().filter((r) => r.isPublic).map((r) => `${r.method} ${r.path}`).sort();
    expect(publicRoutes).toEqual([
      'GET /health',
      'POST /v1/auth/login',
      'POST /v1/auth/mfa/verify',
      'POST /v1/auth/password/forgot',
      'POST /v1/auth/password/reset',
      'POST /v1/auth/refresh',
      'POST /v1/auth/register',
      'POST /v1/auth/verify-email',
      'POST /v1/auth/verify-email/resend',
    ]);
  });

  it('every public state-changing route has an IP-keyed rate limit (login limits itself in AuthService)', () => {
    const missing = routes()
      .filter((r) => r.isPublic && r.method !== 'GET' && r.path !== '/v1/auth/login')
      .filter((r) => !rateLimitRules(r.handler).some((rule) => rule.subject === 'ip'))
      .map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it('the rate-limit guard is attached at most once per route (no double charging)', () => {
    for (const r of routes()) {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, r.handler) as unknown[] | undefined) ?? [];
      const count = guards.filter((g) => g === RouteRateLimitGuard).length;
      expect({ route: `${r.method} ${r.path}`, count: Math.min(count, 2) })
        .toEqual({ route: `${r.method} ${r.path}`, count: rateLimitRules(r.handler).length ? 1 : 0 });
    }
  });

  it('user- and session-keyed limits only appear on authenticated routes', () => {
    const bad = routes()
      .filter((r) => r.isPublic && rateLimitRules(r.handler).some((rule) => rule.subject === 'user' || rule.subject === 'session'))
      .map((r) => `${r.method} ${r.path}`);
    expect(bad).toEqual([]);
  });
});

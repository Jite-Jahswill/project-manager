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
      'POST /v1/auth/password/forgot',
      'POST /v1/auth/password/reset',
      'POST /v1/auth/refresh',
      'POST /v1/auth/register',
      'POST /v1/auth/verify-email',
      'POST /v1/auth/verify-email/resend',
    ]);
  });
});

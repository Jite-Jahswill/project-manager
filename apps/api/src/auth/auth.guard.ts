import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { safeEqual } from '../common/crypto';
import { Errors } from '../common/errors';
import type { VentidocRequest } from '../common/request-context';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { IS_PUBLIC } from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global authentication guard.
 *
 * Accepts a bearer token (mobile/API clients) or the HTTP-only access cookie (web).
 * Cookie-authenticated state-changing requests must also pass the CSRF
 * double-submit check. Every request re-checks the session row, so logout,
 * revocation, password reset and account suspension take effect immediately,
 * not when the access token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<VentidocRequest>();
    const header = req.get('authorization');
    let token: string | undefined;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
    } else if (req.cookies?.[ACCESS_COOKIE]) {
      token = req.cookies[ACCESS_COOKIE] as string;
      if (!SAFE_METHODS.has(req.method)) assertCsrf(req);
    }
    if (!token) throw Errors.unauthenticated();

    const claims = this.auth.verifyAccessToken(token);
    if (!claims) throw Errors.unauthenticated();

    const session = await this.prisma.session.findFirst({
      where: { id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } },
      select: { reauthenticatedAt: true, createdAt: true, user: { select: { passwordChangedAt: true } } },
    });
    if (!session) throw Errors.unauthenticated();
    // Backstop to explicit revocation: no session older than the last password change is honoured.
    if (session.user.passwordChangedAt && session.user.passwordChangedAt > session.createdAt) throw Errors.unauthenticated();

    req.auth = { userId: claims.sub, sessionId: claims.sid, reauthenticatedAt: session.reauthenticatedAt };
    return true;
  }
}

export function assertCsrf(req: VentidocRequest): void {
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) throw Errors.forbidden('CSRF token missing or invalid');
}

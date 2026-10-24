import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { safeEqual } from '../common/crypto';
import { Errors } from '../common/errors';
import type { VentidocRequest } from '../common/request-context';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { IS_PUBLIC, MFA_EXEMPT } from './decorators';
import { MfaPolicyService } from '../mfa/mfa-policy.service';

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
    private readonly mfaPolicy: MfaPolicyService,
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

    const session = await findActiveSession(this.prisma, claims.sub, claims.sid);
    if (!session) throw Errors.unauthenticated();

    req.auth = { userId: claims.sub, sessionId: claims.sid, reauthenticatedAt: session.reauthenticatedAt, mfaVerifiedAt: session.mfaVerifiedAt };

    // MFA enforcement for sessions that did not complete a second factor:
    //  - the account has MFA: such a session must not exist (signed in before MFA was
    //    turned on elsewhere, or a bug): reject outright;
    //  - MFA is mandatory for this user (platform admin / organization owner) but not
    //    set up yet: only the enrollment allowlist is reachable.
    if (!session.mfaVerifiedAt) {
      if (session.user.mfaEnabledAt) throw Errors.unauthenticated();
      const exempt = this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT, [context.getHandler(), context.getClass()]);
      if (!exempt && (await this.mfaPolicy.requiresMfa(claims.sub))) {
        throw Errors.mfaRequired('Set up two-step verification to continue (POST /v1/auth/mfa/enrollment)');
      }
    }
    return true;
  }
}

export function assertCsrf(req: VentidocRequest): void {
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) throw Errors.forbidden('CSRF token missing or invalid');
}

/**
 * The session row behind a token, if it may still be used: not revoked or expired, the user
 * active, and not older than the last password change (a backstop to explicit revocation).
 * Shared with long-lived connections (support event streams), which re-check it periodically.
 */
export async function findActiveSession(prisma: PrismaService, userId: string, sessionId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } },
    select: { reauthenticatedAt: true, mfaVerifiedAt: true, createdAt: true, user: { select: { passwordChangedAt: true, mfaEnabledAt: true } } },
  });
  if (!session) return null;
  if (session.user.passwordChangedAt && session.user.passwordChangedAt > session.createdAt) return null;
  return session;
}

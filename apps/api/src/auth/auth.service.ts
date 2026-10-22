import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientType, UserActionPurpose } from '../generated/prisma/client';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { hashToken, normalizeEmail, randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { rateLimitNetwork } from '../abuse/client-ip';
import { credentialEpoch, DeviceTokenService } from '../abuse/device-token.service';
import type { PolicyName } from '../abuse/policies';
import { RateLimiter } from '../abuse/rate-limiter.service';
import { CredentialStore } from './credential-store';
import { PasswordService } from './password.service';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60_000;
const PASSWORD_RESET_TTL_MS = 60 * 60_000;

export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly credentials: CredentialStore,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limiter: RateLimiter,
    private readonly devices: DeviceTokenService,
  ) {}

  /**
   * Always resolves the same way whether or not the email is taken, so the
   * endpoint cannot be used to discover registered addresses.
   */
  async register(input: { email: string; password: string; displayName: string }, meta: RequestMeta): Promise<void> {
    const email = normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await this.mail.send({
        to: email,
        subject: 'Ventidoc sign-up attempt',
        text: 'Someone tried to create a Ventidoc account with this email. If it was you, sign in or reset your password.',
      });
      return;
    }
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.user.create({
      data: { email, displayName: input.displayName.trim() },
      select: { id: true },
    });
    try {
      await this.credentials.create(user.id, passwordHash);
    } catch (e) {
      // Two connections cannot share a transaction: compensate so no credential-less account remains.
      await this.prisma.user.delete({ where: { id: user.id } });
      throw e;
    }
    await this.audit.record(null, { action: 'auth.user.registered', resourceType: 'user', resourceId: user.id, actorUserId: user.id }, meta);
    await this.sendVerification(user.id, email);
  }

  async resendVerification(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true } });
    if (user && !user.emailVerifiedAt) await this.sendVerification(user.id, email);
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const userId = await this.consumeActionToken(token, 'EMAIL_VERIFICATION');
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record(null, { action: 'auth.email.verified', resourceType: 'user', resourceId: userId, actorUserId: userId }, meta);
  }

  /**
   * Password login with layered, shared (Redis) abuse limits instead of an account
   * lockout (docs/security/rate-limiting-and-abuse-protection.md §2.2).
   *
   * Every bucket is a reservation taken BEFORE the password is verified and refunded
   * when the password proves correct, so successful logins never consume capacity
   * (many users behind one NAT can sign in) while failures always count. Keys use the
   * normalized email, so registered and unknown addresses behave identically.
   */
  async login(
    input: { email: string; password: string; clientType: ClientType; deviceName?: string; deviceToken?: string },
    meta: RequestMeta,
  ): Promise<IssuedTokens & { deviceToken: string; user: { id: string; email: string; displayName: string } }> {
    const email = normalizeEmail(input.email);
    const network = `ip:${rateLimitNetwork(meta.ipAddress, this.config.rateLimitIpv6Prefix)}`;
    const account = `email:${email}`;
    const reserved: [PolicyName, string][] = [];
    const reserve = async (policy: PolicyName, subject: string) => {
      await this.limiter.enforce(policy, subject);
      reserved.push([policy, subject]);
    };

    // 1. One network guessing this account: always applies, recognized device or not.
    await reserve('login.ip_account', `${network}|${account}`);

    const user = await this.prisma.user.findUnique({ where: { email } });
    // A valid token for exactly this user under their current credentials (bearer; see DeviceTokenService).
    const device = this.devices.recognize(input.deviceToken, user);
    if (device) {
      // 2a. Returning clients: their own bucket. They skip the shared per-network bucket
      //     (an insider on a shared address cannot lock colleagues out) and the per-account
      //     bucket (a distributed attack cannot lock the owner out).
      await reserve('login.device', `device:${device.deviceId}`);
    } else {
      // 2b. Everyone else: per network (spraying many accounts) and per account (distributed guessing).
      await reserve('login.ip', network);
      await reserve('login.account', account);
    }

    const storedHash = user ? await this.credentials.getHash(user.id) : null;
    // Always runs one argon2 verification (against a dummy hash when there is no credential).
    const passwordOk = await this.passwords.verify(storedHash, input.password);

    if (!user || !passwordOk || !storedHash) {
      await this.audit.record(null, {
        action: 'auth.login.failed', resourceType: 'user', resourceId: user?.id ?? null,
        metadata: { reason: user ? 'bad_password' : 'unknown_email', recognizedDevice: !!device },
      }, meta);
      throw Errors.invalidCredentials();
    }
    // Correct credentials: give back every reservation (refunds never exceed a full bucket,
    // and never erase failures recorded before this attempt).
    await Promise.all(reserved.map(([policy, subject]) => this.limiter.refund(policy, subject)));

    if (user.status !== 'ACTIVE') {
      await this.audit.record(null, { action: 'auth.login.blocked', resourceType: 'user', resourceId: user.id, metadata: { reason: 'disabled' } }, meta);
      throw Errors.invalidCredentials();
    }
    if (!user.emailVerifiedAt) {
      throw Errors.forbidden('Verify your email address before signing in');
    }

    if (this.passwords.needsRehash(storedHash)) {
      await this.credentials.upgrade(user.id, storedHash, await this.passwords.hash(input.password));
    }

    const now = new Date();
    const refreshTokenExpiresAt = new Date(now.getTime() + this.config.refreshTokenTtlDays * 86_400_000);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        clientType: input.clientType,
        deviceName: input.deviceName ?? null,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt: refreshTokenExpiresAt,
        // A fresh password login counts as recent authentication for step-up checks.
        reauthenticatedAt: now,
      },
      select: { id: true },
    });
    const tokens = await this.issueTokens(user.id, session.id, refreshTokenExpiresAt);
    await this.audit.record(null, {
      action: 'auth.login.succeeded', resourceType: 'session', resourceId: session.id, actorUserId: user.id,
      metadata: { clientType: input.clientType, recognizedDevice: !!device },
    }, meta);
    return {
      ...tokens,
      deviceToken: this.devices.issue(user.id, credentialEpoch(user), device?.deviceId),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }

  /**
   * Rotates the refresh token. Presenting an already-used token means it was
   * copied: the whole session is revoked so both the attacker's and the victim's
   * copies stop working.
   */
  async refresh(rawToken: string, meta: RequestMeta): Promise<IssuedTokens> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { session: { include: { user: { select: { status: true } } } } },
    });
    if (!record) throw Errors.unauthenticated();
    const { session } = record;
    const now = new Date();

    if (record.usedAt) {
      await this.revokeSession(session.id, 'refresh_token_reuse');
      await this.audit.record(null, {
        action: 'auth.refresh_token.reuse_detected', resourceType: 'session', resourceId: session.id,
        actorUserId: session.userId, metadata: { severity: 'high' },
      }, meta);
      throw Errors.unauthenticated();
    }
    if (session.revokedAt || session.expiresAt <= now || record.expiresAt <= now || session.user.status !== 'ACTIVE') {
      throw Errors.unauthenticated();
    }

    // Conditional update: of two concurrent refreshes with the same token, only one wins.
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) {
      await this.revokeSession(session.id, 'refresh_token_reuse');
      throw Errors.unauthenticated();
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    return this.issueTokens(session.userId, session.id, session.expiresAt);
  }

  async logout(sessionId: string, userId: string, meta: RequestMeta): Promise<void> {
    await this.revokeSession(sessionId, 'logout');
    await this.audit.record(null, { action: 'auth.logout', resourceType: 'session', resourceId: sessionId, actorUserId: userId }, meta);
  }

  listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, clientType: true, deviceName: true, ipAddress: true, userAgent: true, createdAt: true, lastUsedAt: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeOwnSession(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'revoked_by_user' },
    });
    if (result.count === 0) throw Errors.notFound('Session');
    await this.audit.record(null, { action: 'auth.session.revoked', resourceType: 'session', resourceId: sessionId, actorUserId: userId }, meta);
  }

  async forgotPassword(rawEmail: string, meta: RequestMeta): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = await this.createActionToken(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
    await this.mail.send({
      to: email,
      subject: 'Reset your Ventidoc password',
      text: `Reset your password (valid for 1 hour): ${this.mail.link('/reset-password', token)}`,
    });
    await this.audit.record(null, { action: 'auth.password_reset.requested', resourceType: 'user', resourceId: user.id }, meta);
  }

  /** Resetting a password signs out every session of the account. */
  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const userId = await this.consumeActionToken(token, 'PASSWORD_RESET');
    const { email } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();
    // Fail-safe ordering across the two connections: sign everything out and stamp
    // passwordChangedAt first (AuthGuard rejects sessions older than that stamp), then
    // swap the hash. A failure in between leaves the user signed out with the old
    // password, never signed in with sessions that should have been revoked.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        // Proving control of the inbox also verifies it.
        data: { passwordChangedAt: now, emailVerifiedAt: now },
      }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'password_reset' } }),
    ]);
    if (!(await this.credentials.update(userId, passwordHash))) await this.credentials.create(userId, passwordHash);
    // Recovery path: inbox control lifts the distributed-attack bucket on this account,
    // so the owner can sign in from a new device right away. Best effort if Redis is down.
    await this.limiter.reset('login.account', `email:${email}`).catch(() => undefined);
    await this.audit.record(null, { action: 'auth.password_reset.completed', resourceType: 'user', resourceId: userId, actorUserId: userId }, meta);
  }

  /** Step-up: re-enter the password to unlock privileged actions on this session for a short window. */
  async reauthenticate(userId: string, sessionId: string, password: string, meta: RequestMeta): Promise<void> {
    const hash = await this.credentials.getHash(userId);
    if (!hash || !(await this.passwords.verify(hash, password))) {
      // Limited per session and per user by the route (reauth.*); no account lock.
      await this.audit.record(null, { action: 'auth.reauthentication.failed', resourceType: 'session', resourceId: sessionId, actorUserId: userId }, meta);
      throw Errors.invalidCredentials();
    }
    await this.prisma.session.update({ where: { id: sessionId }, data: { reauthenticatedAt: new Date() } });
    await this.audit.record(null, { action: 'auth.reauthenticated', resourceType: 'session', resourceId: sessionId, actorUserId: userId }, meta);
  }

  verifyAccessToken(token: string): AccessTokenClaims | null {
    try {
      const claims = this.jwt.verify<AccessTokenClaims & { typ?: string }>(token, {
        algorithms: ['HS256'],
        issuer: 'ventidoc',
        audience: 'ventidoc-api',
      });
      if (claims.typ !== 'access' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null;
      return { sub: claims.sub, sid: claims.sid };
    } catch {
      return null;
    }
  }

  private async issueTokens(userId: string, sessionId: string, refreshTokenExpiresAt: Date): Promise<IssuedTokens> {
    // Access tokens carry identity only. Roles and permissions are always read from
    // the database, so a stale token can never carry stale privileges.
    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'access' },
      { algorithm: 'HS256', expiresIn: this.config.jwtAccessTtlSeconds, issuer: 'ventidoc', audience: 'ventidoc-api' },
    );
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: { sessionId, tokenHash: hashToken(refreshToken), expiresAt: refreshTokenExpiresAt },
    });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + this.config.jwtAccessTtlSeconds * 1000),
      refreshToken,
      refreshTokenExpiresAt,
      sessionId,
    };
  }

  private async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  }

  private async sendVerification(userId: string, email: string): Promise<void> {
    const token = await this.createActionToken(userId, 'EMAIL_VERIFICATION', EMAIL_VERIFICATION_TTL_MS);
    await this.mail.send({
      to: email,
      subject: 'Verify your Ventidoc email',
      text: `Confirm your email address: ${this.mail.link('/verify-email', token)}`,
    });
  }

  private async createActionToken(userId: string, purpose: UserActionPurpose, ttlMs: number): Promise<string> {
    const token = randomToken();
    await this.prisma.$transaction([
      // Only the newest token of each purpose is valid.
      this.prisma.userActionToken.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.userActionToken.create({
        data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
      }),
    ]);
    return token;
  }

  private async consumeActionToken(token: string, purpose: UserActionPurpose): Promise<string> {
    const now = new Date();
    const record = await this.prisma.userActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.purpose !== purpose || record.consumedAt || record.expiresAt <= now) {
      throw Errors.badRequest('invalid_token', 'The link is invalid or has expired');
    }
    const claimed = await this.prisma.userActionToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: now } });
    if (claimed.count !== 1) throw Errors.badRequest('invalid_token', 'The link is invalid or has expired');
    return record.userId;
  }
}

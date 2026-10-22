import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { CredentialStore } from '../auth/credential-store';
import { PasswordService } from '../auth/password.service';
import { hashToken, safeEqual } from '../common/crypto';
import { Errors } from '../common/errors';
import type { AuthIdentity, RequestMeta } from '../common/request-context';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { keyIdOf, open, seal } from './mfa-crypto';
import { MfaPolicyService } from './mfa-policy.service';
import { MfaStore } from './mfa.store';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { matchTotp, newTotpSecret, otpauthUri } from './totp';

export const ENROLLMENT_TTL_MS = 10 * 60_000;
export const ENROLLMENT_MAX_ATTEMPTS = 5;
/** Enrollment must follow a recent password re-entry on this session. */
export const MFA_STEP_UP_WINDOW_MS = 10 * 60_000;

export interface SecondFactorInput {
  code?: string;
  recoveryCode?: string;
}

/**
 * MFA lifecycle (docs/security/mfa.md). Secrets and recovery codes only ever pass
 * through MfaStore (ventidoc_auth). Nothing in this service logs or audits a
 * secret, a TOTP code or a recovery code.
 */
@Injectable()
export class MfaService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Mfa');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: MfaStore,
    private readonly policy: MfaPolicyService,
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialStore,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Refuse to start if any MFA secret is sealed under a key missing from the ring
   * (review A-3): otherwise those users' sign-ins would fail at runtime. Retire a key
   * only after `pnpm api mfa:reencrypt` reports it unused.
   */
  async onApplicationBootstrap(): Promise<void> {
    const missing = missingKeyIds(await this.store.keyUsage(), [...this.config.mfaKeyRing.keys.keys()]);
    if (missing.length) {
      throw new Error(`MFA_ENCRYPTION_KEYS is missing key(s) still protecting MFA secrets: ${missing.join(', ')}. Restore them, then run mfa:reencrypt before retiring.`);
    }
  }

  hasFactor(userId: string): Promise<boolean> {
    return this.store.hasFactor(userId);
  }

  async status(identity: AuthIdentity) {
    const [enabled, required, enrollment] = await Promise.all([
      this.store.hasFactor(identity.userId),
      this.policy.requiresMfa(identity.userId),
      this.store.getEnrollment(identity.userId),
    ]);
    return {
      enabled,
      required,
      sessionVerified: !!identity.mfaVerifiedAt,
      recoveryCodesRemaining: enabled ? await this.store.remainingRecoveryCodes(identity.userId) : 0,
      enrollmentPending: !!enrollment && enrollment.expiresAt > new Date(),
    };
  }

  /**
   * Begins enrollment. Requires a password re-entry on this session within 10 minutes.
   * First enrollment additionally proves inbox control (code by email); replacing an
   * existing authenticator requires the current second factor instead.
   * Returns the secret ONCE so it can be added to an authenticator app.
   */
  async startEnrollment(identity: AuthIdentity, input: SecondFactorInput, meta: RequestMeta) {
    this.requireRecentPassword(identity);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: identity.userId }, select: { email: true } });
    const replacing = await this.store.hasFactor(identity.userId);
    if (replacing && !(await this.verifySecondFactor(identity.userId, input, meta))) throw Errors.invalidMfa();

    const secret = newTotpSecret();
    let emailCode: string | null = null;
    if (!replacing) emailCode = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
    await this.store.putEnrollment(identity.userId, seal(this.config.mfaKeyRing, identity.userId, secret), emailCode ? hashToken(emailCode) : null, expiresAt);
    if (emailCode) {
      await this.mail.send({
        to: user.email,
        subject: 'Your Ventidoc two-step verification setup code',
        text: `Enter this code to finish setting up two-step verification: ${emailCode}\nIt expires in 10 minutes. If you did not request this, change your password now.`,
      });
    }
    await this.audit.record(null, {
      action: 'auth.mfa.enrollment_started', resourceType: 'user', resourceId: identity.userId, actorUserId: identity.userId,
      metadata: { replacing },
    }, meta);
    return { secret, otpauthUri: otpauthUri(secret, user.email), expiresAt, emailCodeRequired: !replacing };
  }

  /**
   * Completes enrollment once possession is proven (a valid TOTP from the new secret,
   * plus the emailed code for a first enrollment). Installs fresh recovery codes,
   * marks THIS session as MFA-verified and revokes every other session.
   * The recovery codes are returned once and never again.
   */
  async confirmEnrollment(identity: AuthIdentity, input: { code: string; emailCode?: string }, meta: RequestMeta) {
    const enrollment = await this.store.getEnrollment(identity.userId);
    if (!enrollment || enrollment.expiresAt <= new Date()) {
      if (enrollment) await this.store.deleteEnrollment(identity.userId);
      throw Errors.invalidMfa();
    }
    const secret = open(this.config.mfaKeyRing, identity.userId, enrollment.secretCiphertext);
    const emailOk = !enrollment.emailCodeHash
      || (typeof input.emailCode === 'string' && safeEqual(hashToken(input.emailCode.trim()), enrollment.emailCodeHash));
    const step = matchTotp(secret, input.code);
    if (!emailOk || step === null) {
      await this.store.failEnrollment(identity.userId, ENROLLMENT_MAX_ATTEMPTS);
      await this.audit.record(null, { action: 'auth.mfa.enrollment_failed', resourceType: 'user', resourceId: identity.userId, actorUserId: identity.userId }, meta);
      throw Errors.invalidMfa();
    }

    const codes = generateRecoveryCodes();
    const replaced = await this.store.hasFactor(identity.userId);
    const activated = await this.store.activate(
      identity.userId, enrollment.secretCiphertext, seal(this.config.mfaKeyRing, identity.userId, secret), step,
      codes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)),
    );
    if (!activated) throw Errors.invalidMfa();

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: identity.userId }, data: { mfaEnabledAt: now } }),
      this.prisma.session.update({ where: { id: identity.sessionId }, data: { mfaVerifiedAt: now } }),
      this.prisma.session.updateMany({
        where: { userId: identity.userId, revokedAt: null, id: { not: identity.sessionId } },
        data: { revokedAt: now, revokeReason: replaced ? 'mfa_replaced' : 'mfa_enabled' },
      }),
      this.prisma.mfaChallenge.updateMany({ where: { userId: identity.userId, consumedAt: null }, data: { consumedAt: now } }),
    ]);
    await this.audit.record(null, {
      action: replaced ? 'auth.mfa.replaced' : 'auth.mfa.enabled', resourceType: 'user', resourceId: identity.userId,
      actorUserId: identity.userId, metadata: { otherSessionsRevoked: true },
    }, meta);
    await this.notify(identity.userId, replaced ? 'Your two-step verification device was changed' : 'Two-step verification was turned on');
    return { recoveryCodes: codes };
  }

  async cancelEnrollment(identity: AuthIdentity): Promise<void> {
    await this.store.deleteEnrollment(identity.userId);
  }

  /** New recovery codes (old ones invalidated atomically). Requires password + a fresh second factor. */
  async regenerateRecoveryCodes(identity: AuthIdentity, input: SecondFactorInput & { password: string }, meta: RequestMeta) {
    if (!identity.mfaVerifiedAt) throw Errors.mfaRequired();
    await this.requirePassword(identity.userId, input.password, meta);
    if (!(await this.verifySecondFactor(identity.userId, input, meta))) throw Errors.invalidMfa();
    const codes = generateRecoveryCodes();
    await this.store.replaceRecoveryCodes(identity.userId, codes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)));
    await this.audit.record(null, { action: 'auth.mfa.recovery_codes_regenerated', resourceType: 'user', resourceId: identity.userId, actorUserId: identity.userId }, meta);
    await this.notify(identity.userId, 'New two-step verification recovery codes were generated');
    return { recoveryCodes: codes };
  }

  /** Turns MFA off. Refused when policy makes MFA mandatory; requires password + a fresh second factor. */
  async disable(identity: AuthIdentity, input: SecondFactorInput & { password: string }, meta: RequestMeta): Promise<void> {
    if (!identity.mfaVerifiedAt) throw Errors.mfaRequired();
    if (await this.policy.requiresMfa(identity.userId)) {
      throw Errors.mfaRequired('Two-step verification is mandatory for platform administrators and organization owners');
    }
    await this.requirePassword(identity.userId, input.password, meta);
    if (!(await this.verifySecondFactor(identity.userId, input, meta))) throw Errors.invalidMfa();
    await this.store.removeAll(identity.userId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: identity.userId }, data: { mfaEnabledAt: null } }),
      this.prisma.session.update({ where: { id: identity.sessionId }, data: { mfaVerifiedAt: null } }),
      this.prisma.session.updateMany({
        where: { userId: identity.userId, revokedAt: null, id: { not: identity.sessionId } },
        data: { revokedAt: now, revokeReason: 'mfa_disabled' },
      }),
    ]);
    await this.audit.record(null, { action: 'auth.mfa.disabled', resourceType: 'user', resourceId: identity.userId, actorUserId: identity.userId, metadata: { otherSessionsRevoked: true } }, meta);
    await this.notify(identity.userId, 'Two-step verification was turned off');
  }

  /**
   * Executes an APPROVED two-person recovery (called only by MfaRecoveryService after
   * the database recorded a second administrator's approval). Idempotent: removes the
   * factor, recovery codes and pending enrollment, revokes every session and voids
   * pending challenges, then notifies the account holder.
   */
  async resetForRecovery(targetUserId: string): Promise<void> {
    await this.store.removeAll(targetUserId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: targetUserId }, data: { mfaEnabledAt: null } }),
      this.prisma.session.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'mfa_recovery' } }),
      this.prisma.mfaChallenge.updateMany({ where: { userId: targetUserId, consumedAt: null }, data: { consumedAt: now } }),
    ]);
    await this.notifyUser(targetUserId, 'mfa_recovery_executed');
  }

  /** Security notices about the user's own account. No secrets, codes or administrator identities. */
  async notifyUser(userId: string, kind: 'mfa_recovery_requested' | 'mfa_recovery_executed'): Promise<void> {
    const text = kind === 'mfa_recovery_requested'
      ? 'A request to reset two-step verification on your Ventidoc account was opened by Ventidoc support. If you did not contact support, reply to support immediately.'
      : 'Two-step verification on your Ventidoc account was reset by Ventidoc support after a second administrator approved it. All your sessions were signed out. If you did not ask for this, contact support immediately.';
    await this.notify(userId, text);
  }

  /**
   * Verifies a TOTP code (replay-protected, atomically) or consumes a recovery code
   * (single use, atomically). Never both. Audits recovery-code use.
   */
  async verifySecondFactor(userId: string, input: SecondFactorInput, meta: RequestMeta): Promise<'totp' | 'recovery' | null> {
    if (input.recoveryCode !== undefined) {
      const normalized = normalizeRecoveryCode(input.recoveryCode);
      if (!normalized || !(await this.store.consumeRecoveryCode(userId, hashRecoveryCode(normalized)))) return null;
      const remaining = await this.store.remainingRecoveryCodes(userId);
      await this.audit.record(null, { action: 'auth.mfa.recovery_code_used', resourceType: 'user', resourceId: userId, actorUserId: userId, metadata: { remaining } }, meta);
      await this.notify(userId, `A recovery code was used to sign in. ${remaining} recovery code(s) remain.`);
      return 'recovery';
    }
    const factor = await this.store.getFactor(userId);
    if (!factor) return null;
    const secret = open(this.config.mfaKeyRing, userId, factor.secretCiphertext);
    const step = matchTotp(secret, input.code);
    if (step === null || step <= factor.lastUsedStep) return null;
    if (!(await this.store.acceptTotpStep(userId, step))) return null; // concurrent replay lost the race
    if (keyIdOf(factor.secretCiphertext) !== this.config.mfaKeyRing.activeKeyId) {
      await this.store.reencryptFactor(userId, factor.secretCiphertext, seal(this.config.mfaKeyRing, userId, secret));
    }
    return 'totp';
  }

  private requireRecentPassword(identity: AuthIdentity): void {
    const at = identity.reauthenticatedAt;
    if (!at || Date.now() - at.getTime() > MFA_STEP_UP_WINDOW_MS) throw Errors.stepUpRequired();
  }

  private async requirePassword(userId: string, password: string, meta: RequestMeta): Promise<void> {
    const hash = await this.credentials.getHash(userId);
    if (!hash || !(await this.passwords.verify(hash, password))) {
      await this.audit.record(null, { action: 'auth.reauthentication.failed', resourceType: 'user', resourceId: userId, actorUserId: userId }, meta);
      throw Errors.invalidCredentials();
    }
  }

  private async notify(userId: string, text: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
      await this.mail.send({ to: user.email, subject: 'Ventidoc security notice', text });
    } catch {
      this.logger.warn(JSON.stringify({ event: 'mfa.notice_failed' }));
    }
  }
}

/** Key IDs that protect at least one stored secret but are absent from the ring. */
export function missingKeyIds(usage: Record<string, number>, ring: string[]): string[] {
  return Object.keys(usage).filter((id) => usage[id] > 0 && !ring.includes(id)).sort();
}

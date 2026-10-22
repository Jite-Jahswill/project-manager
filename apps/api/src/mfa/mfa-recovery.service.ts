import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RateLimiter } from '../abuse/rate-limiter.service';
import { ApiError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb } from '../database/tenant-db.service';
import { PrismaService } from '../database/prisma.service';
import { MfaService } from './mfa.service';

export const RECOVERY_REQUEST_TTL_MS = 24 * 60 * 60_000;

const closed = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);

const SELECT = {
  id: true, targetUserId: true, requestedBy: true, reason: true, status: true, createdAt: true, expiresAt: true,
  decidedBy: true, decidedAt: true, decisionNote: true, executedAt: true,
  target: { select: { email: true, displayName: true } },
} as const;

/**
 * Two-person administrative MFA recovery (docs/security/mfa.md §8).
 *
 *   request (admin A) ──► PENDING ──approve (admin B ≠ A ≠ target)──► APPROVED ──execute──► EXECUTED
 *                            ├──reject (admin B)──► REJECTED
 *                            ├──cancel (admin A)──► CANCELLED
 *                            └──(24 h)───────────► EXPIRED
 *
 * Route guards enforce the platform permission, the administrator's own MFA, a recent
 * password re-entry and per-administrator rate limits. The database enforces separation
 * of duties, immutability, forward-only transitions and one open request per target;
 * approval is a single conditional UPDATE, so replays and concurrent approvals cannot
 * execute twice.
 */
@Injectable()
export class MfaRecoveryService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  async request(adminId: string, targetUserId: string, reason: string, meta: RequestMeta) {
    if (adminId === targetUserId) throw Errors.forbidden('You cannot request recovery of your own two-step verification');
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!target) throw Errors.notFound('User');
    // Bounds harassment of one account through repeated requests (fails closed).
    await this.limiter.enforce('mfa_recovery.target', `user:${targetUserId}`);
    const created = await this.db.asPlatform(adminId, async (tx) => {
      await this.expireStale(tx, targetUserId);
      try {
        const row = await tx.mfaRecoveryRequest.create({
          data: { targetUserId, requestedBy: adminId, reason, expiresAt: new Date(Date.now() + RECOVERY_REQUEST_TTL_MS) },
          select: SELECT,
        });
        await this.audit.record(tx, {
          action: 'platform.mfa_recovery.requested', resourceType: 'mfa_recovery_request', resourceId: row.id,
          actorType: 'PLATFORM_ADMIN', actorUserId: adminId, metadata: { targetUserId, reason },
        }, meta);
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') throw closed('recovery_request_open', 'An open recovery request already exists for this user');
        throw e;
      }
    });
    // Early warning to the account holder; deliberately without the administrator's identity.
    await this.mfa.notifyUser(targetUserId, 'mfa_recovery_requested');
    return created;
  }

  list(adminId: string, status?: string) {
    return this.db.asPlatform(adminId, async (tx) => {
      await tx.mfaRecoveryRequest.updateMany({ where: { status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
      return tx.mfaRecoveryRequest.findMany({
        where: status ? { status: status as never } : {},
        select: SELECT,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }

  /**
   * Second administrator approves; the reset executes immediately. `expectedTargetUserId`
   * must repeat the target the approver verified out of band.
   */
  async approve(approverId: string, requestId: string, expectedTargetUserId: string, meta: RequestMeta) {
    const now = new Date();
    const claim = await this.db.asPlatform(approverId, async (tx) => {
      const won = await tx.mfaRecoveryRequest.updateMany({
        where: {
          id: requestId, status: 'PENDING', expiresAt: { gt: now }, targetUserId: expectedTargetUserId,
          requestedBy: { not: approverId }, NOT: { targetUserId: approverId },
        },
        data: { status: 'APPROVED', decidedBy: approverId, decidedAt: now },
      });
      const row = await tx.mfaRecoveryRequest.findUnique({ where: { id: requestId }, select: SELECT });
      if (!row) throw Errors.notFound('Recovery request');
      if (won.count === 1) {
        await this.audit.record(tx, {
          action: 'platform.mfa_recovery.approved', resourceType: 'mfa_recovery_request', resourceId: requestId,
          actorType: 'PLATFORM_ADMIN', actorUserId: approverId, metadata: { targetUserId: row.targetUserId, requestedBy: row.requestedBy },
        }, meta);
        return row;
      }
      // Retry of an execution that failed after this same approver's approval.
      if (row.status === 'APPROVED' && row.decidedBy === approverId && row.targetUserId === expectedTargetUserId) return row;
      throw this.explainRefusal(row, approverId, expectedTargetUserId, now);
    });
    return this.execute(approverId, claim.id, claim.targetUserId, claim.requestedBy, meta);
  }

  async reject(approverId: string, requestId: string, note: string, meta: RequestMeta) {
    const now = new Date();
    return this.db.asPlatform(approverId, async (tx) => {
      const won = await tx.mfaRecoveryRequest.updateMany({
        where: { id: requestId, status: 'PENDING', expiresAt: { gt: now }, requestedBy: { not: approverId }, NOT: { targetUserId: approverId } },
        data: { status: 'REJECTED', decidedBy: approverId, decidedAt: now, decisionNote: note },
      });
      const row = await tx.mfaRecoveryRequest.findUnique({ where: { id: requestId }, select: SELECT });
      if (!row) throw Errors.notFound('Recovery request');
      if (won.count !== 1) throw this.explainRefusal(row, approverId, row.targetUserId, now);
      await this.audit.record(tx, {
        action: 'platform.mfa_recovery.rejected', resourceType: 'mfa_recovery_request', resourceId: requestId,
        actorType: 'PLATFORM_ADMIN', actorUserId: approverId, metadata: { targetUserId: row.targetUserId, note },
      }, meta);
      return row;
    });
  }

  async cancel(requesterId: string, requestId: string, meta: RequestMeta) {
    return this.db.asPlatform(requesterId, async (tx) => {
      const won = await tx.mfaRecoveryRequest.updateMany({
        where: { id: requestId, status: 'PENDING', requestedBy: requesterId },
        data: { status: 'CANCELLED' },
      });
      if (won.count !== 1) throw closed('recovery_request_closed', 'Only the requester can cancel a pending request');
      await this.audit.record(tx, {
        action: 'platform.mfa_recovery.cancelled', resourceType: 'mfa_recovery_request', resourceId: requestId,
        actorType: 'PLATFORM_ADMIN', actorUserId: requesterId,
      }, meta);
    });
  }

  private async execute(approverId: string, requestId: string, targetUserId: string, requestedBy: string, meta: RequestMeta) {
    try {
      await this.mfa.resetForRecovery(targetUserId);
    } catch (e) {
      await this.audit.record(null, {
        action: 'platform.mfa_recovery.execution_failed', resourceType: 'mfa_recovery_request', resourceId: requestId,
        actorType: 'PLATFORM_ADMIN', actorUserId: approverId, metadata: { targetUserId },
      }, meta);
      throw e;
    }
    return this.db.asPlatform(approverId, async (tx) => {
      await tx.mfaRecoveryRequest.updateMany({ where: { id: requestId, status: 'APPROVED' }, data: { status: 'EXECUTED', executedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'platform.mfa_recovery.executed', resourceType: 'mfa_recovery_request', resourceId: requestId,
        actorType: 'PLATFORM_ADMIN', actorUserId: approverId, metadata: { targetUserId, requestedBy, sessionsRevoked: true },
      }, meta);
      return tx.mfaRecoveryRequest.findUniqueOrThrow({ where: { id: requestId }, select: SELECT });
    });
  }

  private explainRefusal(row: { status: string; requestedBy: string; targetUserId: string; expiresAt: Date }, adminId: string, expectedTarget: string, now: Date): ApiError {
    if (row.requestedBy === adminId || row.targetUserId === adminId) {
      return new ApiError(HttpStatus.FORBIDDEN, 'second_administrator_required', 'A different administrator, who is not the target, must decide this request');
    }
    if (row.status !== 'PENDING') return closed('recovery_request_closed', `This request is ${row.status.toLowerCase()}`);
    if (row.expiresAt <= now) return closed('recovery_request_expired', 'This request has expired');
    if (row.targetUserId !== expectedTarget) return closed('recovery_target_mismatch', 'The confirmed target does not match this request');
    return closed('recovery_request_closed', 'This request can no longer be decided');
  }

  private async expireStale(tx: Parameters<Parameters<TenantDb['asPlatform']>[1]>[0], targetUserId: string) {
    await tx.mfaRecoveryRequest.updateMany({ where: { targetUserId, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
  }
}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Auth, AuthIdentity, Meta, RequestMeta } from '../common/request-context';
import { Errors } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { TenantDb } from '../database/tenant-db.service';
import { AuditQueryDto } from '../organizations/dto/organization.dto';
import { RequirePlatformPermission } from '../authz/platform-access.guard';
import { PlatformAuthzService } from '../authz/platform-authz.service';
import { MfaRecoveryService } from '../mfa/mfa-recovery.service';
import { ApproveMfaRecoveryDto, CreateMfaRecoveryRequestDto, ListMfaRecoveryQuery, RejectMfaRecoveryDto } from '../mfa/dto/mfa.dto';

class OrganizationStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: 'ACTIVE' | 'SUSPENDED';
}

/**
 * Platform administration. All queries run in platform scope, where RLS exposes
 * organization metadata, subscriptions and audit events, and nothing else.
 */
@ApiTags('platform')
@Controller('v1/platform')
export class PlatformController {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: PlatformAuthzService,
    private readonly audit: AuditService,
    private readonly recovery: MfaRecoveryService,
  ) {}

  @Get('me')
  async me(@Auth() identity: AuthIdentity) {
    const access = await this.authz.load(identity.userId);
    if (!access) throw Errors.forbidden();
    return { permissions: [...access.permissions].sort() };
  }

  @Get('organizations') @RequirePlatformPermission('platform.organization.read')
  organizations(@Auth() identity: AuthIdentity) {
    return this.db.asPlatform(identity.userId, (tx) =>
      tx.organization.findMany({
        select: {
          id: true, name: true, slug: true, status: true, createdAt: true,
          subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { code: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  @Patch('organizations/:organizationId/status') @RequirePlatformPermission('platform.organization.suspend')
  setStatus(
    @Auth() identity: AuthIdentity, @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: OrganizationStatusDto, @Meta() meta: RequestMeta,
  ) {
    return this.db.asPlatform(identity.userId, async (tx) => {
      const before = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
      if (!before) throw Errors.notFound('Organization');
      const after = await tx.organization.update({ where: { id: organizationId }, data: { status: dto.status }, select: { id: true, status: true } });
      await this.audit.record(tx, {
        action: 'platform.organization.status_changed', resourceType: 'organization', resourceId: organizationId,
        organizationId, actorType: 'PLATFORM_ADMIN', actorUserId: identity.userId, before, after: { status: after.status },
      }, meta);
      return after;
    });
  }

  // Two-person administrative MFA recovery (docs/security/mfa.md §8). All routes are
  // privileged: the administrator's own MFA, a recent password re-entry and rate limits.
  @Post('mfa-recovery-requests') @RequirePlatformPermission('platform.user_mfa.recovery.request')
  requestRecovery(@Auth() identity: AuthIdentity, @Body() dto: CreateMfaRecoveryRequestDto, @Meta() meta: RequestMeta) {
    return this.recovery.request(identity.userId, dto.targetUserId, dto.reason.trim(), meta);
  }

  @Get('mfa-recovery-requests') @RequirePlatformPermission('platform.user_mfa.recovery.approve')
  listRecovery(@Auth() identity: AuthIdentity, @Query() q: ListMfaRecoveryQuery) {
    return this.recovery.list(identity.userId, q.status);
  }

  @Post('mfa-recovery-requests/:requestId/approve') @HttpCode(200) @RequirePlatformPermission('platform.user_mfa.recovery.approve')
  approveRecovery(
    @Auth() identity: AuthIdentity, @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApproveMfaRecoveryDto, @Meta() meta: RequestMeta,
  ) {
    return this.recovery.approve(identity.userId, requestId, dto.targetUserId, meta);
  }

  @Post('mfa-recovery-requests/:requestId/reject') @HttpCode(200) @RequirePlatformPermission('platform.user_mfa.recovery.approve')
  rejectRecovery(
    @Auth() identity: AuthIdentity, @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectMfaRecoveryDto, @Meta() meta: RequestMeta,
  ) {
    return this.recovery.reject(identity.userId, requestId, dto.note.trim(), meta);
  }

  @Post('mfa-recovery-requests/:requestId/cancel') @HttpCode(204) @RequirePlatformPermission('platform.user_mfa.recovery.request')
  cancelRecovery(@Auth() identity: AuthIdentity, @Param('requestId', ParseUUIDPipe) requestId: string, @Meta() meta: RequestMeta) {
    return this.recovery.cancel(identity.userId, requestId, meta);
  }

  @Get('audit-events') @RequirePlatformPermission('platform.audit.read')
  auditEvents(@Auth() identity: AuthIdentity, @Query() q: AuditQueryDto) {
    return this.db.asPlatform(identity.userId, (tx) =>
      tx.auditEvent.findMany({
        where: q.before ? { occurredAt: { lt: new Date(q.before) } } : {},
        orderBy: { occurredAt: 'desc' },
        take: q.limit ?? 50,
      }),
    );
  }
}

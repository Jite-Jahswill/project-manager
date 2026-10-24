import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Auth, AuthIdentity, Meta, OrgAccess, RequestMeta } from '../common/request-context';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { RequireMembership, RequirePermission } from '../authz/org-access.guard';
import { RateLimit } from '../abuse/rate-limit.guard';
import { AccessControlService } from './access-control.service';
import {
  AcceptInvitationDto, AuditQueryDto, BranchLifecycleDto, CloneRoleDto, CreateBranchDto, CreateOrganizationDto, CreateOverrideDto,
  CreateRoleDto, InviteMemberDto, ListBranchesQuery, ListInvitationsQuery, SetMemberRolesDto, UpdateBranchDto, UpdateMembershipStatusDto,
  UpdateOrganizationDto, UpdateRoleDto,
} from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

/** Routes that are not yet inside an organization context. */
@ApiTags('organizations')
@Controller('v1')
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly access: AccessControlService,
  ) {}

  /** 201 when created; 200 with `created: false` when the same request is retried by the same user. */
  @Post('organizations') @RateLimit('organization.create.user', 'user')
  async create(@Auth() identity: AuthIdentity, @Body() dto: CreateOrganizationDto, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const result = await this.orgs.create(identity.userId, dto, meta);
    if (!result.created) res.status(200);
    return result;
  }

  @Get('me/organizations')
  mine(@Auth() identity: AuthIdentity) {
    return this.orgs.listForUser(identity.userId);
  }

  @Post('invitations/accept') @RateLimit('accept_invite.user', 'user') @HttpCode(200)
  accept(@Auth() identity: AuthIdentity, @Body() dto: AcceptInvitationDto, @Meta() meta: RequestMeta) {
    return this.access.acceptInvitation(identity.userId, dto.token, meta);
  }
}

/**
 * Everything under /v1/orgs/:orgId. Every handler MUST carry @RequirePermission or
 * @RequireMembership; test/route-guards.e2e-spec.ts fails the build otherwise.
 */
@ApiTags('organization')
@Controller('v1/orgs/:orgId')
export class OrganizationScopedController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly access: AccessControlService,
  ) {}

  @Get() @RequireMembership()
  get(@OrgAccess() a: EffectiveAccess) {
    return this.orgs.get(a);
  }

  @Patch() @RequirePermission('organization.settings.manage')
  update(@OrgAccess() a: EffectiveAccess, @Body() dto: UpdateOrganizationDto, @Meta() meta: RequestMeta) {
    return this.orgs.update(a, dto, meta);
  }

  /** Leave the organization (any member; the last active owner cannot). */
  @Post('leave') @HttpCode(200) @RequireMembership()
  leave(@OrgAccess() a: EffectiveAccess, @Meta() meta: RequestMeta) {
    return this.access.leave(a, meta);
  }

  @Get('subscription') @RequirePermission('organization.subscription.read')
  subscription(@OrgAccess() a: EffectiveAccess) {
    return this.orgs.subscription(a);
  }

  @Get('branches') @RequirePermission('organization.branch.read')
  branches(@OrgAccess() a: EffectiveAccess, @Query() q: ListBranchesQuery) {
    return this.orgs.listBranches(a, q.status);
  }

  @Get('branches/:branchId') @RequirePermission('organization.branch.read')
  branch(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.orgs.getBranch(a, branchId);
  }

  @Patch('branches/:branchId') @RequirePermission('organization.branch.manage')
  updateBranch(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: UpdateBranchDto, @Meta() meta: RequestMeta) {
    return this.orgs.updateBranch(a, branchId, dto, meta);
  }

  @Post('branches/:branchId/archive') @HttpCode(200) @RequirePermission('organization.branch.manage')
  archiveBranch(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: BranchLifecycleDto, @Meta() meta: RequestMeta) {
    return this.orgs.archiveBranch(a, branchId, dto.version, meta);
  }

  @Post('branches/:branchId/reactivate') @HttpCode(200) @RequirePermission('organization.branch.manage')
  reactivateBranch(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: BranchLifecycleDto, @Meta() meta: RequestMeta) {
    return this.orgs.reactivateBranch(a, branchId, dto.version, meta);
  }

  @Post('branches') @RequirePermission('organization.branch.manage')
  createBranch(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateBranchDto, @Meta() meta: RequestMeta) {
    return this.orgs.createBranch(a, dto, meta);
  }

  @Get('members') @RequirePermission('organization.member.read')
  members(@OrgAccess() a: EffectiveAccess) {
    return this.access.listMembers(a);
  }

  @Get('members/:membershipId') @RequirePermission('organization.member.read')
  member(@OrgAccess() a: EffectiveAccess, @Param('membershipId', ParseUUIDPipe) membershipId: string) {
    return this.access.getMember(a, membershipId);
  }

  @Post('invitations') @RequirePermission('organization.member.manage')
  invite(@OrgAccess() a: EffectiveAccess, @Body() dto: InviteMemberDto, @Meta() meta: RequestMeta) {
    return this.access.invite(a, dto, meta);
  }

  @Get('invitations') @RequirePermission('organization.member.manage')
  invitations(@OrgAccess() a: EffectiveAccess, @Query() q: ListInvitationsQuery) {
    return this.access.listInvitations(a, q.status);
  }

  @Post('invitations/:invitationId/resend') @HttpCode(200) @RequirePermission('organization.member.manage')
  resendInvitation(@OrgAccess() a: EffectiveAccess, @Param('invitationId', ParseUUIDPipe) invitationId: string, @Meta() meta: RequestMeta) {
    return this.access.resendInvitation(a, invitationId, meta);
  }

  @Delete('invitations/:invitationId') @HttpCode(204) @RequirePermission('organization.member.manage')
  revokeInvitation(@OrgAccess() a: EffectiveAccess, @Param('invitationId', ParseUUIDPipe) invitationId: string, @Meta() meta: RequestMeta) {
    return this.access.revokeInvitation(a, invitationId, meta);
  }

  @Patch('members/:membershipId') @RequirePermission('organization.member.manage')
  setStatus(
    @OrgAccess() a: EffectiveAccess, @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMembershipStatusDto, @Meta() meta: RequestMeta,
  ) {
    return this.access.updateMembershipStatus(a, membershipId, dto.status, meta);
  }

  @Put('members/:membershipId/roles') @RequirePermission('organization.member.manage')
  setRoles(
    @OrgAccess() a: EffectiveAccess, @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SetMemberRolesDto, @Meta() meta: RequestMeta,
  ) {
    return this.access.setMemberRoles(a, membershipId, dto.assignments, meta);
  }

  @Post('members/:membershipId/overrides') @RequirePermission('organization.role.manage')
  addOverride(
    @OrgAccess() a: EffectiveAccess, @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: CreateOverrideDto, @Meta() meta: RequestMeta,
  ) {
    return this.access.addOverride(a, membershipId, dto, meta);
  }

  @Delete('members/:membershipId/overrides/:overrideId') @HttpCode(204) @RequirePermission('organization.role.manage')
  removeOverride(
    @OrgAccess() a: EffectiveAccess, @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('overrideId', ParseUUIDPipe) overrideId: string, @Meta() meta: RequestMeta,
  ) {
    return this.access.removeOverride(a, membershipId, overrideId, meta);
  }

  @Get('roles') @RequirePermission('organization.role.read')
  roles(@OrgAccess() a: EffectiveAccess) {
    return this.access.listRoles(a);
  }

  @Post('roles') @RequirePermission('organization.role.manage')
  createRole(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateRoleDto, @Meta() meta: RequestMeta) {
    return this.access.createRole(a, dto, meta);
  }

  @Patch('roles/:roleId') @RequirePermission('organization.role.manage')
  updateRole(
    @OrgAccess() a: EffectiveAccess, @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto, @Meta() meta: RequestMeta,
  ) {
    return this.access.updateRole(a, roleId, dto, meta);
  }

  @Post('roles/:roleId/clone') @RequirePermission('organization.role.manage')
  cloneRole(
    @OrgAccess() a: EffectiveAccess, @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: CloneRoleDto, @Meta() meta: RequestMeta,
  ) {
    return this.access.cloneRole(a, roleId, dto.name, meta);
  }

  @Delete('roles/:roleId') @HttpCode(204) @RequirePermission('organization.role.manage')
  deleteRole(@OrgAccess() a: EffectiveAccess, @Param('roleId', ParseUUIDPipe) roleId: string, @Meta() meta: RequestMeta) {
    return this.access.deleteRole(a, roleId, meta);
  }

  @Get('audit-events') @RequirePermission('security.audit.read')
  auditEvents(@OrgAccess() a: EffectiveAccess, @Query() q: AuditQueryDto) {
    return this.orgs.listAuditEvents(a, q.limit, q.before);
  }
}

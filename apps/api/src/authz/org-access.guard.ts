import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { Errors } from '../common/errors';
import type { VentidocRequest } from '../common/request-context';
import { can } from './permission-evaluator';
import type { PermissionKey } from './permission-registry';
import { isUuid, OrgAuthzService } from './org-authz.service';

export const ORG_ACCESS = 'ventidoc:orgAccess';

export interface OrgAccessRequirement {
  /** Permission to require; omit to require only an active membership. */
  permission?: PermissionKey;
  /** Route param holding the branch ID for BRANCH-scoped permissions. */
  branchParam?: string;
}

/**
 * Resolves `:orgId` from the route, verifies the caller's active membership
 * from the database and checks the required permission. On success the computed
 * access is attached to the request for TenantDb.inOrg().
 *
 * The response is the same 403 whether the organization does not exist or the
 * caller is simply not a member, so organization IDs cannot be probed.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: OrgAuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.get<OrgAccessRequirement | undefined>(ORG_ACCESS, context.getHandler());
    if (!requirement) throw new Error('OrgAccessGuard used without @RequirePermission/@RequireMembership');

    const req = context.switchToHttp().getRequest<VentidocRequest>();
    if (!req.auth) throw Errors.unauthenticated();
    const orgId = req.params.orgId;
    const access = typeof orgId === 'string' ? await this.authz.load(req.auth.userId, orgId) : null;
    if (!access) throw Errors.forbidden();
    // Organization owners must act from an MFA-verified session (also covers a user
    // who became owner during this session).
    if (access.isOwner && !req.auth.mfaVerifiedAt) throw Errors.mfaRequired();

    if (requirement.permission) {
      let branchId: string | undefined;
      if (requirement.branchParam) {
        const param = req.params[requirement.branchParam];
        if (!isUuid(param)) throw Errors.notFound('Branch');
        branchId = param;
      }
      if (!can(access, requirement.permission, branchId)) throw Errors.forbidden();
    }
    req.orgAccess = access;
    return true;
  }
}

export function RequirePermission(permission: PermissionKey, options: { branchParam?: string } = {}) {
  return applyDecorators(
    SetMetadata(ORG_ACCESS, { permission, ...options } satisfies OrgAccessRequirement),
    UseGuards(OrgAccessGuard),
    ApiForbiddenResponse({ description: `Requires ${permission}` }),
  );
}

/** Any active member of the organization. */
export function RequireMembership() {
  return applyDecorators(SetMetadata(ORG_ACCESS, {} satisfies OrgAccessRequirement), UseGuards(OrgAccessGuard));
}

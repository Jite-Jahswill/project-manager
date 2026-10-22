import { Injectable } from '@nestjs/common';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { EffectiveAccess, PermissionEntry } from './permission-evaluator';
import { OWNER_TEMPLATE_KEY } from './role-templates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Loads a user's effective access in one organization from the database.
 *
 * Called on every organization-scoped request with no caching, so membership
 * revocation, suspension and role changes apply to the very next request.
 * (When caching is introduced it must be invalidated by a per-membership version
 * bump inside the same transaction that changes access.)
 */
@Injectable()
export class OrgAuthzService {
  constructor(private readonly db: TenantDb) {}

  async load(userId: string, orgId: string): Promise<EffectiveAccess | null> {
    if (!isUuid(orgId)) return null;
    return this.db.inOrgUnchecked(orgId, userId, (tx) => this.loadInTx(tx, userId, orgId));
  }

  async loadInTx(tx: Tx, userId: string, orgId: string): Promise<EffectiveAccess | null> {
    const now = new Date();
    const membership = await tx.organizationMembership.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      select: {
        id: true,
        roles: {
          where: { OR: [{ branchId: null }, { branch: { status: 'ACTIVE' } }] },
          select: {
            branchId: true,
            role: { select: { isSystem: true, templateKey: true, permissions: { select: { permissionKey: true } } } },
          },
        },
        overrides: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { permissionKey: true, effect: true, branchId: true },
        },
      },
    });
    if (!membership) return null;

    const isOwner = membership.roles.some(
      (r) => r.branchId === null && r.role.isSystem && r.role.templateKey === OWNER_TEMPLATE_KEY,
    );
    const grants: PermissionEntry[] = membership.roles.flatMap((r) =>
      r.role.permissions.map((p) => ({ permission: p.permissionKey, branchId: r.branchId })),
    );
    const denies: PermissionEntry[] = [];
    for (const o of membership.overrides) {
      (o.effect === 'DENY' ? denies : grants).push({ permission: o.permissionKey, branchId: o.branchId });
    }
    return { userId, organizationId: orgId, membershipId: membership.id, isOwner, grants, denies };
  }
}

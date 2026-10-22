import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { hashToken, normalizeEmail, randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { assertCanDelegate } from '../authz/delegation';
import { isUuid, OrgAuthzService } from '../authz/org-authz.service';
import { can, EffectiveAccess, notAppliedAtBranch } from '../authz/permission-evaluator';
import { PERMISSIONS, PermissionKey } from '../authz/permission-registry';
import { OWNER_TEMPLATE_KEY } from '../authz/role-templates';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../database/prisma.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { ENTITLEMENTS } from '../subscriptions/entitlements';
import type {
  CreateOverrideDto, CreateRoleDto, InviteMemberDto, RoleAssignmentDto, UpdateRoleDto,
} from './dto/organization.dto';

const INVITATION_TTL_MS = 7 * 86_400_000;

type RoleWithPermissions = { id: string; name: string; isSystem: boolean; templateKey: string | null; permissions: { permissionKey: string }[] };

const isOwnerRole = (r: { isSystem: boolean; templateKey: string | null }) => r.isSystem && r.templateKey === OWNER_TEMPLATE_KEY;

/**
 * Organization RBAC administration: members, invitations, roles, assignments and
 * overrides. Every mutation:
 *   - runs in the organization's tenant transaction (RLS + composite FKs),
 *   - locks the organization row so concurrent RBAC changes serialize,
 *   - re-loads the actor's access AFTER taking the lock and re-checks the required
 *     permission, so a concurrent demotion of the actor cannot be raced,
 *   - applies the delegation rule (no granting what you do not hold),
 *   - protects owners (only owners manage owners; the last owner cannot be removed),
 *   - writes an audit event in the same transaction.
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly entitlements: EntitlementService,
    private readonly authz: OrgAuthzService,
  ) {}

  // ---------------------------------------------------------------- members

  listMembers(access: EffectiveAccess) {
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.organizationMembership.findMany({
        where: { organizationId: access.organizationId },
        select: {
          id: true, status: true, createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
          roles: { select: { id: true, branchId: true, role: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((m) => ({
        membershipId: m.id, status: m.status, joinedAt: m.createdAt, user: m.user,
        roles: m.roles.map((r) => ({ assignmentId: r.id, roleId: r.role.id, roleName: r.role.name, branchId: r.branchId })),
      }));
    });
  }

  async invite(access: EffectiveAccess, dto: InviteMemberDto, meta: RequestMeta) {
    const email = normalizeEmail(dto.email);
    const secret = randomToken();
    const result = await this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.member.manage');
      await this.assertMemberSlotAvailable(tx, actor.organizationId);
      const alreadyMember = await tx.organizationMembership.findFirst({
        where: { organizationId: actor.organizationId, status: 'ACTIVE', user: { email } },
        select: { id: true },
      });
      if (alreadyMember) throw Errors.conflict('already_member', 'This person is already a member');

      if (dto.roleId) await this.assertAssignable(tx, actor, { roleId: dto.roleId, branchId: dto.branchId ?? null });
      else if (dto.branchId) throw Errors.badRequest('branch_without_role', 'branchId requires roleId');

      const invitation = await tx.organizationInvitation.create({
        data: {
          organizationId: actor.organizationId, email, roleId: dto.roleId ?? null, branchId: dto.branchId ?? null,
          tokenHash: hashToken(secret), invitedByUserId: actor.userId, expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        select: INVITATION_SELECT,
      });
      const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true } });
      await this.audit.record(tx, {
        action: 'organization.member.invited', resourceType: 'invitation', resourceId: invitation.id,
        organizationId: actor.organizationId, actorUserId: actor.userId, after: invitation,
      }, meta);
      return { invitation, orgName: org.name };
    });
    // The token embeds the organization ID so acceptance can open the right tenant
    // context; the random secret is what authorizes it.
    const token = `${access.organizationId}.${secret}`;
    await this.mail.send({
      to: email,
      subject: `You're invited to ${result.orgName} on Ventidoc`,
      text: `Accept the invitation (valid for 7 days): ${this.mail.link('/accept-invitation', token)}`,
    });
    return result.invitation;
  }

  listInvitations(access: EffectiveAccess) {
    return this.db.inOrg(access, (tx) =>
      tx.organizationInvitation.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: INVITATION_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  revokeInvitation(access: EffectiveAccess, invitationId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.member.manage');
      const inv = await tx.organizationInvitation.findFirst({ where: { id: invitationId, acceptedAt: null, revokedAt: null }, select: INVITATION_SELECT });
      if (!inv) throw Errors.notFound('Invitation');
      await tx.organizationInvitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'organization.invitation.revoked', resourceType: 'invitation', resourceId: invitationId,
        organizationId: actor.organizationId, actorUserId: actor.userId, before: inv,
      }, meta);
    });
  }

  async acceptInvitation(userId: string, token: string, meta: RequestMeta) {
    const [orgId, secret] = token.split('.');
    if (!isUuid(orgId) || !secret) throw Errors.badRequest('invalid_token', 'The invitation is invalid or has expired');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    const tokenHash = hashToken(secret);

    return this.db.acceptingInvitation(orgId, userId, tokenHash, async (tx) => {
      await this.lockOrganization(tx, orgId);
      const inv = await tx.organizationInvitation.findUnique({ where: { tokenHash } });
      if (!inv || inv.organizationId !== orgId || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) {
        throw Errors.badRequest('invalid_token', 'The invitation is invalid or has expired');
      }
      // The invitation is bound to an email address: a forwarded link is useless to anyone else.
      if (!user.emailVerifiedAt || user.email !== inv.email) throw Errors.forbidden('This invitation was sent to a different email address');
      // Re-check the member limit now: a downgrade since the invitation was sent must hold.
      await this.entitlements.assertBelowLimit(tx, orgId, ENTITLEMENTS.members, () =>
        tx.organizationMembership.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      );

      // The inviter's authority is re-checked now, not trusted from invitation time:
      // a revoked or demoted inviter's outstanding invitations stop working.
      const inviter = await this.authz.loadInTx(tx, inv.invitedByUserId, orgId);
      if (!inviter || !can(inviter, 'organization.member.manage')) {
        throw Errors.forbidden('This invitation is no longer valid; ask for a new one');
      }
      if (inv.roleId) await this.assertAssignable(tx, inviter, { roleId: inv.roleId, branchId: inv.branchId });

      const existing = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } } });
      if (existing && existing.status !== 'REVOKED') throw Errors.conflict('already_member', 'You are already a member of this organization');
      let membershipId: string;
      if (existing) {
        // Re-joining after revocation starts from nothing: no resurrected roles or overrides.
        await this.clearAccess(tx, existing.id);
        membershipId = (await tx.organizationMembership.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })).id;
      } else {
        membershipId = (await tx.organizationMembership.create({ data: { organizationId: orgId, userId } })).id;
      }
      if (inv.roleId) {
        await tx.membershipRole.create({
          data: { organizationId: orgId, membershipId, roleId: inv.roleId, branchId: inv.branchId, assignedByUserId: inv.invitedByUserId },
        });
      }
      await tx.organizationInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'organization.member.joined', resourceType: 'membership', resourceId: membershipId,
        organizationId: orgId, actorUserId: userId,
        metadata: { invitationId: inv.id, roleId: inv.roleId, branchId: inv.branchId, rejoined: !!existing },
      }, meta);
      return { organizationId: orgId, membershipId };
    });
  }

  updateMembershipStatus(access: EffectiveAccess, membershipId: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.member.manage');
      if (membershipId === actor.membershipId) throw Errors.forbidden('You cannot change your own membership status');
      const target = await this.loadMembership(tx, actor, membershipId);
      if (target.status === status) return { membershipId, status };
      if (target.status === 'REVOKED') throw Errors.conflict('membership_revoked', 'Revoked members must be invited again');

      const targetIsOwner = target.roles.some((r) => r.branchId === null && isOwnerRole(r.role));
      if (targetIsOwner && !actor.isOwner) throw Errors.forbidden('Only an owner can change an owner\'s membership');
      // Changing someone's access requires holding everything they hold (no sabotage of more-privileged members).
      for (const r of target.roles) assertCanDelegate(actor, r.role.permissions.map((p) => p.permissionKey), r.branchId);
      if (targetIsOwner && status !== 'ACTIVE') await this.assertAnotherOwnerRemains(tx, actor.organizationId, membershipId);
      if (status === 'ACTIVE') await this.assertMemberSlotAvailable(tx, actor.organizationId);

      const removed = status === 'REVOKED' ? await this.clearAccess(tx, membershipId) : null;
      await tx.organizationMembership.update({ where: { id: membershipId }, data: { status } });
      await this.audit.record(tx, {
        action: 'organization.member.status_changed', resourceType: 'membership', resourceId: membershipId,
        organizationId: actor.organizationId, actorUserId: actor.userId,
        before: { status: target.status, roles: target.roles.map((r) => ({ roleId: r.roleId, branchId: r.branchId })) },
        after: { status, ...(removed ? { roles: [] } : {}) },
        metadata: { targetUserId: target.userId, ...(removed ? { removedOverrides: removed.overrides } : {}) },
      }, meta);
      return { membershipId, status };
    });
  }

  /** Replaces the member's role assignments with the given set. */
  setMemberRoles(access: EffectiveAccess, membershipId: string, assignments: RoleAssignmentDto[], meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.member.manage');
      const target = await this.loadMembership(tx, actor, membershipId);
      if (target.status === 'REVOKED') throw Errors.conflict('membership_revoked', 'Revoked members must be invited again');
      const keyOf = (a: { roleId: string; branchId: string | null }) => `${a.roleId}:${a.branchId ?? '*'}`;
      const desired = new Map(assignments.map((a) => [keyOf({ roleId: a.roleId, branchId: a.branchId ?? null }), { roleId: a.roleId, branchId: a.branchId ?? null }]));
      const current = new Map(target.roles.map((r) => [keyOf(r), r]));

      const added = [...desired].filter(([k]) => !current.has(k)).map(([, v]) => v);
      const removed = [...current].filter(([k]) => !desired.has(k)).map(([, v]) => v);

      for (const a of added) await this.assertAssignable(tx, actor, a);
      for (const r of removed) {
        if (isOwnerRole(r.role) && !actor.isOwner) throw Errors.forbidden('Only an owner can remove the Owner role');
        assertCanDelegate(actor, r.role.permissions.map((p) => p.permissionKey), r.branchId);
      }
      if (removed.some((r) => isOwnerRole(r.role))) await this.assertAnotherOwnerRemains(tx, actor.organizationId, membershipId);

      if (removed.length) await tx.membershipRole.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      if (added.length) {
        await tx.membershipRole.createMany({
          data: added.map((a) => ({ organizationId: actor.organizationId, membershipId, roleId: a.roleId, branchId: a.branchId, assignedByUserId: actor.userId })),
        });
      }

      // Tell the caller which permissions a branch-limited assignment does not confer,
      // so the UI never shows access the backend will not grant.
      const notApplied = [];
      for (const a of desired.values()) {
        if (!a.branchId) continue;
        const role = await this.loadRole(tx, a.roleId);
        const permissions = notAppliedAtBranch(role.permissions.map((p) => p.permissionKey));
        if (permissions.length) notApplied.push({ roleId: a.roleId, branchId: a.branchId, permissions });
      }

      const summary = (list: { roleId: string; branchId: string | null }[]) => list.map((a) => ({ roleId: a.roleId, branchId: a.branchId }));
      await this.audit.record(tx, {
        action: 'organization.member.roles_changed', resourceType: 'membership', resourceId: membershipId,
        organizationId: actor.organizationId, actorUserId: actor.userId,
        before: summary(target.roles), after: summary([...desired.values()]),
        metadata: { targetUserId: target.userId, added: summary(added), removed: summary(removed) },
      }, meta);
      return { membershipId, assignments: [...desired.values()], notAppliedAtBranch: notApplied };
    });
  }

  addOverride(access: EffectiveAccess, membershipId: string, dto: CreateOverrideDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.role.manage');
      if (membershipId === actor.membershipId) throw Errors.forbidden('You cannot create overrides for yourself');
      const def = PERMISSIONS.get(dto.permissionKey);
      if (!def) throw Errors.badRequest('unknown_permission', `Unknown permission ${dto.permissionKey}`);
      if (dto.branchId && def.scope !== 'BRANCH') throw Errors.badRequest('not_branch_scoped', `${def.key} cannot be limited to a branch`);
      const target = await this.loadMembership(tx, actor, membershipId);
      if (target.status === 'REVOKED') throw Errors.conflict('membership_revoked', 'Revoked members must be invited again');
      if (target.roles.some((r) => r.branchId === null && isOwnerRole(r.role))) throw Errors.forbidden('Owners cannot have permission overrides');
      if (dto.branchId) await this.loadBranch(tx, dto.branchId);
      if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) throw Errors.badRequest('invalid_expiry', 'expiresAt must be in the future');
      assertCanDelegate(actor, [dto.permissionKey], dto.branchId ?? null);

      const override = await tx.membershipPermissionOverride.create({
        data: {
          organizationId: actor.organizationId, membershipId, permissionKey: dto.permissionKey, effect: dto.effect,
          branchId: dto.branchId ?? null, reason: dto.reason.trim(), createdByUserId: actor.userId,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
      await this.audit.record(tx, {
        action: 'organization.permission_override.created', resourceType: 'permission_override', resourceId: override.id,
        organizationId: actor.organizationId, branchId: override.branchId, actorUserId: actor.userId, after: override,
        metadata: { targetUserId: target.userId },
      }, meta);
      return override;
    });
  }

  removeOverride(access: EffectiveAccess, membershipId: string, overrideId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.role.manage');
      // Explicit, not incidental: nobody lifts their own restrictions.
      if (membershipId === actor.membershipId) throw Errors.forbidden('You cannot remove your own overrides');
      const override = await tx.membershipPermissionOverride.findFirst({ where: { id: overrideId, membershipId } });
      if (!override) throw Errors.notFound('Override');
      assertCanDelegate(actor, [override.permissionKey], override.branchId);
      await tx.membershipPermissionOverride.delete({ where: { id: overrideId } });
      await this.audit.record(tx, {
        action: 'organization.permission_override.removed', resourceType: 'permission_override', resourceId: overrideId,
        organizationId: actor.organizationId, actorUserId: actor.userId, before: override,
      }, meta);
    });
  }

  // ---------------------------------------------------------------- roles

  listRoles(access: EffectiveAccess) {
    return this.db.inOrg(access, async (tx) => {
      const roles = await tx.role.findMany({
        select: {
          id: true, name: true, description: true, isSystem: true, templateKey: true,
          permissions: { select: { permissionKey: true } }, _count: { select: { assignments: true } },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return roles.map((r) => {
        const permissions = r.permissions.map((p) => p.permissionKey).sort();
        return {
          id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, templateKey: r.templateKey,
          permissions: isOwnerRole(r) ? ['*'] : permissions,
          notAppliedAtBranch: isOwnerRole(r) ? [] : notAppliedAtBranch(permissions),
          assignmentCount: r._count.assignments,
        };
      });
    });
  }

  createRole(access: EffectiveAccess, dto: CreateRoleDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.role.manage');
      return this.createRoleInTx(tx, actor, dto, meta);
    });
  }

  updateRole(access: EffectiveAccess, roleId: string, dto: UpdateRoleDto, meta: RequestMeta) {
    const next = dto.permissions ? this.validatePermissionKeys(dto.permissions) : undefined;
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.role.manage');
      const role = await this.loadRole(tx, roleId);
      if (role.isSystem) throw Errors.forbidden('System roles cannot be modified');
      const before = role.permissions.map((p) => p.permissionKey).sort();
      if (dto.name && dto.name.trim() !== role.name) await this.assertRoleNameFree(tx, dto.name);

      let added: string[] = [];
      let removed: string[] = [];
      if (next) {
        added = next.filter((k) => !before.includes(k));
        removed = before.filter((k) => !next.includes(k));
        // Branch-assigned holders get these permissions at their branch; holding them org-wide covers all cases.
        assertCanDelegate(actor, [...added, ...removed]);
        if (removed.length) await tx.rolePermission.deleteMany({ where: { roleId, permissionKey: { in: removed } } });
        if (added.length) await tx.rolePermission.createMany({ data: added.map((permissionKey) => ({ organizationId: actor.organizationId, roleId, permissionKey })) });
      }
      const updated = await tx.role.update({
        where: { id: roleId },
        data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}) },
      });
      await this.audit.record(tx, {
        action: 'organization.role.updated', resourceType: 'role', resourceId: roleId, organizationId: actor.organizationId,
        actorUserId: actor.userId,
        before: { name: role.name, description: role.description, permissions: before },
        after: { name: updated.name, description: updated.description, permissions: next ?? before },
        metadata: { added, removed },
      }, meta);
      return { ...updated, permissions: next ?? before };
    });
  }

  cloneRole(access: EffectiveAccess, roleId: string, name: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.role.manage');
      const source = await this.loadRole(tx, roleId);
      if (source.isSystem) throw Errors.forbidden('System roles cannot be cloned');
      return this.createRoleInTx(tx, actor, { name, description: source.description ?? undefined, permissions: source.permissions.map((p) => p.permissionKey) }, meta, roleId);
    });
  }

  deleteRole(access: EffectiveAccess, roleId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.lockAndReload(tx, access, 'organization.role.manage');
      const role = await this.loadRole(tx, roleId);
      if (role.isSystem) throw Errors.forbidden('System roles cannot be deleted');
      assertCanDelegate(actor, role.permissions.map((p) => p.permissionKey));
      const [assigned, invited] = await Promise.all([
        tx.membershipRole.count({ where: { roleId } }),
        tx.organizationInvitation.count({ where: { roleId, acceptedAt: null, revokedAt: null } }),
      ]);
      if (assigned || invited) throw Errors.conflict('role_in_use', 'Reassign members and pending invitations before deleting this role');
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(tx, {
        action: 'organization.role.deleted', resourceType: 'role', resourceId: roleId, organizationId: actor.organizationId,
        actorUserId: actor.userId, before: { name: role.name, permissions: role.permissions.map((p) => p.permissionKey) },
      }, meta);
    });
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Locks the organization row, then re-derives the actor's access inside the
   * lock. The guard's snapshot was taken before the lock; a concurrent demotion
   * committed in between must win.
   */
  private async lockAndReload(tx: Tx, access: EffectiveAccess, required: PermissionKey): Promise<EffectiveAccess> {
    await this.lockOrganization(tx, access.organizationId);
    const fresh = await this.authz.loadInTx(tx, access.userId, access.organizationId);
    if (!fresh || !can(fresh, required)) throw Errors.forbidden();
    return fresh;
  }

  /** Removes all role assignments and overrides of a membership; returns what was removed. */
  private async clearAccess(tx: Tx, membershipId: string) {
    const overrides = await tx.membershipPermissionOverride.findMany({
      where: { membershipId }, select: { id: true, permissionKey: true, effect: true, branchId: true },
    });
    await tx.membershipPermissionOverride.deleteMany({ where: { membershipId } });
    await tx.membershipRole.deleteMany({ where: { membershipId } });
    return { overrides };
  }

  private async assertMemberSlotAvailable(tx: Tx, orgId: string): Promise<void> {
    await this.entitlements.assertBelowLimit(tx, orgId, ENTITLEMENTS.members, async () => {
      const [members, pending] = await Promise.all([
        tx.organizationMembership.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
        tx.organizationInvitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
      return members + pending;
    });
  }

  private async createRoleInTx(tx: Tx, actor: EffectiveAccess, dto: CreateRoleDto, meta: RequestMeta, clonedFrom?: string) {
    const permissions = this.validatePermissionKeys(dto.permissions);
    assertCanDelegate(actor, permissions);
    await this.assertRoleNameFree(tx, dto.name);
    const role = await tx.role.create({ data: { organizationId: actor.organizationId, name: dto.name.trim(), description: dto.description ?? null } });
    await tx.rolePermission.createMany({ data: permissions.map((permissionKey) => ({ organizationId: actor.organizationId, roleId: role.id, permissionKey })) });
    await this.audit.record(tx, {
      action: 'organization.role.created', resourceType: 'role', resourceId: role.id, organizationId: actor.organizationId,
      actorUserId: actor.userId, after: { name: role.name, permissions }, metadata: clonedFrom ? { clonedFrom } : undefined,
    }, meta);
    return { ...role, permissions };
  }

  private validatePermissionKeys(keys: string[]): string[] {
    const unique = [...new Set(keys)];
    const unknown = unique.filter((k) => !PERMISSIONS.has(k));
    if (unknown.length) throw Errors.badRequest('unknown_permission', `Unknown permissions: ${unknown.join(', ')}`);
    return unique.sort();
  }

  private async assertRoleNameFree(tx: Tx, name: string): Promise<void> {
    const clash = await tx.role.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } }, select: { id: true } });
    if (clash) throw Errors.conflict('role_name_taken', 'A role with this name already exists');
  }

  /** Checks a role (and optional branch) exists in THIS organization and may be assigned by the actor. */
  private async assertAssignable(tx: Tx, actor: EffectiveAccess, a: { roleId: string; branchId: string | null }): Promise<void> {
    const role = await this.loadRole(tx, a.roleId);
    if (a.branchId) await this.loadBranch(tx, a.branchId);
    if (isOwnerRole(role)) {
      if (!actor.isOwner) throw Errors.forbidden('Only an owner can grant the Owner role');
      if (a.branchId) throw Errors.badRequest('owner_org_wide', 'The Owner role cannot be limited to a branch');
      return;
    }
    assertCanDelegate(actor, role.permissions.map((p) => p.permissionKey), a.branchId);
  }

  /** RLS makes another organization's role invisible, so a foreign ID is simply "not found". */
  private async loadRole(tx: Tx, roleId: string): Promise<RoleWithPermissions & { description: string | null }> {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      select: { id: true, name: true, description: true, isSystem: true, templateKey: true, permissions: { select: { permissionKey: true } } },
    });
    if (!role) throw Errors.notFound('Role');
    return role;
  }

  private async loadBranch(tx: Tx, branchId: string) {
    const branch = await tx.branch.findFirst({ where: { id: branchId, status: 'ACTIVE' }, select: { id: true } });
    if (!branch) throw Errors.notFound('Branch');
    return branch;
  }

  private async loadMembership(tx: Tx, actor: EffectiveAccess, membershipId: string) {
    const m = await tx.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: actor.organizationId },
      select: {
        id: true, userId: true, status: true,
        roles: { select: { id: true, roleId: true, branchId: true, role: { select: { id: true, name: true, isSystem: true, templateKey: true, permissions: { select: { permissionKey: true } } } } } },
      },
    });
    if (!m) throw Errors.notFound('Member');
    return m;
  }

  private async lockOrganization(tx: Tx, orgId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`;
  }

  /** Prevents an organization from losing its last active owner (no recovery path otherwise). */
  private async assertAnotherOwnerRemains(tx: Tx, orgId: string, excludingMembershipId: string): Promise<void> {
    const others = await tx.membershipRole.count({
      where: {
        organizationId: orgId, branchId: null, membershipId: { not: excludingMembershipId },
        role: { isSystem: true, templateKey: OWNER_TEMPLATE_KEY },
        membership: { status: 'ACTIVE' },
      },
    });
    if (others === 0) throw Errors.conflict('last_owner', 'An organization must keep at least one active owner. Add another owner first.');
  }
}

const INVITATION_SELECT = {
  id: true, email: true, roleId: true, branchId: true, invitedByUserId: true, createdAt: true, expiresAt: true,
} as const;
